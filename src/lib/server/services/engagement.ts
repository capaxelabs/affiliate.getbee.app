import { and, count, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { DrizzleClient } from '$lib/server/db';
import {
	appCharges,
	apps,
	installs,
	merchants,
	subscriptionEvents,
	usageEvents
} from '$lib/server/db/schema';
import { chunkRows, runBatch } from '$lib/server/db/batch';
import { isInternalShop } from './internal-shops';
import type { AppScope } from './stats';

/**
 * What merchants do inside each app, from /api/track/event: active shops,
 * the activation rate, and which paying shops look like they are leaving.
 */

const DAY = 24 * 60 * 60 * 1000;
const zero = (value: unknown) => Number(value ?? 0);
const limitTo = (scope: AppScope, column: Parameters<typeof inArray>[0]) =>
	scope === null ? undefined : inArray(column, scope.length ? scope : ['']);

/** How long after install the activation event still counts. */
const ACTIVATION_WINDOW_DAYS = 14;

export async function recordUsageEvents(
	db: DrizzleClient,
	input: {
		appId: string;
		shopDomain: string;
		events: { name: string; properties: Record<string, unknown> | null; occurredAt: Date }[];
	}
) {
	// Reviewers click through every screen; their usage is not a merchant's.
	if (await isInternalShop(db, input.shopDomain, {})) return { recorded: 0, ignored: 'internal' };

	const [merchant] = await db
		.select({ id: merchants.id })
		.from(merchants)
		.where(eq(merchants.shopDomain, input.shopDomain))
		.limit(1);

	// A clock in the future would make a shop look active forever.
	const now = Date.now();
	const rows = input.events.map((e) => ({
		appId: input.appId,
		merchantId: merchant?.id ?? null,
		shopDomain: input.shopDomain,
		name: e.name,
		properties: e.properties,
		occurredAt: new Date(Math.min(e.occurredAt.getTime(), now))
	}));
	const latest = new Date(Math.max(...rows.map((r) => r.occurredAt.getTime())));
	const latestSec = Math.floor(latest.getTime() / 1000);

	await runBatch(db, [
		...chunkRows(rows, 7).map((chunk) => db.insert(usageEvents).values(chunk)),
		...(merchant
			? [
					db
						.update(installs)
						.set({
							lastActiveAt: sql`max(coalesce(${installs.lastActiveAt}, 0), ${latestSec})`
						})
						.where(and(eq(installs.appId, input.appId), eq(installs.merchantId, merchant.id)))
				]
			: [])
	]);

	return { recorded: rows.length };
}

export type EngagementSummary = {
	reporting: boolean;
	dau: number;
	wau: number;
	mau: number;
	events30d: number;
	daily: { date: string; shops: number }[];
	topEvents: { name: string; events: number; shops: number }[];
};

export async function engagementSummary(
	db: DrizzleClient,
	scope: AppScope = null
): Promise<EngagementSummary> {
	const since = new Date(Date.now() - 30 * DAY);
	const shop = sql`${usageEvents.appId} || ' ' || ${usageEvents.shopDomain}`;
	const day = sql<string>`date(${usageEvents.occurredAt}, 'unixepoch')`;
	const window = and(gte(usageEvents.occurredAt, since), limitTo(scope, usageEvents.appId));

	const [active, daily, top] = await Promise.all([
		db
			.select({
				dau: sql<number>`count(distinct case when ${usageEvents.occurredAt} >= unixepoch() - 86400 then ${shop} end)`,
				wau: sql<number>`count(distinct case when ${usageEvents.occurredAt} >= unixepoch() - 604800 then ${shop} end)`,
				mau: sql<number>`count(distinct ${shop})`,
				events: count()
			})
			.from(usageEvents)
			.where(window),
		db
			.select({ date: day, shops: sql<number>`count(distinct ${shop})` })
			.from(usageEvents)
			.where(window)
			.groupBy(day)
			.orderBy(day),
		db
			.select({
				name: usageEvents.name,
				events: count(),
				shops: sql<number>`count(distinct ${shop})`
			})
			.from(usageEvents)
			.where(window)
			.groupBy(usageEvents.name)
			.orderBy(desc(count()))
			.limit(15)
	]);

	const byDate = new Map(daily.map((d) => [d.date, zero(d.shops)]));
	const dates = Array.from({ length: 30 }, (_, i) =>
		new Date(Date.now() - (29 - i) * DAY).toISOString().slice(0, 10)
	);

	return {
		reporting: zero(active[0]?.events) > 0,
		dau: zero(active[0]?.dau),
		wau: zero(active[0]?.wau),
		mau: zero(active[0]?.mau),
		events30d: zero(active[0]?.events),
		daily: dates.map((date) => ({ date, shops: byDate.get(date) ?? 0 })),
		topEvents: top.map((t) => ({ name: t.name, events: zero(t.events), shops: zero(t.shops) }))
	};
}

/**
 * Of the shops that installed in the last 90 days, how many fired the app's
 * activation event within two weeks, and how quickly.
 */
export async function activationRate(db: DrizzleClient, appId: string) {
	const [app] = await db
		.select({ event: apps.activationEvent })
		.from(apps)
		.where(eq(apps.id, appId))
		.limit(1);
	if (!app?.event) return null;

	const since = new Date(Date.now() - 90 * DAY);
	const windowSec = ACTIVATION_WINDOW_DAYS * 86400;

	const rows = await db
		.select({
			installedAt: installs.installedAt,
			activatedAt: sql<number | null>`(
				select min(e.occurred_at) from usage_events e
				join merchants m on m.shop_domain = e.shop_domain
				where e.app_id = ${appId} and m.id = installs.merchant_id and e.name = ${app.event}
					and e.occurred_at >= installs.installed_at
					and e.occurred_at < installs.installed_at + ${windowSec}
			)`
		})
		.from(installs)
		.where(and(eq(installs.appId, appId), gte(installs.installedAt, since)));

	const activated = rows.filter((r) => r.activatedAt !== null);
	const hours = activated
		.map((r) => (Number(r.activatedAt) - r.installedAt.getTime() / 1000) / 3600)
		.sort((a, b) => a - b);

	return {
		event: app.event,
		installs: rows.length,
		activated: activated.length,
		ratePct: rows.length ? (activated.length / rows.length) * 100 : null,
		medianHours: hours.length ? hours[Math.floor(hours.length / 2)] : null
	};
}

export type RiskRow = {
	appId: string;
	appName: string;
	shopDomain: string;
	mrrCents: number;
	reasons: string[];
	lastActiveAt: Date | null;
};

/**
 * Paying or trialling shops showing a sign they may leave. Rules rather than a
 * model: at this volume a model would learn from a handful of churns. Each
 * reason is something a person can act on.
 */
export async function churnRisk(
	db: DrizzleClient,
	scope: AppScope = null,
	limit = 25
): Promise<RiskRow[]> {
	const nowSec = Math.floor(Date.now() / 1000);

	const [live, downgrades, reportingApps] = await Promise.all([
		db
			.select({
				appId: appCharges.appId,
				appName: apps.name,
				shopDomain: appCharges.shopDomain,
				status: appCharges.status,
				trialStatus: appCharges.trialStatus,
				trialEndsAt: appCharges.trialEndsAt,
				monthly: appCharges.monthlyAmountCents,
				lastActiveAt: sql<number | null>`(
					select i.last_active_at from installs i join merchants m on m.id = i.merchant_id
					where i.app_id = app_charges.app_id and m.shop_domain = app_charges.shop_domain
				)`
			})
			.from(appCharges)
			.innerJoin(apps, eq(apps.id, appCharges.appId))
			.where(
				and(
					eq(appCharges.kind, 'recurring'),
					sql`${appCharges.churnedAt} is null`,
					inArray(appCharges.status, ['active', 'frozen']),
					sql`${appCharges.monthlyAmountCents} > 0`,
					limitTo(scope, appCharges.appId)
				)
			),
		db
			.select({ appId: subscriptionEvents.appId, shopDomain: subscriptionEvents.shopDomain })
			.from(subscriptionEvents)
			.where(
				and(
					eq(subscriptionEvents.type, 'downgraded'),
					gte(subscriptionEvents.occurredAt, new Date(Date.now() - 60 * DAY)),
					limitTo(scope, subscriptionEvents.appId)
				)
			),
		db
			.selectDistinct({ appId: usageEvents.appId })
			.from(usageEvents)
			.where(
				and(
					gte(usageEvents.occurredAt, new Date(Date.now() - 30 * DAY)),
					limitTo(scope, usageEvents.appId)
				)
			)
	]);

	const downgraded = new Set(downgrades.map((d) => `${d.appId} ${d.shopDomain}`));
	const reporting = new Set(reportingApps.map((r) => r.appId));

	const rows: RiskRow[] = [];
	for (const c of live) {
		const reasons: string[] = [];
		const last = c.lastActiveAt === null ? null : Number(c.lastActiveAt);
		const idleDays = last === null ? null : (nowSec - last) / 86400;

		if (c.status === 'frozen') reasons.push('Store frozen, not paying');
		if (downgraded.has(`${c.appId} ${c.shopDomain}`)) reasons.push('Downgraded in the last 60 days');
		if (reporting.has(c.appId)) {
			if (idleDays === null) reasons.push('Never used the app');
			else if (idleDays > 14) reasons.push(`Inactive for ${Math.floor(idleDays)} days`);
		}
		if (
			c.trialStatus === 'in_trial' &&
			c.trialEndsAt &&
			c.trialEndsAt.getTime() / 1000 - nowSec < 3 * 86400 &&
			(idleDays === null || idleDays > 3)
		) {
			reasons.push('Trial ends within 3 days, little recent use');
		}
		if (!reasons.length) continue;

		rows.push({
			appId: c.appId,
			appName: c.appName,
			shopDomain: c.shopDomain,
			mrrCents: c.monthly,
			reasons,
			lastActiveAt: last === null ? null : new Date(last * 1000)
		});
	}

	return rows
		.sort((a, b) => b.reasons.length - a.reasons.length || b.mrrCents - a.mrrCents)
		.slice(0, limit);
}
