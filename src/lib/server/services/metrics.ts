import { and, count, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import type { DrizzleClient } from '$lib/server/db';
import {
	appCharges,
	apps,
	installEvents,
	installs,
	listingTraffic,
	referralClicks,
	subscriptionEvents
} from '$lib/server/db/schema';
import type { AppScope } from './stats';

/**
 * Subscription metrics, read from the ledger and the derived charge columns
 * that `rebuildSubscriptions` maintains.
 *
 * MRR "now" comes from `app_charges`; MRR on a past date is the ledger summed
 * up to that date. The two agree by construction, and `subscriptionConsistency`
 * says so per app.
 */

const DAY = 24 * 60 * 60 * 1000;
const zero = (value: unknown) => Number(value ?? 0);
const limitTo = (scope: AppScope, column: Parameters<typeof inArray>[0]) =>
	scope === null ? undefined : inArray(column, scope.length ? scope : ['']);

/** A charge counting toward MRR right now. Raw SQL so every read agrees. */
const LIVE = sql`${appCharges.kind} = 'recurring'
	and ${appCharges.paidAt} is not null and ${appCharges.paidAt} <= unixepoch()
	and ${appCharges.churnedAt} is null and ${appCharges.status} = 'active'`;

export type MrrNow = {
	mrrCents: number;
	/** Shops paying something right now. */
	payingShops: number;
	trialShops: number;
	/** MRR waiting on trials still running. */
	trialPipelineCents: number;
	arpuCents: number;
};

export async function mrrNow(db: DrizzleClient, scope: AppScope = null): Promise<MrrNow> {
	const [live, trials] = await Promise.all([
		db
			.select({
				mrr: sql<number>`coalesce(sum(${appCharges.monthlyAmountCents}), 0)`,
				shops: sql<number>`count(distinct case when ${appCharges.monthlyAmountCents} > 0
					then ${appCharges.appId} || ' ' || ${appCharges.shopDomain} end)`
			})
			.from(appCharges)
			.where(and(LIVE, limitTo(scope, appCharges.appId))),
		db
			.select({
				shops: sql<number>`count(distinct ${appCharges.appId} || ' ' || ${appCharges.shopDomain})`,
				value: sql<number>`coalesce(sum(${appCharges.monthlyAmountCents}), 0)`
			})
			.from(appCharges)
			.where(
				and(
					eq(appCharges.trialStatus, 'in_trial'),
					sql`${appCharges.churnedAt} is null`,
					sql`${appCharges.paidAt} > unixepoch()`,
					limitTo(scope, appCharges.appId)
				)
			)
	]);

	const mrrCents = zero(live[0]?.mrr);
	const payingShops = zero(live[0]?.shops);
	return {
		mrrCents,
		payingShops,
		trialShops: zero(trials[0]?.shops),
		trialPipelineCents: zero(trials[0]?.value),
		arpuCents: payingShops ? Math.round(mrrCents / payingShops) : 0
	};
}

/** MRR per app right now. */
export async function mrrByApp(db: DrizzleClient, scope: AppScope = null) {
	const rows = await db
		.select({
			appId: appCharges.appId,
			mrr: sql<number>`coalesce(sum(${appCharges.monthlyAmountCents}), 0)`,
			subscriptions: sql<number>`sum(case when ${appCharges.monthlyAmountCents} > 0 then 1 else 0 end)`
		})
		.from(appCharges)
		.where(and(LIVE, limitTo(scope, appCharges.appId)))
		.groupBy(appCharges.appId);
	return new Map(
		rows.map((r) => [r.appId, { mrrCents: zero(r.mrr), subscriptions: zero(r.subscriptions) }])
	);
}

export type MovementPoint = {
	period: string;
	/** MRR at the end of the month. */
	mrr: number;
	new: number;
	reactivated: number;
	expansion: number;
	contraction: number;
	churned: number;
	/** Freezes net of unfreezes. */
	frozen: number;
	net: number;
	trialsStarted: number;
	trialsConverted: number;
	trialsCancelled: number;
};

function monthKeys(months: number, now = new Date()) {
	return Array.from({ length: months }, (_, i) => {
		const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1 - i), 1));
		return d.toISOString().slice(0, 7);
	});
}

