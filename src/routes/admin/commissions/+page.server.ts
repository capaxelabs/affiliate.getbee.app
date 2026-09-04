import { fail } from '@sveltejs/kit';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { requireAffiliateVisibility, requireOwner, appScopeFilter } from '$lib/server/scope';
import { affiliates, apps, auditLog, commissions, referrals, users } from '$lib/server/db/schema';
import { releaseMaturedCommissions } from '$lib/server/services/commission';
import type { Actions, PageServerLoad } from './$types';

const STATUSES = ['pending', 'approved', 'paid', 'void'] as const;

export const load: PageServerLoad = async (event) => {
	const scope = await requireAffiliateVisibility(event);
	const scopeFilter = appScopeFilter(scope, commissions.appId);

	const statusParam = event.url.searchParams.get('status') ?? '';
	const status = (STATUSES as readonly string[]).includes(statusParam)
		? (statusParam as (typeof STATUSES)[number])
		: null;

	const [rows, totals] = await Promise.all([
		event.locals.db
			.select({
				id: commissions.id,
				amountCents: commissions.amountCents,
				grossAmountCents: commissions.grossAmountCents,
				netAmountCents: commissions.netAmountCents,
				commissionBps: commissions.commissionBps,
				chargeType: commissions.chargeType,
				status: commissions.status,
				occurredAt: commissions.occurredAt,
				availableAt: commissions.availableAt,
				note: commissions.note,
				appName: apps.name,
				shopDomain: referrals.shopDomain,
				affiliateId: affiliates.id,
				affiliateEmail: users.email,
				affiliateName: users.name
			})
			.from(commissions)
			.innerJoin(apps, eq(apps.id, commissions.appId))
			.innerJoin(referrals, eq(referrals.id, commissions.referralId))
			.innerJoin(affiliates, eq(affiliates.id, commissions.affiliateId))
			.innerJoin(users, eq(users.id, affiliates.userId))
			.where(and(scopeFilter, status ? eq(commissions.status, status) : undefined))
			.orderBy(desc(commissions.occurredAt))
			.limit(200),
		event.locals.db
			.select({ status: commissions.status, total: sql<number>`coalesce(sum(${commissions.amountCents}), 0)` })
			.from(commissions)
			.where(scopeFilter)
			.groupBy(commissions.status)
	]);

	return {
		commissions: rows,
		status: status ?? 'all',
		totals: Object.fromEntries(totals.map((t) => [t.status, Number(t.total ?? 0)])),
		canWrite: scope.canWrite
	};
};

export const actions: Actions = {
	release: async (event) => {
		await requireOwner(event);
		const count = await releaseMaturedCommissions(event.locals.db);
		return {
			success: true,
			message: count ? `${count} commissions cleared for payout.` : 'Nothing was ready to clear.'
		};
	},

	approve: async (event) => {
		const admin = await requireOwner(event);
		const id = String((await event.request.formData()).get('id') ?? '');

		const updated = await event.locals.db
			.update(commissions)
			.set({ status: 'approved', updatedAt: new Date() })
			.where(eq(commissions.id, id))
			.returning({ id: commissions.id });

		if (!updated.length) return fail(404, { error: 'Commission not found.' });

		await event.locals.db.insert(auditLog).values({
			actorUserId: admin.userId,
			action: 'commission.approve',
			entityType: 'commission',
			entityId: id
		});

		return { success: true, message: 'Commission cleared.' };
	},

	void: async (event) => {
		const admin = await requireOwner(event);
		const data = await event.request.formData();
		const id = String(data.get('id') ?? '');
		const note = String(data.get('note') ?? '').trim() || null;

		const [commission] = await event.locals.db
			.select()
			.from(commissions)
			.where(eq(commissions.id, id))
			.limit(1);

		if (!commission) return fail(404, { error: 'Commission not found.' });
		if (commission.status === 'paid') {
			return fail(409, { error: 'Already paid — reverse it with an adjustment instead.' });
		}

		await event.locals.db
			.update(commissions)
			.set({ status: 'void', note, updatedAt: new Date() })
			.where(eq(commissions.id, id));

		// Keep the referral's running totals honest.
		await event.locals.db
			.update(referrals)
			.set({
				lifetimeRevenueCents: sql`max(0, ${referrals.lifetimeRevenueCents} - ${commission.grossAmountCents})`,
				lifetimeCommissionCents: sql`max(0, ${referrals.lifetimeCommissionCents} - ${commission.amountCents})`,
				updatedAt: new Date()
			})
			.where(eq(referrals.id, commission.referralId));

		await event.locals.db.insert(auditLog).values({
			actorUserId: admin.userId,
			action: 'commission.void',
			entityType: 'commission',
			entityId: id,
			metadata: { note, amountCents: commission.amountCents }
		});

		return { success: true, message: 'Commission voided.' };
	},

	adjust: async (event) => {
		const admin = await requireOwner(event);
		const data = Object.fromEntries(await event.request.formData());

		const parsed = z
			.object({
				referralId: z.string().min(1, 'Pick a referral.'),
				amount: z.coerce.number().refine((v) => v !== 0, 'Amount cannot be zero.'),
				note: z.string().trim().min(3, 'Explain the adjustment.').max(500)
			})
			.safeParse(data);

		if (!parsed.success) return fail(400, { error: parsed.error.issues[0].message });

		const [referral] = await event.locals.db
			.select()
			.from(referrals)
			.where(eq(referrals.id, parsed.data.referralId))
			.limit(1);
		if (!referral) return fail(404, { error: 'Referral not found.' });

		const amountCents = Math.round(parsed.data.amount * 100);
		const now = new Date();

		await event.locals.db.insert(commissions).values({
			referralId: referral.id,
			affiliateId: referral.affiliateId,
			appId: referral.appId,
			chargeType: 'adjustment',
			grossAmountCents: 0,
			netAmountCents: 0,
			commissionBps: referral.commissionBps,
			amountCents,
			status: 'approved',
			occurredAt: now,
			availableAt: now,
			note: parsed.data.note
		});

		await event.locals.db.insert(auditLog).values({
			actorUserId: admin.userId,
			action: 'commission.adjust',
			entityType: 'referral',
			entityId: referral.id,
			metadata: { amountCents, note: parsed.data.note }
		});

		return { success: true, message: 'Adjustment recorded.' };
	}
};
