import { fail } from '@sveltejs/kit';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { requireOwner } from '$lib/server/scope';
import { affiliates, auditLog, commissions, payouts, users } from '$lib/server/db/schema';
import { affiliatesReadyForPayout } from '$lib/server/services/stats';
import { sendPayoutPaidEmail } from '$lib/server/email';
import { money } from '$lib/format';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	await requireOwner(event);

	const [ready, history] = await Promise.all([
		affiliatesReadyForPayout(event.locals.db),
		event.locals.db
			.select({
				payout: payouts,
				affiliateName: users.name,
				affiliateEmail: users.email,
				affiliateId: affiliates.id,
				lineCount: sql<number>`(select count(*) from commissions c where c.payout_id = payouts.id)`
			})
			.from(payouts)
			.innerJoin(affiliates, eq(affiliates.id, payouts.affiliateId))
			.innerJoin(users, eq(users.id, affiliates.userId))
			.orderBy(desc(payouts.createdAt))
			.limit(100)
	]);

	return {
		ready,
		payouts: history.map((h) => ({
			...h.payout,
			affiliateId: h.affiliateId,
			affiliateName: h.affiliateName,
			affiliateEmail: h.affiliateEmail,
			lineCount: Number(h.lineCount ?? 0)
		}))
	};
};

export const actions: Actions = {
	/** Bundles every cleared, unpaid commission for one affiliate into a draft payout. */
	create: async (event) => {
		const admin = await requireOwner(event);
		const affiliateId = String((await event.request.formData()).get('affiliateId') ?? '');

		const [affiliate] = await event.locals.db
			.select({ affiliate: affiliates, email: users.email })
			.from(affiliates)
			.innerJoin(users, eq(users.id, affiliates.userId))
			.where(eq(affiliates.id, affiliateId))
			.limit(1);

		if (!affiliate) return fail(404, { error: 'Affiliate not found.' });

		const lines = await event.locals.db
			.select()
			.from(commissions)
			.where(
				and(
					eq(commissions.affiliateId, affiliateId),
					eq(commissions.status, 'approved'),
					isNull(commissions.payoutId)
				)
			);

		if (!lines.length) return fail(409, { error: 'Nothing cleared to pay for this affiliate.' });

		const amountCents = lines.reduce((total, line) => total + line.amountCents, 0);
		if (amountCents <= 0) return fail(409, { error: 'The cleared balance is zero or negative.' });

		if (amountCents < affiliate.affiliate.minPayoutCents) {
			return fail(409, {
				error: `Below their ${money(affiliate.affiliate.minPayoutCents)} minimum.`
			});
		}

		const dates = lines.map((line) => line.occurredAt.getTime());

		const [payout] = await event.locals.db
			.insert(payouts)
			.values({
				affiliateId,
				amountCents,
				currency: lines[0].currency,
				method: affiliate.affiliate.payoutMethod,
				status: 'draft',
				periodStart: new Date(Math.min(...dates)),
				periodEnd: new Date(Math.max(...dates)),
				createdBy: admin.userId
			})
			.returning();

		await event.locals.db
			.update(commissions)
			.set({ payoutId: payout.id, updatedAt: new Date() })
			.where(
				inArray(
					commissions.id,
					lines.map((line) => line.id)
				)
			);

		await event.locals.db.insert(auditLog).values({
			actorUserId: admin.userId,
			action: 'payout.create',
			entityType: 'payout',
			entityId: payout.id,
			metadata: { affiliateId, amountCents, lines: lines.length }
		});

		return { success: true, message: `Draft payout of ${money(amountCents)} created.` };
	},

	markProcessing: async (event) => {
		const admin = await requireOwner(event);
		const data = await event.request.formData();
		const id = String(data.get('id') ?? '');
		const reference = String(data.get('reference') ?? '').trim() || null;

		const updated = await event.locals.db
			.update(payouts)
			.set({ status: 'processing', reference, processedAt: new Date(), updatedAt: new Date() })
			.where(and(eq(payouts.id, id), eq(payouts.status, 'draft')))
			.returning({ id: payouts.id });

		if (!updated.length) return fail(409, { error: 'That payout is not a draft.' });

		await event.locals.db.insert(auditLog).values({
			actorUserId: admin.userId,
			action: 'payout.processing',
			entityType: 'payout',
			entityId: id,
			metadata: { reference }
		});

		return { success: true, message: 'Payout marked as processing.' };
	},

	markPaid: async (event) => {
		const admin = await requireOwner(event);
		const data = await event.request.formData();
		const id = String(data.get('id') ?? '');
		const reference = String(data.get('reference') ?? '').trim() || null;

		const [row] = await event.locals.db
			.select({ payout: payouts, email: users.email })
			.from(payouts)
			.innerJoin(affiliates, eq(affiliates.id, payouts.affiliateId))
			.innerJoin(users, eq(users.id, affiliates.userId))
			.where(eq(payouts.id, id))
			.limit(1);

		if (!row) return fail(404, { error: 'Payout not found.' });
		if (row.payout.status === 'paid') return fail(409, { error: 'Already marked paid.' });

		const paidAt = new Date();
		await event.locals.db
			.update(payouts)
			.set({
				status: 'paid',
				reference: reference ?? row.payout.reference,
				paidAt,
				updatedAt: paidAt
			})
			.where(eq(payouts.id, id));

		await event.locals.db
			.update(commissions)
			.set({ status: 'paid', updatedAt: paidAt })
			.where(eq(commissions.payoutId, id));

		await event.locals.db.insert(auditLog).values({
			actorUserId: admin.userId,
			action: 'payout.paid',
			entityType: 'payout',
			entityId: id,
			metadata: { amountCents: row.payout.amountCents, reference }
		});

		await sendPayoutPaidEmail(
			event.platform!.env,
			row.email,
			money(row.payout.amountCents, row.payout.currency),
			reference ?? row.payout.reference
		);

		return { success: true, message: 'Payout marked paid.' };
	},

	/** Cancels a draft or failed payout and frees its commissions for the next batch. */
	cancel: async (event) => {
		const admin = await requireOwner(event);
		const id = String((await event.request.formData()).get('id') ?? '');

		const [payout] = await event.locals.db
			.select()
			.from(payouts)
			.where(eq(payouts.id, id))
			.limit(1);

		if (!payout) return fail(404, { error: 'Payout not found.' });
		if (payout.status === 'paid') return fail(409, { error: 'A paid payout cannot be cancelled.' });

		await event.locals.db
			.update(commissions)
			.set({ payoutId: null, status: 'approved', updatedAt: new Date() })
			.where(eq(commissions.payoutId, id));

		await event.locals.db.delete(payouts).where(eq(payouts.id, id));

		await event.locals.db.insert(auditLog).values({
			actorUserId: admin.userId,
			action: 'payout.cancel',
			entityType: 'payout',
			entityId: id,
			metadata: { amountCents: payout.amountCents }
		});

		return { success: true, message: 'Payout cancelled and commissions released.' };
	}
};
