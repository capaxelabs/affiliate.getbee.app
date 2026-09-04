import { and, desc, eq } from 'drizzle-orm';
import { requireAdminAccess, appScopeFilter } from '$lib/server/scope';
import {
	adminSummary,
	merchantTotals,
	revenueByApp,
	revenueSeries,
	revenueTotals
} from '$lib/server/services/stats';
import { affiliates, apps, referralClaims, referrals, users } from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const scope = await requireAdminAccess(event);
	const db = event.locals.db;
	const referralFilter = appScopeFilter(scope, referrals.appId);
	const claimFilter = appScopeFilter(scope, referralClaims.appId);

	const [
		summary,
		revenue,
		perApp,
		series,
		merchants,
		pendingAffiliates,
		pendingClaims,
		recentReferrals
	] = await Promise.all([
		adminSummary(db, scope.appIds),
		revenueTotals(db, scope.appIds),
		revenueByApp(db, scope.appIds),
		revenueSeries(db, scope.appIds),
		merchantTotals(db, scope.appIds),
		scope.role === 'admin'
			? db
					.select({
						id: affiliates.id,
						name: users.name,
						email: users.email,
						company: affiliates.company,
						createdAt: affiliates.createdAt
					})
					.from(affiliates)
					.innerJoin(users, eq(users.id, affiliates.userId))
					.where(eq(affiliates.status, 'pending'))
					.orderBy(desc(affiliates.createdAt))
					.limit(5)
			: Promise.resolve([]),
		db
			.select({
				id: referralClaims.id,
				shopDomain: referralClaims.shopDomain,
				createdAt: referralClaims.createdAt,
				appName: apps.name,
				email: users.email
			})
			.from(referralClaims)
			.innerJoin(apps, eq(apps.id, referralClaims.appId))
			.innerJoin(affiliates, eq(affiliates.id, referralClaims.affiliateId))
			.innerJoin(users, eq(users.id, affiliates.userId))
			.where(
				claimFilter
					? and(eq(referralClaims.status, 'pending'), claimFilter)
					: eq(referralClaims.status, 'pending')
			)
			.orderBy(desc(referralClaims.createdAt))
			.limit(5),
		db
			.select({
				id: referrals.id,
				shopDomain: referrals.shopDomain,
				status: referrals.status,
				source: referrals.source,
				createdAt: referrals.createdAt,
				appName: apps.name,
				email: users.email
			})
			.from(referrals)
			.innerJoin(apps, eq(apps.id, referrals.appId))
			.innerJoin(affiliates, eq(affiliates.id, referrals.affiliateId))
			.innerJoin(users, eq(users.id, affiliates.userId))
			.where(referralFilter)
			.orderBy(desc(referrals.createdAt))
			.limit(8)
	]);

	// The affiliate queues stay hidden from staff without that permission.
	const showAffiliates = scope.canViewAffiliates;

	return {
		access: { role: scope.role, canViewAffiliates: showAffiliates },
		summary,
		revenue,
		perApp,
		series,
		merchants,
		pendingAffiliates: showAffiliates ? pendingAffiliates : [],
		pendingClaims: showAffiliates ? pendingClaims : [],
		recentReferrals: showAffiliates ? recentReferrals : []
	};
};
