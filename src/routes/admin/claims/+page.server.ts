import { fail } from '@sveltejs/kit';
import { and, desc, eq } from 'drizzle-orm';
import { requireAffiliateVisibility, requireOwner, appScopeFilter } from '$lib/server/scope';
import { affiliates, apps, auditLog, referralClaims, users } from '$lib/server/db/schema';
import { attributeReferral } from '$lib/server/services/referral';
import { sendClaimReviewedEmail } from '$lib/server/email';
import type { Actions, PageServerLoad } from './$types';

const STATUSES = ['pending', 'approved', 'rejected'] as const;

export const load: PageServerLoad = async (event) => {
	const scope = await requireAffiliateVisibility(event);
	const scopeFilter = appScopeFilter(scope, referralClaims.appId);

	const statusParam = event.url.searchParams.get('status') ?? 'pending';
	const status = (STATUSES as readonly string[]).includes(statusParam)
		? (statusParam as (typeof STATUSES)[number])
		: 'pending';

	const claims = await event.locals.db
		.select({
			id: referralClaims.id,
			shopDomain: referralClaims.shopDomain,
			referralDate: referralClaims.referralDate,
			note: referralClaims.note,
			status: referralClaims.status,
			reviewNote: referralClaims.reviewNote,
			reviewedAt: referralClaims.reviewedAt,
			createdAt: referralClaims.createdAt,
			appName: apps.name,
			affiliateId: affiliates.id,
			refCode: affiliates.refCode,
			affiliateName: users.name,
			affiliateEmail: users.email
		})
		.from(referralClaims)
		.innerJoin(apps, eq(apps.id, referralClaims.appId))
		.innerJoin(affiliates, eq(affiliates.id, referralClaims.affiliateId))
		.innerJoin(users, eq(users.id, affiliates.userId))
		.where(
			scopeFilter ? and(eq(referralClaims.status, status), scopeFilter) : eq(referralClaims.status, status)
		)
		.orderBy(desc(referralClaims.createdAt))
		.limit(200);

	return { claims, status, canWrite: scope.canWrite };
};

export const actions: Actions = {
	approve: async (event) => {
		const admin = await requireOwner(event);
		const data = await event.request.formData();
		const id = String(data.get('id') ?? '');
		const note = String(data.get('note') ?? '').trim() || null;

		const [claim] = await event.locals.db
			.select({ claim: referralClaims, email: users.email })
			.from(referralClaims)
			.innerJoin(affiliates, eq(affiliates.id, referralClaims.affiliateId))
			.innerJoin(users, eq(users.id, affiliates.userId))
			.where(eq(referralClaims.id, id))
			.limit(1);

		if (!claim) return fail(404, { error: 'Claim not found.' });
		if (claim.claim.status !== 'pending') return fail(409, { error: 'That claim was already reviewed.' });

		const result = await attributeReferral(event.locals.db, {
			affiliateId: claim.claim.affiliateId,
			appId: claim.claim.appId,
			shopDomain: claim.claim.shopDomain,
			source: 'claim',
			claimId: claim.claim.id
		});

		if (!result.ok) return fail(409, { error: result.error });

		await event.locals.db
			.update(referralClaims)
			.set({
				status: 'approved',
				reviewedAt: new Date(),
				reviewedBy: admin.userId,
				reviewNote: note,
				referralId: result.referral.id,
				updatedAt: new Date()
			})
			.where(eq(referralClaims.id, id));

		await event.locals.db.insert(auditLog).values({
			actorUserId: admin.userId,
			action: 'claim.approve',
			entityType: 'claim',
			entityId: id,
			metadata: { shopDomain: claim.claim.shopDomain, referralId: result.referral.id }
		});

		await sendClaimReviewedEmail(
			event.platform!.env,
			claim.email,
			claim.claim.shopDomain,
			true,
			note
		);

		return { success: true, message: `${claim.claim.shopDomain} attributed.` };
	},

	reject: async (event) => {
		const admin = await requireOwner(event);
		const data = await event.request.formData();
		const id = String(data.get('id') ?? '');
		const note = String(data.get('note') ?? '').trim() || null;

		const [claim] = await event.locals.db
			.select({ claim: referralClaims, email: users.email })
			.from(referralClaims)
			.innerJoin(affiliates, eq(affiliates.id, referralClaims.affiliateId))
			.innerJoin(users, eq(users.id, affiliates.userId))
			.where(eq(referralClaims.id, id))
			.limit(1);

		if (!claim) return fail(404, { error: 'Claim not found.' });
		if (claim.claim.status !== 'pending') return fail(409, { error: 'That claim was already reviewed.' });

		await event.locals.db
			.update(referralClaims)
			.set({
				status: 'rejected',
				reviewedAt: new Date(),
				reviewedBy: admin.userId,
				reviewNote: note,
				updatedAt: new Date()
			})
			.where(eq(referralClaims.id, id));

		await event.locals.db.insert(auditLog).values({
			actorUserId: admin.userId,
			action: 'claim.reject',
			entityType: 'claim',
			entityId: id,
			metadata: { shopDomain: claim.claim.shopDomain, note }
		});

		await sendClaimReviewedEmail(
			event.platform!.env,
			claim.email,
			claim.claim.shopDomain,
			false,
			note
		);

		return { success: true, message: 'Claim rejected.' };
	}
};
