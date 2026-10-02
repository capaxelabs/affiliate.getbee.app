import { and, count, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { DrizzleClient } from '$lib/server/db';
import {
	appCharges,
	appCredits,
	apps,
	installEvents,
	installs,
	merchants,
	subscriptionEvents,
	trafficSources,
	transactions,
	usageCharges
} from '$lib/server/db/schema';
import type { AppScope } from './stats';

/**
 * Reports for Admin → Insights. Everything here is read from data already
 * stored: transactions, the subscription ledger, the install trail, merchant
 * profiles and GA4 traffic.
 */

const DAY = 24 * 60 * 60 * 1000;
const zero = (value: unknown) => Number(value ?? 0);
const limitTo = (scope: AppScope, column: Parameters<typeof inArray>[0]) =>
	scope === null ? undefined : inArray(column, scope.length ? scope : ['']);

function monthKeys(months: number, now = new Date()) {
	return Array.from({ length: months }, (_, i) =>
		new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1 - i), 1))
			.toISOString()
			.slice(0, 7)
	);
}

const monthOf = (d: Date) => d.toISOString().slice(0, 7);
const median = (values: number[]) => {
	if (!values.length) return null;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)];
};

/* ----------------------------------------------------------------- revenue */

export type RevenueMixPoint = {
	period: string;
	subscriptions: number;
	oneTime: number;
	usage: number;
	adjustments: number;
	credits: number;
	gross: number;
	net: number;
	/** Usage applied inside the month, billed or not yet. */
	usageApplied: number;
	/** Credits issued to merchants in the month. */
	creditsIssued: number;
};

/** Gross revenue by kind per month, from what Shopify billed. */
export async function revenueMix(
	db: DrizzleClient,
	scope: AppScope = null,
	months = 12
): Promise<RevenueMixPoint[]> {
	const keys = monthKeys(months);
	const from = new Date(`${keys[0]}-01T00:00:00Z`);
	const period = (col: unknown) => sql<string>`strftime('%Y-%m', ${col}, 'unixepoch')`;

	const [sales, usage, credits] = await Promise.all([
		db
			.select({
				period: period(transactions.occurredAt),
				type: transactions.chargeType,
				gross: sql<number>`coalesce(sum(${transactions.grossAmountCents}), 0)`,
				net: sql<number>`coalesce(sum(${transactions.netAmountCents}), 0)`
			})
			.from(transactions)
			.where(and(gte(transactions.occurredAt, from), limitTo(scope, transactions.appId)))
			.groupBy(period(transactions.occurredAt), transactions.chargeType),
		db
			.select({
				period: period(usageCharges.occurredAt),
				value: sql<number>`coalesce(sum(${usageCharges.amountCents}), 0)`
			})
			.from(usageCharges)
			.where(and(gte(usageCharges.occurredAt, from), limitTo(scope, usageCharges.appId)))
			.groupBy(period(usageCharges.occurredAt)),
		db
			.select({
				period: period(appCredits.occurredAt),
				value: sql<number>`coalesce(sum(${appCredits.amountCents}), 0)`
			})
			.from(appCredits)
			.where(and(gte(appCredits.occurredAt, from), limitTo(scope, appCredits.appId)))
			.groupBy(period(appCredits.occurredAt))
	]);

	return keys.map((k) => {
		const of = (types: string[]) =>
			sales.filter((s) => s.period === k && types.includes(s.type)).reduce((a, s) => a + zero(s.gross), 0);
		const month = sales.filter((s) => s.period === k);
		return {
			period: k,
			subscriptions: of(['recurring']),
			oneTime: of(['one_time']),
			usage: of(['usage']),
			adjustments: of(['adjustment', 'refund']),
			credits: of(['credit']),
			gross: month.reduce((a, s) => a + zero(s.gross), 0),
			net: month.reduce((a, s) => a + zero(s.net), 0),
			usageApplied: zero(usage.find((u) => u.period === k)?.value),
			creditsIssued: zero(credits.find((c) => c.period === k)?.value)
		};
	});
}

/**
 * Money in: net revenue per week as Shopify dated it (the payout batch), and
 * what live subscriptions are due to bill over the next 30 days.
 */
