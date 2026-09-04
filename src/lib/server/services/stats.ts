import { and, count, desc, eq, gte, inArray, lte, sql, sum } from 'drizzle-orm';
import type { DrizzleClient } from '$lib/server/db';
import {
	affiliates,
	apps,
	commissions,
	installs,
	merchants,
	payouts,
	referralClaims,
	referralClicks,
	referrals,
	transactions,
	users
} from '$lib/server/db/schema';

const zero = (value: unknown) => Number(value ?? 0);

/**
 * Restricts a query to a set of apps. `null` means unrestricted; an empty array
 * means the caller has been granted nothing and must see nothing.
 */
export type AppScope = string[] | null;

const scopeIds = (scope: AppScope) => (scope === null ? null : scope);

/** SQL fragment for correlated subqueries that filter on an app column. */
function scopeSql(scope: AppScope, columnSql: string) {
	if (scope === null) return sql.raw('1 = 1');
	if (scope.length === 0) return sql.raw('1 = 0');
	const list = scope.map((id) => `'${id.replace(/'/g, "''")}'`).join(',');
	return sql.raw(`${columnSql} in (${list})`);
}

export type AffiliateSummary = {
	outstandingCents: number;
	pendingPayoutCents: number;
	processingCents: number;
	paidOutCents: number;
	totalEarningsCents: number;
	referralCount: number;
};

/** The six cards on the affiliate home screen. */
export async function affiliateSummary(
	db: DrizzleClient,
	affiliateId: string
): Promise<AffiliateSummary> {
	const [byStatus, payoutRows, referralRows] = await Promise.all([
		db
			.select({
				status: commissions.status,
				total: sum(commissions.amountCents)
			})
			.from(commissions)
			.where(eq(commissions.affiliateId, affiliateId))
			.groupBy(commissions.status),
		db
			.select({ status: payouts.status, total: sum(payouts.amountCents) })
			.from(payouts)
			.where(eq(payouts.affiliateId, affiliateId))
			.groupBy(payouts.status),
		db
			.select({ total: count() })
			.from(referrals)
			.where(eq(referrals.affiliateId, affiliateId))
	]);

	const commissionBy = new Map(byStatus.map((r) => [r.status, zero(r.total)]));
	const payoutBy = new Map(payoutRows.map((r) => [r.status, zero(r.total)]));

	const pending = commissionBy.get('pending') ?? 0;
	const approved = commissionBy.get('approved') ?? 0;
	const paid = commissionBy.get('paid') ?? 0;

	return {
		// Earned but still inside the refund hold window.
		outstandingCents: pending,
		// Cleared and waiting to be included in a payout.
		pendingPayoutCents: approved,
		processingCents: (payoutBy.get('draft') ?? 0) + (payoutBy.get('processing') ?? 0),
		paidOutCents: payoutBy.get('paid') ?? 0,
		totalEarningsCents: pending + approved + paid,
		referralCount: zero(referralRows[0]?.total)
	};
}

/**
 * Every active app plus this affiliate's earnings on it. Uses subqueries rather
 * than joins — joining referrals and commissions together fans out into a
 * cartesian product and multiplies the totals.
 */
export async function affiliateApps(db: DrizzleClient, affiliateId: string) {
	const rows = await db
		.select({
			app: apps,
			earnedCents: sql<number>`(
				select coalesce(sum(c.amount_cents), 0) from commissions c
				where c.app_id = apps.id and c.affiliate_id = ${affiliateId}
			)`,
			referralCount: sql<number>`(
				select count(*) from referrals r
				where r.app_id = apps.id and r.affiliate_id = ${affiliateId}
			)`
		})
		.from(apps)
		.where(eq(apps.status, 'active'))
		.orderBy(apps.name);

	return rows.map((row) => ({
		...row.app,
		earnedCents: zero(row.earnedCents),
		referralCount: zero(row.referralCount)
	}));
}

export type ReportPoint = { period: string; value: number };

export type AffiliateReport = {
	commissionsCents: number;
	revenueCents: number;
	referralCount: number;
	payoutCents: number;
	clickCount: number;
	commissionSeries: ReportPoint[];
	revenueSeries: ReportPoint[];
	referralSeries: ReportPoint[];
	payoutSeries: ReportPoint[];
	byChargeType: { chargeType: string; amountCents: number }[];
	topReferrals: {
		shopDomain: string;
		appName: string;
		lifetimeCommissionCents: number;
		status: string;
	}[];
	funnel: { clicks: number; referrals: number; installed: number; earning: number };
};

