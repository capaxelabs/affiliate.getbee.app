import { error } from '@sveltejs/kit';
import { and, count, desc, eq, isNotNull, isNull, like, or, sql } from 'drizzle-orm';
import { requireAdminAccess, scopeCoversApp } from '$lib/server/scope';
import { apps, installs, merchants, partnerAccounts } from '$lib/server/db/schema';
import { appLifecycleSeries, revenueByApp, revenueSeries } from '$lib/server/services/stats';
import type { PageServerLoad } from './$types';

/** Merchants per page. Small enough that the page stays quick on D1. */
const PAGE_SIZE = 25;

const STATUSES = ['installed', 'uninstalled'] as const;
const ATTRIBUTION = ['referred', 'organic'] as const;

const oneOf = <T extends readonly string[]>(list: T, value: string | null) =>
	(list as readonly string[]).includes(value ?? '') ? (value as T[number]) : '';

export const load: PageServerLoad = async (event) => {
	const scope = await requireAdminAccess(event);
	const db = event.locals.db;
	const id = event.params.id;

	// A staff member without this app gets the same 404 as a bad id, so the
	// page never confirms that an app they cannot see exists.
	if (!scopeCoversApp(scope, id)) error(404, 'App not found');

	const [row] = await db
		.select({ app: apps, accountName: partnerAccounts.name })
		.from(apps)
		.leftJoin(partnerAccounts, eq(partnerAccounts.id, apps.partnerAccountId))
		.where(eq(apps.id, id))
		.limit(1);

	if (!row) error(404, 'App not found');

	const params = event.url.searchParams;
	const search = params.get('q')?.trim().toLowerCase() ?? '';
	const status = oneOf(STATUSES, params.get('status'));
	const country = params.get('country')?.trim().toUpperCase() ?? '';
	const plan = params.get('plan')?.trim() ?? '';
	// Ignored for staff who cannot see the program — otherwise the filter itself
	// would leak which shops an affiliate brought in.
	const attribution = scope.canViewAffiliates ? oneOf(ATTRIBUTION, params.get('referred')) : '';

	const filters = [eq(installs.appId, id)];
	if (status) filters.push(eq(installs.status, status));
	if (country) filters.push(eq(merchants.country, country));
	if (plan) filters.push(eq(installs.plan, plan));
	if (attribution === 'referred') filters.push(isNotNull(installs.referralId));
	if (attribution === 'organic') filters.push(isNull(installs.referralId));
	if (search) {
		const term = `%${search}%`;
		filters.push(
			or(
				like(merchants.shopDomain, term),
				like(merchants.name, term),
				like(merchants.email, term),
				like(merchants.ownerName, term)
			)!
		);
	}

	const where = and(...filters);
	const filtered = Boolean(search || status || country || plan || attribution);

	// The count has to join merchants too, or a filter on a merchant column
	// would page against a total that ignores it.
	const [{ value: merchantCount }] = await db
		.select({ value: count() })
		.from(installs)
		.innerJoin(merchants, eq(merchants.id, installs.merchantId))
		.where(where);

	const pageCount = Math.max(1, Math.ceil(merchantCount / PAGE_SIZE));
	const requested = Number(params.get('page') ?? 1);
	const page = Math.min(pageCount, Math.max(1, Number.isFinite(requested) ? requested : 1));

	const [revenue, revenue12m, lifecycle, [extras], merchantRows, countries, plans] =
		await Promise.all([
			revenueByApp(db, [id]),
			revenueSeries(db, [id]),
			appLifecycleSeries(db, id),
			// Correlated subqueries have to name the outer table explicitly: drizzle
			// renders select-list columns unqualified, so `apps.id` alone becomes a
			// self-reference and matches every row.
			db
				.select({
					referralCount: sql<number>`(select count(*) from referrals r where r.app_id = apps.id)`,
					clickCount: sql<number>`(
						select count(*) from referral_clicks rc where rc.app_id = apps.id
					)`,
					withEmail: sql<number>`(
						select count(*) from installs i join merchants m on m.id = i.merchant_id
						where i.app_id = apps.id and m.email is not null and m.email <> ''
					)`,
					transactionCount: sql<number>`(
						select count(*) from transactions t where t.app_id = apps.id
					)`
				})
				.from(apps)
				.where(eq(apps.id, id)),
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
					revenueCents: sql<number>`(
						select coalesce(sum(t.gross_amount_cents), 0) from transactions t
						where t.app_id = installs.app_id and t.merchant_id = installs.merchant_id
					)`
				})
				.from(installs)
				.innerJoin(merchants, eq(merchants.id, installs.merchantId))
				.where(where)
				.orderBy(desc(installs.installedAt))
				.limit(PAGE_SIZE)
				.offset((page - 1) * PAGE_SIZE),
			// Dropdown options come from this app's own merchants, not a fixed list,
			// so they can never offer a filter that returns nothing.
			db
				.selectDistinct({ value: merchants.country })
				.from(installs)
				.innerJoin(merchants, eq(merchants.id, installs.merchantId))
				.where(and(eq(installs.appId, id), isNotNull(merchants.country)))
				.orderBy(merchants.country),
			db
				.selectDistinct({ value: installs.plan })
				.from(installs)
				.where(and(eq(installs.appId, id), isNotNull(installs.plan)))
				.orderBy(installs.plan)
		]);

	return {
		app: { ...row.app, ingestKeyEncrypted: undefined },
		accountName: row.accountName,
		canViewAffiliates: scope.canViewAffiliates,
		stats: {
			...revenue[0],
			referralCount: Number(extras?.referralCount ?? 0),
			clickCount: Number(extras?.clickCount ?? 0),
			withEmail: Number(extras?.withEmail ?? 0),
			transactionCount: Number(extras?.transactionCount ?? 0)
		},
		revenueSeries: revenue12m,
		lifecycleSeries: lifecycle,
		merchants: merchantRows.map((m) => ({
			...m,
			// Hide the affiliate link from staff who cannot see the program.
			referralId: scope.canViewAffiliates ? m.referralId : null,
			revenueCents: Number(m.revenueCents ?? 0)
		})),
		countries: countries.map((c) => c.value).filter((v): v is string => Boolean(v)),
		plans: plans.map((p) => p.value).filter((v): v is string => Boolean(v)),
		filters: { search, status, country, plan, attribution, any: filtered },
		page,
		pageCount,
		pageSize: PAGE_SIZE,
		merchantCount
	};
};