export async function cashflow(db: DrizzleClient, scope: AppScope = null) {
	const from = new Date(Date.now() - 13 * 7 * DAY);
	const week = sql<string>`date(${transactions.occurredAt}, 'unixepoch', 'weekday 1', '-7 days')`;

	const [weeks, due] = await Promise.all([
		db
			.select({ week, net: sql<number>`coalesce(sum(${transactions.netAmountCents}), 0)` })
			.from(transactions)
			.where(and(gte(transactions.occurredAt, from), limitTo(scope, transactions.appId)))
			.groupBy(week)
			.orderBy(week),
		db
			.select({
				value: sql<number>`coalesce(sum(${appCharges.amountCents}), 0)`,
				charges: count()
			})
			.from(appCharges)
			.where(
				and(
					eq(appCharges.kind, 'recurring'),
					eq(appCharges.status, 'active'),
					sql`${appCharges.churnedAt} is null`,
					sql`${appCharges.billingOn} between unixepoch() and unixepoch() + ${30 * 86400}`,
					limitTo(scope, appCharges.appId)
				)
			)
	]);

	return {
		weeks: weeks.map((w) => ({ week: w.week, net: zero(w.net) })),
		dueNext30dCents: zero(due[0]?.value),
		dueNext30dCharges: zero(due[0]?.charges)
	};
}

/** Live subscriptions by plan. */
export async function mrrByPlan(db: DrizzleClient, scope: AppScope = null) {
	const rows = await db
		.select({
			appName: apps.name,
			plan: appCharges.name,
			interval: appCharges.billingInterval,
			subscriptions: count(),
			mrr: sql<number>`coalesce(sum(${appCharges.monthlyAmountCents}), 0)`
		})
		.from(appCharges)
		.innerJoin(apps, eq(apps.id, appCharges.appId))
		.where(
			and(
				eq(appCharges.kind, 'recurring'),
				eq(appCharges.status, 'active'),
				sql`${appCharges.paidAt} <= unixepoch()`,
				sql`${appCharges.churnedAt} is null`,
				limitTo(scope, appCharges.appId)
			)
		)
		.groupBy(apps.name, appCharges.name, appCharges.billingInterval)
		.orderBy(desc(sql`coalesce(sum(${appCharges.monthlyAmountCents}), 0)`));

	return rows.map((r) => ({ ...r, subscriptions: zero(r.subscriptions), mrr: zero(r.mrr) }));
}

/** Median days from install to first payment, and from first payment to cancelling. */
export async function lifecycleTiming(db: DrizzleClient, scope: AppScope = null) {
	const [firstInstalls, ledger] = await Promise.all([
		db
			.select({
				appId: installEvents.appId,
				shopDomain: merchants.shopDomain,
				at: sql<number>`min(${installEvents.occurredAt})`
			})
			.from(installEvents)
			.innerJoin(merchants, eq(merchants.id, installEvents.merchantId))
			.where(and(eq(installEvents.type, 'installed'), limitTo(scope, installEvents.appId)))
			.groupBy(installEvents.appId, merchants.shopDomain),
		db
			.select({
				appId: subscriptionEvents.appId,
				shopDomain: subscriptionEvents.shopDomain,
				type: subscriptionEvents.type,
				occurredAt: subscriptionEvents.occurredAt
			})
			.from(subscriptionEvents)
			.where(
				and(
					inArray(subscriptionEvents.type, ['new', 'churned']),
					limitTo(scope, subscriptionEvents.appId)
				)
			)
			.orderBy(subscriptionEvents.occurredAt)
	]);

	const installedAt = new Map(firstInstalls.map((i) => [`${i.appId} ${i.shopDomain}`, Number(i.at) * 1000]));
	const toConvert: number[] = [];
	const toChurn: number[] = [];
	const firstPaid = new Map<string, number>();

	for (const e of ledger) {
		const key = `${e.appId} ${e.shopDomain}`;
		const at = e.occurredAt.getTime();
		if (e.type === 'new' && !firstPaid.has(key)) {
			firstPaid.set(key, at);
			const installed = installedAt.get(key);
			if (installed && at >= installed) toConvert.push((at - installed) / DAY);
		} else if (e.type === 'churned' && firstPaid.has(key)) {
			toChurn.push((at - firstPaid.get(key)!) / DAY);
		}
	}

	return {
		daysToPay: median(toConvert),
		paidSample: toConvert.length,
		daysToCancel: median(toChurn),
		cancelSample: toChurn.length
	};
}

/* --------------------------------------------------------------- retention */

export type CohortRow = {
	cohort: string;
	size: number;
	/** Share still there at the end of month 0, 1, 2… after the cohort month. */
	retained: (number | null)[];
};

/**
 * Install retention: shops by the month they first installed, and the share
 * still installed at each month end after. A shop that left and came back
 * counts as retained again.
 */
