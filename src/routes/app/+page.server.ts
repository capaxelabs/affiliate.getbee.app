import { requireAffiliate } from '$lib/server/guards';
import { affiliateApps, affiliateSummary } from '$lib/server/services/stats';
import { affiliateLink } from '$lib/server/services/referral';
import { eq } from 'drizzle-orm';
import { affiliates } from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const user = requireAffiliate(event);
	const db = event.locals.db;

	const [summary, apps, profile] = await Promise.all([
		affiliateSummary(db, user.affiliateId),
		affiliateApps(db, user.affiliateId),
		db.select({ refCode: affiliates.refCode }).from(affiliates).where(eq(affiliates.id, user.affiliateId)).limit(1)
	]);

	const appUrl = event.platform!.env.APP_URL || event.url.origin;
	const refCode = profile[0]?.refCode ?? '';

	return {
		summary,
		refCode,
		apps: apps.map((app) => ({
			id: app.id,
			name: app.name,
			slug: app.slug,
			iconUrl: app.iconUrl,
			commissionBps: app.commissionBps,
			commissionMonths: app.commissionMonths,
			earnedCents: app.earnedCents,
			referralCount: app.referralCount,
			link: affiliateLink(appUrl, refCode, app.slug)
		}))
	};
};
