import { and, asc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { DrizzleClient } from '$lib/server/db';
import { installEvents, installs, merchants } from '$lib/server/db/schema';

type Merchant = typeof merchants.$inferSelect;

/** How recent a missed install or uninstall must be to still be worth an email. */
const MISSED_WINDOW_DAYS = 3;

/**
 * Merchant email lives in Raechly journeys: install and uninstall reach it as
 * events, scoped to the app's product, with the install's tags (app_status,
 * installed_at, uninstalled_at, install_count). In-app milestones and their
 * tags go from each app to Raechly directly. Best effort on purpose: a Raechly
 * outage must never fail an app's webhook. Without RAECHLY_API_KEY this does
 * nothing.
 */
export async function sendMerchantEvent(
	env: Env,
	options: {
		appSlug: string;
		name: 'app_installed' | 'app_uninstalled';
		merchant: Merchant;
		occurredAt: Date;
		properties?: Record<string, unknown>;
		/** Tags for this app's person in Raechly, kept per product. */
		attributes?: Record<string, unknown>;
	}
) {
	const { name, occurredAt, properties, attributes, ...rest } = options;
	await sendMerchantEvents(env, {
		...rest,
		events: [{ name, occurredAt, properties, attributes }]
	});
}

/** Up to 100 events for one merchant in one request, as Raechly's batch form allows. */
export async function sendMerchantEvents(
	env: Env,
	options: {
		appSlug: string;
		merchant: Merchant;
		events: {
			name: string;
			occurredAt: Date;
			properties?: Record<string, unknown> | null;
			attributes?: Record<string, unknown>;
		}[];
	}
) {
	const { RAECHLY_API_KEY: key, RAECHLY_URL: base } = env as Env & {
		RAECHLY_API_KEY?: string;
		RAECHLY_URL?: string;
	};
	const { merchant } = options;
	if (!key || !merchant.email || options.events.length === 0) return;

	const shopName = merchant.name || merchant.shopDomain;
	// Some shops put the store name in the owner field; "Hi The," is worse than "Hi there,".
	const owner = merchant.ownerName?.trim() ?? '';
	const firstName =
		owner && owner.toLowerCase() !== shopName.toLowerCase() ? owner.split(/\s+/)[0] : '';
	// Raechly holds emails to the person's timezone and needs an IANA name; shops also send "EDT".
	const timezone = merchant.timezone?.includes('/') ? merchant.timezone : undefined;
	// Raechly product keys are the app slug with _ for -, as the import used.
	const product = options.appSlug
		.toLowerCase()
		.replace(/[^a-z0-9_]+/g, '_')
		.replace(/^_+|_+$/g, '');

	const events = options.events.slice(0, 100).map((e) => ({
		name: e.name,
		product,
		email: merchant.email,
		// The shop is the stable identity; the merchant email can change.
		user_id: merchant.shopDomain,
		first_name: firstName || undefined,
		company: shopName,
		// Installing the app is the relationship these service emails rest on.
		consent: 'shopify_install',
		occurred_at: e.occurredAt.toISOString(),
		attributes: {
			shop_domain: merchant.shopDomain,
			shop_name: shopName,
			shopify_plan: merchant.shopifyPlan ?? '',
			country: merchant.country ?? '',
			...(timezone ? { timezone } : {}),
			...e.attributes
		},
		properties: e.properties ?? {}
	}));
	const label = `raechly ${events.map((e) => e.name).join(',')} ${product} ${merchant.shopDomain}`;

	try {
		const res = await fetch(
			`${(base || 'https://dash.raechly.com').replace(/\/$/, '')}/api/events`,
			{
				method: 'POST',
				headers: {
					Authorization: `Bearer ${key}`,
					'Content-Type': 'application/json',
					'X-Client': 'bee-affiliates'
				},
				body: JSON.stringify({ events })
			}
		);
		if (!res.ok) {
			console.error(`${label}: ${res.status} ${await res.text()}`);
			return;
		}
		// The batch form answers 201 even when an event is refused (an unknown product key), so read it.
		const out = (await res.json().catch(() => null)) as {
			failed?: number;
			results?: unknown[];
		} | null;
		if (out?.failed) console.error(`${label}: ${JSON.stringify(out.results)}`);
	} catch (err) {
		console.error(`${label}:`, err);
	}
}

/**
 * The Partner API sync's safety net. An app that missed its webhook, or wasn't
 * reporting yet, leaves an install or uninstall only the sync sees; this sends
 * it to Raechly so the merchant still gets the welcome or the uninstall
 * question, a day late at most.
 *
 * Only events this run inserted, from the last few days, that no app report
 * and no earlier run already has. The sync re-reads two weeks every time and a
 * first run reads years; neither may email anyone about old news.
 */
export async function sendMissedLifecycleEvents(
	db: DrizzleClient,
	env: Env,
	options: { appSlug: string; installId: string; merchantId: string; runStartedAt: Date }
) {
	const runStart = Math.floor(options.runStartedAt.getTime() / 1000);
	const recent = Math.floor(Date.now() / 1000) - MISSED_WINDOW_DAYS * 86400;
	const missed = await db
		.select({ type: installEvents.type, occurredAt: installEvents.occurredAt })
		.from(installEvents)
		.where(
			and(
				eq(installEvents.installId, options.installId),
				inArray(installEvents.type, ['installed', 'uninstalled']),
				eq(installEvents.source, 'partner_api'),
				gte(installEvents.createdAt, new Date(runStart * 1000)),
				gte(installEvents.occurredAt, new Date(recent * 1000)),
				// Ten minutes either way, the same tolerance recordInstall uses for its own duplicates.
				sql`not exists (
					select 1 from install_events x
					where x.install_id = ${installEvents.installId} and x.type = ${installEvents.type}
						and x.id <> ${installEvents.id}
						and abs(x.occurred_at - ${installEvents.occurredAt}) <= 600
						and (x.source = 'ingest' or x.created_at < ${runStart})
				)`
			)
		)
		.orderBy(asc(installEvents.occurredAt));
	if (missed.length === 0) return 0;

	const [merchant] = await db
		.select()
		.from(merchants)
		.where(eq(merchants.id, options.merchantId))
		.limit(1);
	const [install] = await db
		.select({ installCount: installs.installCount })
		.from(installs)
		.where(eq(installs.id, options.installId))
		.limit(1);
	if (!merchant) return 0;

	await sendMerchantEvents(env, {
		appSlug: options.appSlug,
		merchant,
		events: missed.map((e) =>
			e.type === 'installed'
				? {
						name: 'app_installed',
						occurredAt: e.occurredAt,
						properties: { source: 'partner_api' },
						attributes: {
							app_status: 'installed',
							installed_at: e.occurredAt.toISOString(),
							uninstalled_at: '',
							install_count: install?.installCount ?? 1
						}
					}
				: {
						name: 'app_uninstalled',
						occurredAt: e.occurredAt,
						properties: { source: 'partner_api', reason: '' },
						attributes: { app_status: 'uninstalled', uninstalled_at: e.occurredAt.toISOString() }
					}
		)
	});
	return missed.length;
}