/**
 * MRR at each month end and what moved it, from the ledger. Each movement row
 * adds across to `net`, and `net` is the change in `mrr` from the month before.
 */
export async function mrrMovement(
	db: DrizzleClient,
	scope: AppScope = null,
	months = 12
): Promise<MovementPoint[]> {
	const keys = monthKeys(months);
	const period = sql<string>`strftime('%Y-%m', ${subscriptionEvents.occurredAt}, 'unixepoch')`;

	const rows = await db
		.select({
			period,
			type: subscriptionEvents.type,
			delta: sql<number>`coalesce(sum(${subscriptionEvents.mrrDeltaCents}), 0)`,
			value: count()
		})
		.from(subscriptionEvents)
		.where(
			and(
				sql`${subscriptionEvents.occurredAt} <= unixepoch()`,
				limitTo(scope, subscriptionEvents.appId)
			)
		)
		.groupBy(period, subscriptionEvents.type);

	const points = new Map<string, MovementPoint>(
		keys.map((k) => [
			k,
			{
				period: k,
				mrr: 0,
				new: 0,
				reactivated: 0,
				expansion: 0,
				contraction: 0,
				churned: 0,
				frozen: 0,
				net: 0,
				trialsStarted: 0,
				trialsConverted: 0,
				trialsCancelled: 0
			}
		])
	);

	let opening = 0;
	for (const row of rows) {
		const delta = zero(row.delta);
		const point = points.get(row.period);
		if (!point) {
			if (row.period < keys[0]) opening += delta;
			continue;
		}
		point.net += delta;
		switch (row.type) {
			case 'new':
				point.new += delta;
				break;
			case 'reactivated':
				point.reactivated += delta;
				break;
			case 'upgraded':
				point.expansion += delta;
				break;
			case 'downgraded':
				point.contraction += delta;
				break;
			case 'churned':
				point.churned += delta;
				break;
			case 'frozen':
			case 'unfrozen':
				point.frozen += delta;
				break;
			case 'trial_started':
				point.trialsStarted += zero(row.value);
				break;
			case 'trial_converted':
				point.trialsConverted += zero(row.value);
				break;
			case 'trial_cancelled':
				point.trialsCancelled += zero(row.value);
				break;
		}
	}

	let running = opening;
	return keys.map((k) => {
		const point = points.get(k)!;
		running += point.net;
		point.mrr = running;
		return point;
	});
}

export type ChurnMetrics = {
	windowDays: number;
	mrrAtStartCents: number;
	/** Share of MRR at the start of the window lost to churn and downgrades. */
	revenueChurnPct: number | null;
	/** Share of paying subscriptions at the start that ended. */
	subscriptionChurnPct: number | null;
	/** Uninstalls net of reinstalls over installs live at the start. */
	logoChurnPct: number | null;
	arpuCents: number;
	/** ARPU over the monthly revenue churn rate. Null while nothing churns. */
	ltvCents: number | null;
	trialConversionPct: number | null;
};

