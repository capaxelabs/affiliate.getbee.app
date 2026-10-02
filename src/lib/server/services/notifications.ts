import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import type { DrizzleClient } from '$lib/server/db';
import { apps, notificationDeliveries, settings, subscriptionEvents } from '$lib/server/db/schema';
import { tokenHint } from '$lib/server/secrets';

/**
 * Slack alerts through one incoming webhook.
 *
 * Every alert has a key derived from the fact it reports, recorded before the
 * post goes out. A ledger rebuild rewrites `subscription_events` wholesale, and
 * without the key every rebuild would announce the same upgrade again.
 */

const WEBHOOK_KEY = 'slack_webhook_url';
const TOPICS_KEY = 'slack_topics';

export const TOPICS = {
	subscriptions: 'New, upgraded, downgraded and cancelled subscriptions',
	trials: 'Trials started, converted and cancelled',
	reviews: 'New, changed and removed App Store reviews',
	affiliates: 'Affiliate sign-ups, claims and new referrals',
	sync: 'Partner sync failures'
} as const;

export type Topic = keyof typeof TOPICS;

const DEFAULT_TOPICS: Topic[] = ['subscriptions', 'trials', 'reviews', 'affiliates', 'sync'];

/** Only the last few characters ever leave the server. */
export async function slackSettings(db: DrizzleClient) {
	const rows = await db
		.select()
		.from(settings)
		.where(inArray(settings.key, [WEBHOOK_KEY, TOPICS_KEY]));
	const webhook = rows.find((r) => r.key === WEBHOOK_KEY);
	const topics = rows.find((r) => r.key === TOPICS_KEY);
	return {
		connected: Boolean(webhook),
		hint: webhook?.hint ?? null,
		topics: topics ? (JSON.parse(topics.value) as Topic[]) : DEFAULT_TOPICS
	};
}

export function isSlackWebhook(url: string) {
	try {
		const parsed = new URL(url);
		return parsed.protocol === 'https:' && parsed.hostname === 'hooks.slack.com';
	} catch {
		return false;
	}
}

export async function saveSlackWebhook(db: DrizzleClient, url: string | null) {
	if (!url) {
		await db.delete(settings).where(eq(settings.key, WEBHOOK_KEY));
		return;
	}
	const hint = tokenHint(url);
	await db
		.insert(settings)
		.values({ key: WEBHOOK_KEY, value: url, hint })
		.onConflictDoUpdate({ target: settings.key, set: { value: url, hint, updatedAt: new Date() } });
}

export async function saveSlackTopics(db: DrizzleClient, topics: Topic[]) {
	const value = JSON.stringify(topics.filter((t) => t in TOPICS));
	await db
		.insert(settings)
		.values({ key: TOPICS_KEY, value })
		.onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

async function webhookFor(db: DrizzleClient, topic: Topic) {
	const config = await db
		.select()
		.from(settings)
		.where(inArray(settings.key, [WEBHOOK_KEY, TOPICS_KEY]));
	const url = config.find((r) => r.key === WEBHOOK_KEY)?.value;
	if (!url) return null;
	const topics = config.find((r) => r.key === TOPICS_KEY);
	const enabled = topics ? (JSON.parse(topics.value) as Topic[]) : DEFAULT_TOPICS;
	return enabled.includes(topic) ? url : null;
}

export async function postToSlack(url: string, text: string) {
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ text, unfurl_links: false })
	});
	if (!res.ok) throw new Error(`Slack returned ${res.status}`);
}

/**
 * Sends one alert, at most once per key. Never throws: an alert is a courtesy
 * and must not fail the sync or the request that raised it.
 */
export async function notify(
	db: DrizzleClient,
	alert: { key: string; topic: Topic; text: string },
	webhook?: string | null
) {
	try {
		const url = webhook === undefined ? await webhookFor(db, alert.topic) : webhook;
		if (!url) return false;

		const claimed = await db
			.insert(notificationDeliveries)
			.values({ key: alert.key, topic: alert.topic })
			.onConflictDoNothing()
			.returning({ key: notificationDeliveries.key });
		if (!claimed.length) return false;

		try {
			await postToSlack(url, alert.text);
			return true;
		} catch (error) {
			await db
				.update(notificationDeliveries)
				.set({ status: 'failed', error: error instanceof Error ? error.message : String(error) })
				.where(eq(notificationDeliveries.key, alert.key));
			return false;
		}
	} catch {
		return false;
	}
}