const monthKey = (column: unknown) => sql<string>`strftime('%Y-%m', ${column}, 'unixepoch')`;

export async function affiliateReport(
	db: DrizzleClient,
	affiliateId: string,
	from: Date,
	to: Date
): Promise<AffiliateReport> {
	const inRange = and(gte(commissions.occurredAt, from), lte(commissions.occurredAt, to));

	const [
		commissionSeries,
		byChargeType,
		referralSeries,
		payoutSeries,
		clickRows,
		topReferrals,
		funnelRows
	] = await Promise.all([
		db
			.select({
				period: monthKey(commissions.occurredAt),
				commission: sql<number>`coalesce(sum(${commissions.amountCents}), 0)`,
				revenue: sql<number>`coalesce(sum(${commissions.grossAmountCents}), 0)`
			})
			.from(commissions)
			.where(and(eq(commissions.affiliateId, affiliateId), inRange))
			.groupBy(monthKey(commissions.occurredAt))
			.orderBy(monthKey(commissions.occurredAt)),
		db
			.select({
				chargeType: commissions.chargeType,
				amountCents: sql<number>`coalesce(sum(${commissions.amountCents}), 0)`
			})
			.from(commissions)
			.where(and(eq(commissions.affiliateId, affiliateId), inRange))
			.groupBy(commissions.chargeType),
		db
			.select({
				period: monthKey(referrals.createdAt),
				value: sql<number>`count(*)`
			})
			.from(referrals)
			.where(
				and(
					eq(referrals.affiliateId, affiliateId),
					gte(referrals.createdAt, from),
					lte(referrals.createdAt, to)
				)
			)
			.groupBy(monthKey(referrals.createdAt))
			.orderBy(monthKey(referrals.createdAt)),
		db
			.select({
				period: monthKey(payouts.createdAt),
				value: sql<number>`coalesce(sum(${payouts.amountCents}), 0)`
			})
			.from(payouts)
			.where(
				and(
					eq(payouts.affiliateId, affiliateId),
					eq(payouts.status, 'paid'),
					gte(payouts.createdAt, from),
					lte(payouts.createdAt, to)
				)
			)
			.groupBy(monthKey(payouts.createdAt))
			.orderBy(monthKey(payouts.createdAt)),
		db
			.select({ value: count() })
			.from(referralClicks)
			.where(
				and(
					eq(referralClicks.affiliateId, affiliateId),
					gte(referralClicks.createdAt, from),
					lte(referralClicks.createdAt, to)
				)
			),
		db
			.select({
				shopDomain: referrals.shopDomain,
				appName: apps.name,
				lifetimeCommissionCents: referrals.lifetimeCommissionCents,
				status: referrals.status
			})
			.from(referrals)
			.innerJoin(apps, eq(apps.id, referrals.appId))
			.where(eq(referrals.affiliateId, affiliateId))
			.orderBy(desc(referrals.lifetimeCommissionCents))
			.limit(5),
		db
			.select({ status: referrals.status, value: count() })
			.from(referrals)
			.where(eq(referrals.affiliateId, affiliateId))
			.groupBy(referrals.status)
	]);

	const funnelBy = new Map(funnelRows.map((r) => [r.status, zero(r.value)]));
	const totalReferrals = funnelRows.reduce((acc, r) => acc + zero(r.value), 0);
	const earning = funnelBy.get('active') ?? 0;

	return {
		commissionsCents: commissionSeries.reduce((a, r) => a + zero(r.commission), 0),
		revenueCents: commissionSeries.reduce((a, r) => a + zero(r.revenue), 0),
		referralCount: referralSeries.reduce((a, r) => a + zero(r.value), 0),
		payoutCents: payoutSeries.reduce((a, r) => a + zero(r.value), 0),
		clickCount: zero(clickRows[0]?.value),
		commissionSeries: commissionSeries.map((r) => ({ period: r.period, value: zero(r.commission) })),
		revenueSeries: commissionSeries.map((r) => ({ period: r.period, value: zero(r.revenue) })),
		referralSeries: referralSeries.map((r) => ({ period: r.period, value: zero(r.value) })),
		payoutSeries: payoutSeries.map((r) => ({ period: r.period, value: zero(r.value) })),
		byChargeType: byChargeType.map((r) => ({
			chargeType: r.chargeType,
			amountCents: zero(r.amountCents)
		})),
		topReferrals,
		funnel: {
			clicks: zero(clickRows[0]?.value),
			referrals: totalReferrals,
			installed: totalReferrals - (funnelBy.get('pending') ?? 0),
			earning
		}
	};
}

