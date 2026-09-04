import { and, desc, eq, like, or, sql } from 'drizzle-orm';
import { requireAdminAccess, appScopeFilter } from '$lib/server/scope';
import { apps, installs, merchants } from '$lib/server/db/schema';
import { merchantTotals } from '$lib/server/services/stats';
import type { PageServerLoad } from './$types';

const STATUSES = ['installed', 'uninstalled'] as const;

export const load: PageServerLoad = async (event) => {
	const scope = await requireAdminAccess(event);
	const db = event.locals.db;

	const search = event.url.searchParams.get('q')?.trim().toLowerCase() ?? '';
	const appId = event.url.searchParams.get('app') ?? '';
	const statusParam = event.url.searchParams.get('status') ?? '';
	const status = (STATUSES as readonly string[]).includes(statusParam) ? statusParam : '';

	const filters = [];
	const scopeFilter = appScopeFilter(scope, installs.appId);
	if (scopeFilter) filters.push(scopeFilter);
	if (appId) filters.push(eq(installs.appId, appId));
	if (status) filters.push(eq(installs.status, status as (typeof STATUSES)[number]));
	if (search) {
		filters.push(
			or(
				like(merchants.shopDomain, `%${search}%`),
				like(merchants.name, `%${search}%`),
				like(merchants.email, `%${search}%`)
			)
		);
	}

	const [rows, allApps, totals] = await Promise.all([
		db
			.select({
				installId: installs.id,
				status: installs.status,
				installedAt: installs.installedAt,
				uninstalledAt: installs.uninstalledAt,
				installCount: installs.installCount,
				uninstallReason: installs.uninstallReason,
				uninstallFeedback: installs.uninstallFeedback,
				plan: installs.plan,
				referralId: installs.referralId,
				merchantId: merchants.id,
				shopDomain: merchants.shopDomain,
				shopName: merchants.name,
				email: merchants.email,
				ownerName: merchants.ownerName,
				country: merchants.country,
				shopifyPlan: merchants.shopifyPlan,
				appId: apps.id,
				appName: apps.name,
				revenueCents: sql<number>`(
					select coalesce(sum(t.gross_amount_cents), 0) from transactions t
					where t.app_id = installs.app_id and t.merchant_id = installs.merchant_id
				)`
			})
			.from(installs)
			.innerJoin(merchants, eq(merchants.id, installs.merchantId))
			.innerJoin(apps, eq(apps.id, installs.appId))
			.where(filters.length ? and(...filters) : undefined)
			.orderBy(desc(installs.installedAt))
			.limit(200),
		db
			.select({ id: apps.id, name: apps.name })
			.from(apps)
			.where(appScopeFilter(scope, apps.id))
			.orderBy(apps.name),
		merchantTotals(db, scope.appIds)
	]);

	return {
		canViewAffiliates: scope.canViewAffiliates,
		installs: rows.map((r) => ({
			...r,
			// Hide the affiliate link from staff who cannot see the program.
			referralId: scope.canViewAffiliates ? r.referralId : null,
			revenueCents: Number(r.revenueCents ?? 0)
		})),
		apps: allApps,
		totals,
		search,
		appId,
		status
	};
};