export async function installCohorts(
	db: DrizzleClient,
	scope: AppScope = null,
	months = 12
): Promise<CohortRow[]> {
	const keys = monthKeys(months);
	const events = await db
		.select({
			installId: installEvents.installId,
			type: installEvents.type,
			occurredAt: installEvents.occurredAt
		})
		.from(installEvents)
		.where(
			and(
				inArray(installEvents.type, ['installed', 'uninstalled', 'deactivated']),
				limitTo(scope, installEvents.appId)
			)
		)
		.orderBy(installEvents.occurredAt);

	const byInstall = new Map<string, { type: string; at: number }[]>();
	for (const e of events) {
		const list = byInstall.get(e.installId) ?? [];
		list.push({ type: e.type, at: e.occurredAt.getTime() });
		byInstall.set(e.installId, list);
	}

	const monthEnd = (key: string) => {
		const [y, m] = key.split('-').map(Number);
		return Date.UTC(y, m, 1) - 1;
	};
	const aliveAt = (trail: { type: string; at: number }[], t: number) => {
		let alive = false;
		for (const e of trail) {
			if (e.at > t) break;
			alive = e.type === 'installed';
		}
		return alive;
	};

	const cohorts = new Map<string, { type: string; at: number }[][]>();
	for (const trail of byInstall.values()) {
		const first = trail.find((e) => e.type === 'installed');
		if (!first) continue;
		const key = monthOf(new Date(first.at));
		if (!keys.includes(key)) continue;
		cohorts.set(key, [...(cohorts.get(key) ?? []), trail]);
	}

	const now = Date.now();
	return keys
		.filter((k) => cohorts.has(k))
		.map((k) => {
			const members = cohorts.get(k)!;
			const offsets = keys.slice(keys.indexOf(k));
			return {
				cohort: k,
				size: members.length,
				retained: offsets.map((m) => {
					const t = Math.min(monthEnd(m), now);
					return members.filter((trail) => aliveAt(trail, t)).length / members.length;
				})
			};
		});
}

export type RevenueCohortRow = CohortRow & {
	startingMrr: number;
	/** MRR at each month end as a share of starting MRR — net revenue retention. */
	revenue: (number | null)[];
};

/**
 * Paying customers by the month they first paid. `retained` is the share
 * still paying; `revenue` is their MRR against what they started on, so
 * upgrades push it above 100%.
 */
export async function revenueCohorts(
	db: DrizzleClient,
	scope: AppScope = null,
	months = 12
): Promise<RevenueCohortRow[]> {
	const keys = monthKeys(months);
	const ledger = await db
		.select({
			appId: subscriptionEvents.appId,
			shopDomain: subscriptionEvents.shopDomain,
			type: subscriptionEvents.type,
			delta: subscriptionEvents.mrrDeltaCents,
			occurredAt: subscriptionEvents.occurredAt
		})
		.from(subscriptionEvents)
		.where(
			and(
				sql`${subscriptionEvents.mrrDeltaCents} <> 0`,
				sql`${subscriptionEvents.occurredAt} <= unixepoch()`,
				limitTo(scope, subscriptionEvents.appId)
			)
		)
		.orderBy(subscriptionEvents.occurredAt);

	const byShop = new Map<string, { delta: number; at: number; type: string }[]>();
	for (const e of ledger) {
		const key = `${e.appId} ${e.shopDomain}`;
		const list = byShop.get(key) ?? [];
		list.push({ delta: e.delta, at: e.occurredAt.getTime(), type: e.type });
		byShop.set(key, list);
	}

	const monthEnd = (key: string) => {
		const [y, m] = key.split('-').map(Number);
		return Date.UTC(y, m, 1) - 1;
	};
	const mrrAt = (trail: { delta: number; at: number }[], t: number) =>
		trail.filter((e) => e.at <= t).reduce((a, e) => a + e.delta, 0);

	const cohorts = new Map<string, { delta: number; at: number; type: string }[][]>();
	for (const trail of byShop.values()) {
		const first = trail.find((e) => e.type === 'new');
		if (!first) continue;
		const key = monthOf(new Date(first.at));
		if (!keys.includes(key)) continue;
		cohorts.set(key, [...(cohorts.get(key) ?? []), trail]);
	}

	const now = Date.now();
	return keys
		.filter((k) => cohorts.has(k))
		.map((k) => {
			const members = cohorts.get(k)!;
			const startingMrr = members.reduce((a, t) => a + mrrAt(t, monthEnd(k)), 0);
			const offsets = keys.slice(keys.indexOf(k));
			return {
				cohort: k,
				size: members.length,
				startingMrr,
				retained: offsets.map((m) => {
					const t = Math.min(monthEnd(m), now);
					return members.filter((trail) => mrrAt(trail, t) > 0).length / members.length;
				}),
				revenue: offsets.map((m) => {
					const t = Math.min(monthEnd(m), now);
					return startingMrr ? members.reduce((a, trail) => a + mrrAt(trail, t), 0) / startingMrr : null;
				})
			};
		});
}