export type AdminSummary = {
	affiliatesTotal: number;
	affiliatesPending: number;
	claimsPending: number;
	referralsActive: number;
	commissionsPendingCents: number;
	commissionsApprovedCents: number;
	payoutsDueCents: number;
	paidLifetimeCents: number;
	revenueLifetimeCents: number;
	appsActive: number;
};

export async function adminSummary(db: DrizzleClient, scope: AppScope = null): Promise<AdminSummary> {
	const ids = scopeIds(scope);
	const commissionLimit =
		ids === null ? undefined : inArray(commissions.appId, ids.length ? ids : ['']);
	const referralLimit = ids === null ? undefined : inArray(referrals.appId, ids.length ? ids : ['']);
	const claimLimit =
		ids === null ? undefined : inArray(referralClaims.appId, ids.length ? ids : ['']);
	const appLimit = ids === null ? undefined : inArray(apps.id, ids.length ? ids : ['']);

	const [affiliateRows, claimRows, referralRows, commissionRows, payoutRows, appRows] =
		await Promise.all([
			db.select({ status: affiliates.status, value: count() }).from(affiliates).groupBy(affiliates.status),
			db
				.select({ value: count() })
				.from(referralClaims)
				.where(and(eq(referralClaims.status, 'pending'), claimLimit)),
			db
				.select({ value: count() })
				.from(referrals)
				.where(and(eq(referrals.status, 'active'), referralLimit)),
			db
				.select({
					status: commissions.status,
					total: sum(commissions.amountCents),
					revenue: sum(commissions.grossAmountCents)
				})
				.from(commissions)
				.where(commissionLimit)
				.groupBy(commissions.status),
			db.select({ status: payouts.status, total: sum(payouts.amountCents) }).from(payouts).groupBy(payouts.status),
			db.select({ value: count() }).from(apps).where(and(eq(apps.status, 'active'), appLimit))
		]);

	const affiliateBy = new Map(affiliateRows.map((r) => [r.status, zero(r.value)]));
	const commissionBy = new Map(commissionRows.map((r) => [r.status, zero(r.total)]));
	const payoutBy = new Map(payoutRows.map((r) => [r.status, zero(r.total)]));

	return {
		affiliatesTotal: affiliateRows.reduce((a, r) => a + zero(r.value), 0),
		affiliatesPending: affiliateBy.get('pending') ?? 0,
		claimsPending: zero(claimRows[0]?.value),
		referralsActive: zero(referralRows[0]?.value),
		commissionsPendingCents: commissionBy.get('pending') ?? 0,
		commissionsApprovedCents: commissionBy.get('approved') ?? 0,
		payoutsDueCents: commissionBy.get('approved') ?? 0,
		paidLifetimeCents: payoutBy.get('paid') ?? 0,
		revenueLifetimeCents: commissionRows.reduce((a, r) => a + zero(r.revenue), 0),
		appsActive: zero(appRows[0]?.value)
	};
}

/** Affiliates with cleared commissions above their own minimum. */
export async function affiliatesReadyForPayout(db: DrizzleClient) {
	const rows = await db
		.select({
			affiliateId: affiliates.id,
			name: users.name,
			email: users.email,
			refCode: affiliates.refCode,
			minPayoutCents: affiliates.minPayoutCents,
			payoutMethod: affiliates.payoutMethod,
			payoutEmail: affiliates.payoutEmail,
			dueCents: sql<number>`coalesce(sum(${commissions.amountCents}), 0)`,
			lineCount: sql<number>`count(${commissions.id})`
		})
		.from(affiliates)
		.innerJoin(users, eq(users.id, affiliates.userId))
		.innerJoin(
			commissions,
			and(
				eq(commissions.affiliateId, affiliates.id),
				eq(commissions.status, 'approved'),
				sql`${commissions.payoutId} is null`
			)
		)
		.where(eq(affiliates.status, 'approved'))
		.groupBy(affiliates.id)
		.orderBy(desc(sql`coalesce(sum(${commissions.amountCents}), 0)`));

	return rows
		.map((r) => ({ ...r, dueCents: zero(r.dueCents), lineCount: zero(r.lineCount) }))
		.filter((r) => r.dueCents > 0);
}

