import { and, eq, sql } from 'drizzle-orm';
import type { DrizzleClient } from '$lib/server/db';
import { affiliateApps, affiliates, apps, commissions, referrals } from '$lib/server/db/schema';
import { HOLD_DAYS } from '$lib/constants';

/**
 * Effective rate for an affiliate on an app. Most specific wins:
 * per-app override → affiliate-wide override → the app's default.
 */
export async function resolveCommissionBps(
	db: DrizzleClient,
	affiliateId: string,
	appId: string
): Promise<number> {
	const [row] = await db
		.select({
			appBps: apps.commissionBps,
			affiliateBps: affiliates.commissionBpsOverride,
			pairBps: affiliateApps.commissionBpsOverride,
			enrolled: affiliateApps.enrolled
		})
		.from(apps)
		.leftJoin(affiliates, eq(affiliates.id, affiliateId))
		.leftJoin(
			affiliateApps,
			and(eq(affiliateApps.appId, apps.id), eq(affiliateApps.affiliateId, affiliateId))
		)
		.where(eq(apps.id, appId))
		.limit(1);

	if (!row) throw new Error(`Unknown app ${appId}`);
	return row.pairBps ?? row.affiliateBps ?? row.appBps;
}

/** When commissions stop for a referral created now, or null for lifetime. */
export function commissionEndsAt(commissionMonths: number | null, from = new Date()) {
	if (!commissionMonths) return null;
	const end = new Date(from);
	end.setMonth(end.getMonth() + commissionMonths);
	return end;
}

export function holdUntil(occurredAt: Date) {
	return new Date(occurredAt.getTime() + HOLD_DAYS * 24 * 60 * 60 * 1000);
}

export function commissionAmount(netAmountCents: number, bps: number) {
	return Math.round((netAmountCents * bps) / 10000);
}

export type CommissionInput = {
	referralId: string;
	affiliateId: string;
	appId: string;
	partnerTransactionId?: string | null;
	transactionId?: string | null;
	chargeType: 'recurring' | 'one_time' | 'usage' | 'adjustment' | 'refund';
	currency?: string;
	grossAmountCents: number;
	netAmountCents: number;
	commissionBps: number;
	occurredAt: Date;
	note?: string | null;
};

/**
 * Writes one commission line and rolls the totals onto its referral.
 * Re-running with the same partner transaction id is a no-op.
 */
export async function recordCommission(db: DrizzleClient, input: CommissionInput) {
	const amountCents = commissionAmount(input.netAmountCents, input.commissionBps);

	const inserted = await db
		.insert(commissions)
		.values({
			referralId: input.referralId,
			affiliateId: input.affiliateId,
			appId: input.appId,
			partnerTransactionId: input.partnerTransactionId ?? null,
			transactionId: input.transactionId ?? null,
			chargeType: input.chargeType,
			currency: input.currency ?? 'USD',
			grossAmountCents: input.grossAmountCents,
			netAmountCents: input.netAmountCents,
			commissionBps: input.commissionBps,
			amountCents,
			status: 'pending',
			occurredAt: input.occurredAt,
			availableAt: holdUntil(input.occurredAt),
			note: input.note ?? null
		})
		.onConflictDoNothing({ target: commissions.partnerTransactionId })
		.returning();

	const commission = inserted.at(0);
	if (!commission) return null;

	await db
		.update(referrals)
		.set({
			lifetimeRevenueCents: sql`${referrals.lifetimeRevenueCents} + ${input.grossAmountCents}`,
			lifetimeCommissionCents: sql`${referrals.lifetimeCommissionCents} + ${amountCents}`,
			status: 'active',
			firstChargeAt: sql`coalesce(${referrals.firstChargeAt}, ${Math.floor(input.occurredAt.getTime() / 1000)})`,
			updatedAt: new Date()
		})
		.where(eq(referrals.id, input.referralId));

	return commission;
}

/** Moves held commissions past their hold date to `approved` so they can be paid. */
export async function releaseMaturedCommissions(db: DrizzleClient) {
	const result = await db
		.update(commissions)
		.set({ status: 'approved', updatedAt: new Date() })
		.where(
			and(
				eq(commissions.status, 'pending'),
				sql`${commissions.availableAt} <= unixepoch()`,
				sql`${commissions.amountCents} > 0`
			)
		)
		.returning({ id: commissions.id });

	return result.length;
}
