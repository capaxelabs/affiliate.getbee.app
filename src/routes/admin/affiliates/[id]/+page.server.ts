import { error, fail } from '@sveltejs/kit';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { requireAffiliateVisibility, requireOwner, appScopeFilter } from '$lib/server/scope';
import {
	affiliates,
	apps,
	auditLog,
	commissions,
	payouts,
	referrals,
	users
} from '$lib/server/db/schema';
import { affiliateSummary } from '$lib/server/services/stats';
import { sendAffiliateApprovedEmail, sendAffiliateRejectedEmail } from '$lib/server/email';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const scope = await requireAffiliateVisibility(event);
	const db = event.locals.db;
	const id = event.params.id;
	const referralFilter = appScopeFilter(scope, referrals.appId);
	const commissionFilter = appScopeFilter(scope, commissions.appId);

	const [row] = await db
		.select({ affiliate: affiliates, user: users })
		.from(affiliates)
		.innerJoin(users, eq(users.id, affiliates.userId))
		.where(eq(affiliates.id, id))
		.limit(1);

	if (!row) error(404, 'Affiliate not found');

	const [summary, referralRows, commissionRows, payoutRows] = await Promise.all([
		affiliateSummary(db, id),
		db
			.select({
				id: referrals.id,
				shopDomain: referrals.shopDomain,
				status: referrals.status,
				source: referrals.source,
				commissionBps: referrals.commissionBps,
				lifetimeCommissionCents: referrals.lifetimeCommissionCents,
				createdAt: referrals.createdAt,
				appName: apps.name
			})
			.from(referrals)
			.innerJoin(apps, eq(apps.id, referrals.appId))
			.where(and(eq(referrals.affiliateId, id), referralFilter))
			.orderBy(desc(referrals.createdAt))
			.limit(50),
		db
			.select({
				id: commissions.id,
				amountCents: commissions.amountCents,
				status: commissions.status,
				chargeType: commissions.chargeType,
				occurredAt: commissions.occurredAt,
				appName: apps.name
			})
			.from(commissions)
			.innerJoin(apps, eq(apps.id, commissions.appId))
			.where(and(eq(commissions.affiliateId, id), commissionFilter))
			.orderBy(desc(commissions.occurredAt))
			.limit(50),
		scope.role === 'admin'
			? db
					.select()
					.from(payouts)
					.where(eq(payouts.affiliateId, id))
					.orderBy(desc(payouts.createdAt))
					.limit(20)
			: Promise.resolve([])
	]);

	return {
		canWrite: scope.canWrite,
		// Program-wide totals would leak apps a staff member cannot see.
		showTotals: scope.role === 'admin',
		affiliate: row.affiliate,
		account: { name: row.user.name, email: row.user.email, lastLoginAt: row.user.lastLoginAt },
		summary,
		referrals: referralRows,
		commissions: commissionRows,
		payouts: payoutRows
	};
};

async function setStatus(
	event: Parameters<Actions[string]>[0],
	status: 'approved' | 'rejected' | 'suspended' | 'pending',
	note: string | null
) {
	const admin = await requireOwner(event);
	const id = event.params.id!;

	const [row] = await event.locals.db
		.select({ affiliate: affiliates, user: users })
		.from(affiliates)
		.innerJoin(users, eq(users.id, affiliates.userId))
		.where(eq(affiliates.id, id))
		.limit(1);

	if (!row) return fail(404, { error: 'Affiliate not found.' });

	await event.locals.db
		.update(affiliates)
		.set({
			status,
			reviewedAt: new Date(),
			reviewedBy: admin.userId,
			reviewNote: note,
			updatedAt: new Date()
		})
		.where(eq(affiliates.id, id));

	await event.locals.db.insert(auditLog).values({
		actorUserId: admin.userId,
		action: `affiliate.${status}`,
		entityType: 'affiliate',
		entityId: id,
		metadata: { note }
	});

	const env = event.platform!.env;
	if (status === 'approved') await sendAffiliateApprovedEmail(env, row.user.email, row.user.name);
	if (status === 'rejected') await sendAffiliateRejectedEmail(env, row.user.email, note);

	return { success: true, message: `Affiliate ${status}.` };
}

export const actions: Actions = {
	approve: (event) => setStatus(event, 'approved', null),

	reject: async (event) => {
		const note = String((await event.request.formData()).get('note') ?? '').trim();
		return setStatus(event, 'rejected', note || null);
	},

	suspend: async (event) => {
		const note = String((await event.request.formData()).get('note') ?? '').trim();
		return setStatus(event, 'suspended', note || null);
	},

	reinstate: (event) => setStatus(event, 'approved', null),

	setRate: async (event) => {
		const admin = await requireOwner(event);
		const raw = String((await event.request.formData()).get('commissionPercent') ?? '').trim();

		if (raw === '') {
			await event.locals.db
				.update(affiliates)
				.set({ commissionBpsOverride: null, updatedAt: new Date() })
				.where(eq(affiliates.id, event.params.id));
			return { success: true, message: 'Override cleared — app defaults apply.' };
		}

		const parsed = z.coerce.number().min(0).max(100).safeParse(raw);
		if (!parsed.success) return fail(400, { error: 'Rate must be between 0 and 100.' });

		await event.locals.db
			.update(affiliates)
			.set({ commissionBpsOverride: Math.round(parsed.data * 100), updatedAt: new Date() })
			.where(eq(affiliates.id, event.params.id));

		await event.locals.db.insert(auditLog).values({
			actorUserId: admin.userId,
			action: 'affiliate.set_rate',
			entityType: 'affiliate',
			entityId: event.params.id,
			metadata: { commissionPercent: parsed.data }
		});

		return { success: true, message: `Override set to ${parsed.data}%.` };
	}
};