export async function commissionsForApps(db: DrizzleClient, appIds: string[]) {
	if (!appIds.length) return [];
	return db
		.select({
			appId: commissions.appId,
			total: sql<number>`coalesce(sum(${commissions.amountCents}), 0)`
		})
		.from(commissions)
		.where(inArray(commissions.appId, appIds))
		.groupBy(commissions.appId);
}

/* ------------------------------------------------------------- app revenue */

export type RevenueTotals = {
	grossCents: number;
	netCents: number;
	shopifyFeeCents: number;
	thisMonthGrossCents: number;
	lastMonthGrossCents: number;
	transactionCount: number;
};

const monthStart = (offset = 0) => {
	const d = new Date();
	return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1));
};

/** Revenue across every app the caller can see, referred or not. */
export async function revenueTotals(db: DrizzleClient, scope: AppScope = null): Promise<RevenueTotals> {
	const thisMonth = monthStart();
	const lastMonth = monthStart(-1);
	const ids = scopeIds(scope);
	const limit = ids === null ? undefined : inArray(transactions.appId, ids.length ? ids : ['']);

	const [totals, current, previous] = await Promise.all([
		db
			.select({
				gross: sql<number>`coalesce(sum(${transactions.grossAmountCents}), 0)`,
				net: sql<number>`coalesce(sum(${transactions.netAmountCents}), 0)`,
				value: count()
			})
			.from(transactions)
			.where(limit),
		db
			.select({ gross: sql<number>`coalesce(sum(${transactions.grossAmountCents}), 0)` })
			.from(transactions)
			.where(and(gte(transactions.occurredAt, thisMonth), limit)),
		db
			.select({ gross: sql<number>`coalesce(sum(${transactions.grossAmountCents}), 0)` })
			.from(transactions)
			.where(
				and(gte(transactions.occurredAt, lastMonth), lte(transactions.occurredAt, thisMonth), limit)
			)
	]);

	const grossCents = zero(totals[0]?.gross);
	const netCents = zero(totals[0]?.net);

	return {
		grossCents,
		netCents,
		shopifyFeeCents: Math.max(0, grossCents - netCents),
		thisMonthGrossCents: zero(current[0]?.gross),
		lastMonthGrossCents: zero(previous[0]?.gross),
		transactionCount: zero(totals[0]?.value)
	};
}

export type AppRevenueRow = {
	appId: string;
	name: string;
	slug: string;
	iconUrl: string | null;
	status: string;
	grossCents: number;
	netCents: number;
	thisMonthGrossCents: number;
	activeInstalls: number;
	totalInstalls: number;
	churnedInstalls: number;
	commissionCents: number;
};

