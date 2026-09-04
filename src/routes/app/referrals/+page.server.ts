import { fail } from '@sveltejs/kit';
import { and, desc, eq, like } from 'drizzle-orm';
import { z } from 'zod';
import { requireAffiliate } from '$lib/server/guards';
import { apps, referralClaims, referrals } from '$lib/server/db/schema';
import { normalizeShopDomain } from '$lib/server/services/referral';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const user = requireAffiliate(event);
	const db = event.locals.db;
	const search = event.url.searchParams.get('q')?.trim().toLowerCase() ?? '';

	const where = search
		? and(eq(referrals.affiliateId, user.affiliateId), like(referrals.shopDomain, `%${search}%`))
		: eq(referrals.affiliateId, user.affiliateId);

	const [rows, claims, activeApps] = await Promise.all([
		db
			.select({
				id: referrals.id,
				shopDomain: referrals.shopDomain,
				shopName: referrals.shopName,
				status: referrals.status,
				source: referrals.source,
				commissionBps: referrals.commissionBps,
				lifetimeCommissionCents: referrals.lifetimeCommissionCents,
				installedAt: referrals.installedAt,
				createdAt: referrals.createdAt,
				appName: apps.name
			})
			.from(referrals)
			.innerJoin(apps, eq(apps.id, referrals.appId))
			.where(where)
			.orderBy(desc(referrals.createdAt))
			.limit(200),
		db
			.select({
				id: referralClaims.id,
				shopDomain: referralClaims.shopDomain,
				status: referralClaims.status,
				referralDate: referralClaims.referralDate,
				reviewNote: referralClaims.reviewNote,
				createdAt: referralClaims.createdAt,
				appName: apps.name
			})
			.from(referralClaims)
			.innerJoin(apps, eq(apps.id, referralClaims.appId))
			.where(eq(referralClaims.affiliateId, user.affiliateId))
			.orderBy(desc(referralClaims.createdAt))
			.limit(50),
		db
			.select({ id: apps.id, name: apps.name })
			.from(apps)
			.where(eq(apps.status, 'active'))
			.orderBy(apps.name)
	]);

	return { referrals: rows, claims, apps: activeApps, search };
};

const claimSchema = z.object({
	appId: z.string().min(1, 'Pick an app.'),
	shopDomain: z.string().min(3, 'Enter the shop domain.'),
	referralDate: z.string().min(1, 'Pick the referral date.'),
	note: z.string().trim().max(2000).optional()
});

export const actions: Actions = {
	claim: async (event) => {
		const user = requireAffiliate(event);

		if (user.affiliateStatus !== 'approved') {
			return fail(403, { error: 'Your account needs to be approved before you can claim.' });
		}

		const data = Object.fromEntries(await event.request.formData());
		const parsed = claimSchema.safeParse(data);
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0].message });
		}

		const shopDomain = normalizeShopDomain(parsed.data.shopDomain);
		if (!shopDomain) {
			return fail(400, { error: 'Enter a valid myshopify.com domain.' });
		}

		const referralDate = new Date(parsed.data.referralDate);
		if (Number.isNaN(referralDate.getTime()) || referralDate > new Date()) {
			return fail(400, { error: 'Pick a referral date in the past.' });
		}

		const [app] = await event.locals.db
			.select({ id: apps.id })
			.from(apps)
			.where(and(eq(apps.id, parsed.data.appId), eq(apps.status, 'active')))
			.limit(1);
		if (!app) return fail(400, { error: 'That app is not in the program.' });

		const [existingReferral] = await event.locals.db
			.select({ affiliateId: referrals.affiliateId })
			.from(referrals)
			.where(and(eq(referrals.appId, app.id), eq(referrals.shopDomain, shopDomain)))
			.limit(1);

		if (existingReferral) {
			return fail(409, {
				error:
					existingReferral.affiliateId === user.affiliateId
						? 'You already have this shop as a referral.'
						: 'This shop is already attributed to another affiliate.'
			});
		}

		const [duplicate] = await event.locals.db
			.select({ id: referralClaims.id })
			.from(referralClaims)
			.where(
				and(
					eq(referralClaims.appId, app.id),
					eq(referralClaims.shopDomain, shopDomain),
					eq(referralClaims.status, 'pending')
				)
			)
			.limit(1);

		if (duplicate) {
			return fail(409, { error: 'There is already a pending claim for this shop.' });
		}

		await event.locals.db.insert(referralClaims).values({
			affiliateId: user.affiliateId,
			appId: app.id,
			shopDomain,
			referralDate,
			note: parsed.data.note || null
		});

		return { success: true, message: `Claim submitted for ${shopDomain}.` };
	}
};