/** Rolling 30-day churn, ARPU and LTV. */
export async function churnMetrics(
	db: DrizzleClient,
	scope: AppScope = null,
	windowDays = 30
): Promise<ChurnMetrics> {
	const start = new Date(Date.now() - windowDays * DAY);
	const startSec = Math.floor(start.getTime() / 1000);
	const ledgerScope = limitTo(scope, subscriptionEvents.appId);

	const [opening, lost, payingAtStart, endedSubs, live, installMoves, liveInstalls, trials] =
		await Promise.all([
			db
				.select({ value: sql<number>`coalesce(sum(${subscriptionEvents.mrrDeltaCents}), 0)` })
				.from(subscriptionEvents)
				.where(and(lt(subscriptionEvents.occurredAt, start), ledgerScope)),
			db
				.select({ value: sql<number>`coalesce(sum(${subscriptionEvents.mrrDeltaCents}), 0)` })
				.from(subscriptionEvents)
				.where(
					and(
						gte(subscriptionEvents.occurredAt, start),
						sql`${subscriptionEvents.occurredAt} <= unixepoch()`,
						inArray(subscriptionEvents.type, ['churned', 'downgraded']),
						ledgerScope
					)
				),
			db
				.select({ value: count() })
				.from(appCharges)
				.where(
					and(
						eq(appCharges.kind, 'recurring'),
						sql`${appCharges.monthlyAmountCents} > 0`,
						sql`${appCharges.paidAt} <= ${startSec}`,
						sql`(${appCharges.churnedAt} is null or ${appCharges.churnedAt} > ${startSec})`,
						limitTo(scope, appCharges.appId)
					)
				),
			db
				.select({ value: count() })
				.from(appCharges)
				.where(
					and(
						eq(appCharges.kind, 'recurring'),
						sql`${appCharges.monthlyAmountCents} > 0`,
						sql`${appCharges.paidAt} <= ${startSec}`,
						sql`${appCharges.churnedAt} > ${startSec}`,
						sql`${appCharges.churnReason} <> 'plan_change'`,
						limitTo(scope, appCharges.appId)
					)
				),
			mrrNow(db, scope),
			db
				.select({ type: installEvents.type, value: count() })
				.from(installEvents)
				.where(
					and(
						gte(installEvents.occurredAt, start),
						inArray(installEvents.type, ['installed', 'uninstalled', 'deactivated']),
						limitTo(scope, installEvents.appId)
					)
				)
				.groupBy(installEvents.type),
			db
				.select({ value: count() })
				.from(installs)
				.where(and(eq(installs.status, 'installed'), limitTo(scope, installs.appId))),
			// Trials that started long enough ago to have an outcome.
			db
				.select({ type: subscriptionEvents.type, value: count() })
				.from(subscriptionEvents)
				.where(
					and(
						inArray(subscriptionEvents.type, ['trial_converted', 'trial_cancelled']),
						gte(subscriptionEvents.occurredAt, new Date(Date.now() - 90 * DAY)),
						ledgerScope
					)
				)
				.groupBy(subscriptionEvents.type)
		]);

	const mrrAtStartCents = zero(opening[0]?.value);
	const lostCents = -zero(lost[0]?.value);
	const revenueChurn = mrrAtStartCents > 0 ? lostCents / mrrAtStartCents : null;

	const moves = new Map(installMoves.map((r) => [r.type, zero(r.value)]));
	const added = moves.get('installed') ?? 0;
	const removed = (moves.get('uninstalled') ?? 0) + (moves.get('deactivated') ?? 0);
	const installsAtStart = zero(liveInstalls[0]?.value) - added + removed;
	const netLost = Math.max(0, removed - added);

	const outcomes = new Map(trials.map((r) => [r.type, zero(r.value)]));
	const converted = outcomes.get('trial_converted') ?? 0;
	const decided = converted + (outcomes.get('trial_cancelled') ?? 0);

	const subsAtStart = zero(payingAtStart[0]?.value);
	const monthlyChurn = revenueChurn === null ? null : revenueChurn * (30 / windowDays);

	return {
		windowDays,
		mrrAtStartCents,
		revenueChurnPct: revenueChurn === null ? null : revenueChurn * 100,
		subscriptionChurnPct: subsAtStart ? (zero(endedSubs[0]?.value) / subsAtStart) * 100 : null,
		logoChurnPct: installsAtStart > 0 ? (netLost / installsAtStart) * 100 : null,
		arpuCents: live.arpuCents,
		ltvCents: monthlyChurn ? Math.round(live.arpuCents / monthlyChurn) : null,
		trialConversionPct: decided ? (converted / decided) * 100 : null
	};
}