const usd = (cents: number) =>
	new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

const SUBSCRIPTION_TEXT: Record<string, (e: AlertEvent) => string> = {
	new: (e) => `:tada: *${e.appName}*: ${e.shopDomain} subscribed to ${e.plan} (${usd(e.monthly)}/mo)`,
	reactivated: (e) => `:leftwards_arrow_with_hook: *${e.appName}*: ${e.shopDomain} came back on ${e.plan} (${usd(e.monthly)}/mo)`,
	upgraded: (e) => `:arrow_up: *${e.appName}*: ${e.shopDomain} upgraded to ${e.plan} (+${usd(e.delta)}/mo)`,
	downgraded: (e) => `:arrow_down: *${e.appName}*: ${e.shopDomain} downgraded to ${e.plan} (${usd(e.delta)}/mo)`,
	churned: (e) => `:wave: *${e.appName}*: ${e.shopDomain} ${e.reason === 'uninstalled' ? 'uninstalled' : e.reason === 'closed' ? 'closed their store' : 'cancelled'} (${usd(e.delta)}/mo)`,
	frozen: (e) => `:ice_cube: *${e.appName}*: ${e.shopDomain}'s subscription is frozen (${usd(e.delta)}/mo)`,
	unfrozen: (e) => `:sunny: *${e.appName}*: ${e.shopDomain}'s subscription is active again (+${usd(e.delta)}/mo)`,
	trial_started: (e) => `:hourglass_flowing_sand: *${e.appName}*: ${e.shopDomain} started a trial of ${e.plan}`,
	trial_converted: (e) => `:white_check_mark: *${e.appName}*: ${e.shopDomain} converted from trial (${usd(e.monthly)}/mo)`,
	trial_cancelled: (e) => `:x: *${e.appName}*: ${e.shopDomain} cancelled during the trial`
};

type AlertEvent = {
	appName: string;
	shopDomain: string;
	plan: string;
	monthly: number;
	delta: number;
	reason: string | null;
};

/**
 * Announces ledger events from the last two days. The window keeps a backfill
 * from replaying years of history into the channel.
 */
export async function dispatchSubscriptionAlerts(db: DrizzleClient, hours = 48) {
	const subs = await webhookFor(db, 'subscriptions');
	const trials = await webhookFor(db, 'trials');
	if (!subs && !trials) return 0;

	const rows = await db
		.select({
			chargeId: subscriptionEvents.chargeId,
			type: subscriptionEvents.type,
			occurredAt: subscriptionEvents.occurredAt,
			shopDomain: subscriptionEvents.shopDomain,
			planName: subscriptionEvents.planName,
			monthly: subscriptionEvents.monthlyAmountCents,
			delta: subscriptionEvents.mrrDeltaCents,
			reason: subscriptionEvents.churnReason,
			appName: apps.name
		})
		.from(subscriptionEvents)
		.innerJoin(apps, eq(apps.id, subscriptionEvents.appId))
		.where(
			and(
				gte(subscriptionEvents.occurredAt, new Date(Date.now() - hours * 60 * 60 * 1000)),
				sql`${subscriptionEvents.occurredAt} <= unixepoch()`
			)
		)
		.orderBy(subscriptionEvents.occurredAt)
		.limit(50);

	const keyOf = (r: (typeof rows)[number]) =>
		`sub:${r.chargeId}:${r.type}:${Math.floor(r.occurredAt.getTime() / 1000)}`;
	const keys = rows.map(keyOf);
	const sent = new Set(
		keys.length
			? (
					await db
						.select({ key: notificationDeliveries.key })
						.from(notificationDeliveries)
						.where(inArray(notificationDeliveries.key, keys))
				).map((r) => r.key)
			: []
	);

	let count = 0;
	for (const row of rows) {
		const key = keyOf(row);
		if (sent.has(key)) continue;
		const isTrial = row.type.startsWith('trial_');
		const url = isTrial ? trials : subs;
		if (!url) continue;
		const text = SUBSCRIPTION_TEXT[row.type]?.({
			appName: row.appName,
			shopDomain: row.shopDomain,
			plan: row.planName ?? 'a plan',
			monthly: row.monthly,
			delta: row.delta,
			reason: row.reason
		});
		if (!text) continue;
		if (await notify(db, { key, topic: isTrial ? 'trials' : 'subscriptions', text }, url)) count++;
	}
	return count;
}
