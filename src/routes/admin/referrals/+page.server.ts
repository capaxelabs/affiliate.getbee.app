import { fail } from '@sveltejs/kit';
import { and, desc, eq, like } from 'drizzle-orm';
import { z } from 'zod';
import { requireAffiliateVisibility, requireOwner, appScopeFilter } from '$lib/server/scope';
import { affiliates, apps, auditLog, referrals, users } from '$lib/server/db/schema';
import { attributeReferral } from '$lib/server/services/referral';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const scope = await requireAffiliateVisibility(event);
	const db = event.locals.db;
	const search = event.url.searchParams.get('q')?.trim().toLowerCase() ?? '';
	const scopeFilter = appScopeFilter(scope, referrals.appId);
	const searchFilter = search ? like(referrals.shopDomain, `%${search}%`) : undefined;

	const [rows, activeApps, approvedAffiliates] = await Promise.all([
		db
			.select({
				id: referrals.id,
				shopDomain: referrals.shopDomain,
				status: referrals.status,
				source: referrals.source,
				commissionBps: referrals.commissionBps,
				lifetimeRevenueCents: referrals.lifetimeRevenueCents,
				lifetimeCommissionCents: referrals.lifetimeCommissionCents,
				installedAt: referrals.installedAt,
				createdAt: referrals.createdAt,
				appName: apps.name,
				affiliateId: affiliates.id,
				affiliateEmail: users.email,
				affiliateName: users.name
			})
			.from(referrals)
			.innerJoin(apps, eq(apps.id, referrals.appId))
			.innerJoin(affiliates, eq(affiliates.id, referrals.affiliateId))
			.innerJoin(users, eq(users.id, affiliates.userId))
			.where(and(scopeFilter, searchFilter))
			.orderBy(desc(referrals.createdAt))
			.limit(200),
		db
			.select({ id: apps.id, name: apps.name })
			.from(apps)
			.where(and(eq(apps.status, 'active'), appScopeFilter(scope, apps.id)))
			.orderBy(apps.name),
		db
			.select({ id: affiliates.id, refCode: affiliates.refCode, email: users.email, name: users.name })
			.from(affiliates)
			.innerJoin(users, eq(users.id, affiliates.userId))
			.where(eq(affiliates.status, 'approved'))
			.orderBy(users.email)
	]);

	return {
		referrals: rows,
		apps: activeApps,
		affiliates: scope.canWrite ? approvedAffiliates : [],
		search,
		canWrite: scope.canWrite
	};
};

const manualSchema = z.object({
	affiliateId: z.string().min(1, 'Pick an affiliate.'),
	appId: z.string().min(1, 'Pick an app.'),
	shopDomain: z.string().min(3, 'Enter the shop domain.')
});

export const actions: Actions = {
	attribute: async (event) => {
		const admin = await requireOwner(event);
		const parsed = manualSchema.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0].message });

		const result = await attributeReferral(event.locals.db, {
			affiliateId: parsed.data.affiliateId,
			appId: parsed.data.appId,
			shopDomain: parsed.data.shopDomain,
			source: 'manual'
		});

		if (!result.ok) return fail(409, { error: result.error });

		await event.locals.db.insert(auditLog).values({
			actorUserId: admin.userId,
			action: 'referral.manual_attribute',
			entityType: 'referral',
			entityId: result.referral.id,
			metadata: { shopDomain: result.referral.shopDomain }
		});

		return {
			success: true,
			message: result.created
				? `${result.referral.shopDomain} attributed.`
				: 'That shop was already attributed to this affiliate.'
		};
	},

	reject: async (event) => {
		const admin = await requireOwner(event);
		const id = String((await event.request.formData()).get('id') ?? '');

		const [referral] = await event.locals.db
			.select()
			.from(referrals)
			.where(eq(referrals.id, id))
			.limit(1);
		if (!referral) return fail(404, { error: 'Referral not found.' });

		await event.locals.db
			.update(referrals)
			.set({ status: 'rejected', updatedAt: new Date() })
			.where(eq(referrals.id, id));

		await event.locals.db.insert(auditLog).values({
			actorUserId: admin.userId,
			action: 'referral.reject',
			entityType: 'referral',
			entityId: id,
			metadata: { shopDomain: referral.shopDomain }
		});

		return { success: true, message: `${referral.shopDomain} rejected — it stops earning.` };
	}
};