export type FunnelPoint = {
	period: string;
	/** Null where GA4 is not connected — unmeasured, not zero. */
	listingViews: number | null;
	addAppClicks: number | null;
	affiliateClicks: number;
	installs: number;
	/** Installs that fired the app's activation event within 14 days. Null when none is set. */
	activated: number | null;
	trialsStarted: number;
	newPaying: number;
};

/**
 * From listing view to paying customer, per month, for one app.
 *
 * The first two steps count browsers (GA4), the rest count shops (Partner
 * API), so the rate across that seam is directional. Where a later step
 * exceeds an earlier one the counts are left alone — capping installs to fit
 * GA4's coverage would delete real installs to make a chart tidy.
 */
export async function installFunnel(
	db: DrizzleClient,
	appId: string,
	months = 6
): Promise<{ points: FunnelPoint[]; measured: boolean }> {
	const keys = monthKeys(months);
	const from = new Date(`${keys[0]}-01T00:00:00Z`);
	const month = (column: unknown) => sql<string>`strftime('%Y-%m', ${column}, 'unixepoch')`;

	const [app] = await db
		.select({ ga4Dataset: apps.ga4Dataset, activationEvent: apps.activationEvent })
		.from(apps)
		.where(eq(apps.id, appId))
		.limit(1);
	const fromSec = Math.floor(from.getTime() / 1000);

	const [traffic, clicks, installRows, ledger, activatedRows] = await Promise.all([
		db
			.select()
			.from(listingTraffic)
			.where(
				and(
					eq(listingTraffic.appId, appId),
					eq(listingTraffic.grain, 'month'),
					inArray(listingTraffic.period, keys)
				)
			),
		db
			.select({ period: month(referralClicks.createdAt), value: count() })
			.from(referralClicks)
			.where(and(eq(referralClicks.appId, appId), gte(referralClicks.createdAt, from)))
			.groupBy(month(referralClicks.createdAt)),
		db
			.select({ period: month(installEvents.occurredAt), value: count() })
			.from(installEvents)
			.where(
				and(
					eq(installEvents.appId, appId),
					eq(installEvents.type, 'installed'),
					gte(installEvents.occurredAt, from)
				)
			)
			.groupBy(month(installEvents.occurredAt)),
		db
			.select({
				period: month(subscriptionEvents.occurredAt),
				type: subscriptionEvents.type,
				value: count()
			})
			.from(subscriptionEvents)
			.where(
				and(
					eq(subscriptionEvents.appId, appId),
					inArray(subscriptionEvents.type, ['trial_started', 'new', 'reactivated']),
					gte(subscriptionEvents.occurredAt, from)
				)
			)
			.groupBy(month(subscriptionEvents.occurredAt), subscriptionEvents.type),
		app?.activationEvent
			? db.all<{ period: string; value: number }>(sql`
				select strftime('%Y-%m', ie.occurred_at, 'unixepoch') as period,
					count(distinct ie.install_id) as value
				from install_events ie
				join merchants m on m.id = ie.merchant_id
				where ie.app_id = ${appId} and ie.type = 'installed' and ie.occurred_at >= ${fromSec}
					and exists (
						select 1 from usage_events u
						where u.app_id = ie.app_id and u.shop_domain = m.shop_domain
							and u.name = ${app.activationEvent}
							and u.occurred_at >= ie.occurred_at
							and u.occurred_at < ie.occurred_at + ${14 * 86400}
					)
				group by period`)
			: Promise.resolve([] as { period: string; value: number }[])
	]);

	const measured = Boolean(app?.ga4Dataset);
	const activatedBy = new Map(activatedRows.map((r) => [r.period, zero(r.value)]));
	const trafficBy = new Map(traffic.map((t) => [t.period, t]));
	const clicksBy = new Map(clicks.map((c) => [c.period, zero(c.value)]));
	const installsBy = new Map(installRows.map((c) => [c.period, zero(c.value)]));

	return {
		measured,
		points: keys.map((period) => {
			const t = trafficBy.get(period);
			const of = (types: string[]) =>
				ledger
					.filter((l) => l.period === period && types.includes(l.type))
					.reduce((a, l) => a + zero(l.value), 0);
			return {
				period,
				listingViews: measured ? (t?.listingViews ?? 0) : null,
				addAppClicks: measured ? (t?.addAppClicks ?? 0) : null,
				affiliateClicks: clicksBy.get(period) ?? 0,
				installs: installsBy.get(period) ?? 0,
				activated: app?.activationEvent ? (activatedBy.get(period) ?? 0) : null,
				trialsStarted: of(['trial_started']),
				newPaying: of(['new', 'reactivated'])
			};
		})
	};
}