/** Revenue and install counts per app. Drives the per-app dashboard table. */
export async function revenueByApp(
	db: DrizzleClient,
	scope: AppScope = null
): Promise<AppRevenueRow[]> {
	const thisMonth = Math.floor(monthStart().getTime() / 1000);
	const ids = scopeIds(scope);

	const rows = await db
		.select({
			appId: apps.id,
			name: apps.name,
			slug: apps.slug,
			iconUrl: apps.iconUrl,
			status: apps.status,
			grossCents: sql<number>`(
				select coalesce(sum(t.gross_amount_cents), 0) from transactions t where t.app_id = apps.id
			)`,
			netCents: sql<number>`(
				select coalesce(sum(t.net_amount_cents), 0) from transactions t where t.app_id = apps.id
			)`,
			thisMonthGrossCents: sql<number>`(
				select coalesce(sum(t.gross_amount_cents), 0) from transactions t
				where t.app_id = apps.id and t.occurred_at >= ${thisMonth}
			)`,
			activeInstalls: sql<number>`(
				select count(*) from installs i where i.app_id = apps.id and i.status = 'installed'
			)`,
			totalInstalls: sql<number>`(select count(*) from installs i where i.app_id = apps.id)`,
			churnedInstalls: sql<number>`(
				select count(*) from installs i where i.app_id = apps.id and i.status = 'uninstalled'
			)`,
			commissionCents: sql<number>`(
				select coalesce(sum(c.amount_cents), 0) from commissions c where c.app_id = apps.id
			)`
		})
		.from(apps)
		.where(ids === null ? undefined : inArray(apps.id, ids.length ? ids : ['']))
		.orderBy(apps.name);

	return rows.map((r) => ({
		...r,
		grossCents: zero(r.grossCents),
		netCents: zero(r.netCents),
		thisMonthGrossCents: zero(r.thisMonthGrossCents),
		activeInstalls: zero(r.activeInstalls),
		totalInstalls: zero(r.totalInstalls),
		churnedInstalls: zero(r.churnedInstalls),
		commissionCents: zero(r.commissionCents)
	}));
}

/** Gross revenue by month for the dashboard chart. */
export async function revenueSeries(db: DrizzleClient, scope: AppScope = null, months = 12) {
	const from = new Date();
	from.setUTCMonth(from.getUTCMonth() - (months - 1), 1);
	from.setUTCHours(0, 0, 0, 0);
	const ids = scopeIds(scope);

	const rows = await db
		.select({
			period: sql<string>`strftime('%Y-%m', ${transactions.occurredAt}, 'unixepoch')`,
			gross: sql<number>`coalesce(sum(${transactions.grossAmountCents}), 0)`,
			net: sql<number>`coalesce(sum(${transactions.netAmountCents}), 0)`
		})
		.from(transactions)
		.where(
			and(
				gte(transactions.occurredAt, from),
				ids === null ? undefined : inArray(transactions.appId, ids.length ? ids : [''])
			)
		)
		.groupBy(sql`strftime('%Y-%m', ${transactions.occurredAt}, 'unixepoch')`)
		.orderBy(sql`strftime('%Y-%m', ${transactions.occurredAt}, 'unixepoch')`);

	return rows.map((r) => ({ period: r.period, gross: zero(r.gross), net: zero(r.net) }));
}

export type MerchantTotals = {
	total: number;
	activeInstalls: number;
	churnedInstalls: number;
	newThisMonth: number;
	withEmail: number;
};

export async function merchantTotals(
	db: DrizzleClient,
	scope: AppScope = null
): Promise<MerchantTotals> {
	const thisMonth = monthStart();
	const ids = scopeIds(scope);
	const installLimit = ids === null ? undefined : inArray(installs.appId, ids.length ? ids : ['']);

	// Scoped counts go through installs, so a staff member only counts merchants
	// of the apps they can see.
	const scopedMerchants = sql`exists (
		select 1 from installs i where i.merchant_id = merchants.id
		and ${scopeSql(scope, 'i.app_id')}
	)`;

	const [total, byStatus, recent, contactable] = await Promise.all([
		db.select({ value: count() }).from(merchants).where(ids === null ? undefined : scopedMerchants),
		db
			.select({ status: installs.status, value: count() })
			.from(installs)
			.where(installLimit)
			.groupBy(installs.status),
		db
			.select({ value: count() })
			.from(merchants)
			.where(
				ids === null
					? gte(merchants.firstSeenAt, thisMonth)
					: and(gte(merchants.firstSeenAt, thisMonth), scopedMerchants)
			),
		db
			.select({ value: count() })
			.from(merchants)
			.where(
				ids === null
					? sql`${merchants.email} is not null and ${merchants.email} != ''`
					: and(sql`${merchants.email} is not null and ${merchants.email} != ''`, scopedMerchants)
			)
	]);

	const statuses = new Map(byStatus.map((r) => [r.status, zero(r.value)]));

	return {
		total: zero(total[0]?.value),
		activeInstalls: statuses.get('installed') ?? 0,
		churnedInstalls: statuses.get('uninstalled') ?? 0,
		newThisMonth: zero(recent[0]?.value),
		withEmail: zero(contactable[0]?.value)
	};
}