/* --------------------------------------------------------------- customers */

export type Dimension = 'country' | 'shopifyPlan' | 'currency';

/** Installs, live installs, paying shops and MRR grouped by a merchant field. */
export async function customerBreakdown(db: DrizzleClient, scope: AppScope, dimension: Dimension) {
	const column =
		dimension === 'country'
			? merchants.country
			: dimension === 'currency'
				? merchants.currency
				: merchants.shopifyPlan;
	const value = sql<string>`coalesce(nullif(${column}, ''), 'Unknown')`;

	const rows = await db
		.select({
			value,
			installs: count(),
			live: sql<number>`sum(case when ${installs.status} = 'installed' then 1 else 0 end)`,
			paying: sql<number>`sum(case when exists (
				select 1 from app_charges c where c.app_id = installs.app_id
					and c.shop_domain = merchants.shop_domain and c.kind = 'recurring'
					and c.status = 'active' and c.churned_at is null and c.paid_at <= unixepoch()
					and c.monthly_amount_cents > 0
			) then 1 else 0 end)`,
			mrr: sql<number>`coalesce(sum((
				select sum(c.monthly_amount_cents) from app_charges c where c.app_id = installs.app_id
					and c.shop_domain = merchants.shop_domain and c.kind = 'recurring'
					and c.status = 'active' and c.churned_at is null and c.paid_at <= unixepoch()
			)), 0)`
		})
		.from(installs)
		.innerJoin(merchants, eq(merchants.id, installs.merchantId))
		.where(limitTo(scope, installs.appId))
		.groupBy(value)
		.orderBy(desc(count()))
		.limit(25);

	return rows.map((r) => ({
		value: r.value,
		installs: zero(r.installs),
		live: zero(r.live),
		paying: zero(r.paying),
		mrr: zero(r.mrr)
	}));
}

/** Why shops left in the last 12 months: your own survey first, Shopify's otherwise. */
export async function uninstallReasons(db: DrizzleClient, scope: AppScope = null) {
	const reason = sql<string>`coalesce(nullif(${installs.uninstallReason}, ''), 'No reason given')`;
	const rows = await db
		.select({ reason, value: count() })
		.from(installs)
		.where(
			and(
				eq(installs.status, 'uninstalled'),
				gte(installs.uninstalledAt, new Date(Date.now() - 365 * DAY)),
				limitTo(scope, installs.appId)
			)
		)
		.groupBy(reason)
		.orderBy(desc(count()))
		.limit(15);
	return rows.map((r) => ({ reason: r.reason, count: zero(r.value) }));
}

/* ------------------------------------------------------------- acquisition */

/** Listing traffic by source and top search terms over the last three months. */
export async function trafficReport(db: DrizzleClient, scope: AppScope = null) {
	const keys = monthKeys(3);
	const where = and(inArray(trafficSources.period, keys), limitTo(scope, trafficSources.appId));

	const [bySurface, terms] = await Promise.all([
		db
			.select({
				surface: trafficSources.surface,
				views: sql<number>`sum(${trafficSources.listingViews})`,
				clicks: sql<number>`sum(${trafficSources.addAppClicks})`
			})
			.from(trafficSources)
			.where(where)
			.groupBy(trafficSources.surface)
			.orderBy(desc(sql`sum(${trafficSources.listingViews})`)),
		db
			.select({
				term: trafficSources.detail,
				views: sql<number>`sum(${trafficSources.listingViews})`,
				clicks: sql<number>`sum(${trafficSources.addAppClicks})`
			})
			.from(trafficSources)
			.where(and(where, eq(trafficSources.surface, 'search'), sql`${trafficSources.detail} <> ''`))
			.groupBy(trafficSources.detail)
			.orderBy(desc(sql`sum(${trafficSources.listingViews})`))
			.limit(20)
	]);

	return {
		months: keys,
		bySurface: bySurface.map((r) => ({ surface: r.surface, views: zero(r.views), clicks: zero(r.clicks) })),
		terms: terms.map((r) => ({ term: r.term, views: zero(r.views), clicks: zero(r.clicks) }))
	};
}