/** Recent ledger rows for a feed. */
export async function recentSubscriptionEvents(
	db: DrizzleClient,
	scope: AppScope = null,
	limit = 15
) {
	return db
		.select({
			id: subscriptionEvents.id,
			type: subscriptionEvents.type,
			shopDomain: subscriptionEvents.shopDomain,
			planName: subscriptionEvents.planName,
			mrrDeltaCents: subscriptionEvents.mrrDeltaCents,
			monthlyAmountCents: subscriptionEvents.monthlyAmountCents,
			churnReason: subscriptionEvents.churnReason,
			occurredAt: subscriptionEvents.occurredAt,
			appId: subscriptionEvents.appId,
			appName: apps.name
		})
		.from(subscriptionEvents)
		.innerJoin(apps, eq(apps.id, subscriptionEvents.appId))
		.where(
			and(
				sql`${subscriptionEvents.occurredAt} <= unixepoch()`,
				limitTo(scope, subscriptionEvents.appId)
			)
		)
		.orderBy(sql`${subscriptionEvents.occurredAt} desc`)
		.limit(limit);
}

export type ConsistencyRow = {
	appId: string;
	name: string;
	chargeMrrCents: number;
	ledgerMrrCents: number;
	/** Recurring sales whose charge we have never seen an event for. */
	orphanSales: number;
	/** Charges with no event trail at all. */
	chargesWithoutTrail: number;
};

/**
 * Cross-checks the derived data per app. MRR read from the charges must equal
 * the ledger summed to today; anything else means a rebuild was skipped or the
 * derivation has a hole.
 */
export async function subscriptionConsistency(db: DrizzleClient): Promise<ConsistencyRow[]> {
	const rows = await db
		.select({
			appId: apps.id,
			name: apps.name,
			chargeMrr: sql<number>`(
				select coalesce(sum(c.monthly_amount_cents), 0) from app_charges c
				where c.app_id = apps.id and c.kind = 'recurring' and c.paid_at is not null
					and c.paid_at <= unixepoch() and c.churned_at is null and c.status = 'active'
			)`,
			ledgerMrr: sql<number>`(
				select coalesce(sum(e.mrr_delta_cents), 0) from subscription_events e
				where e.app_id = apps.id and e.occurred_at <= unixepoch()
			)`,
			orphanSales: sql<number>`(
				select count(*) from transactions t
				where t.app_id = apps.id and t.charge_type = 'recurring'
					and t.partner_charge_id is not null
					and not exists (
						select 1 from app_charges c where c.partner_charge_id = t.partner_charge_id
					)
			)`,
			withoutTrail: sql<number>`(
				select count(*) from app_charges c where c.app_id = apps.id
					and not exists (select 1 from charge_events e where e.charge_id = c.id)
			)`
		})
		.from(apps)
		.orderBy(apps.name);

	return rows.map((r) => ({
		appId: r.appId,
		name: r.name,
		chargeMrrCents: zero(r.chargeMrr),
		ledgerMrrCents: zero(r.ledgerMrr),
		orphanSales: zero(r.orphanSales),
		chargesWithoutTrail: zero(r.withoutTrail)
	}));
}
