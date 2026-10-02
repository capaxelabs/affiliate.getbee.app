import { error, fail } from '@sveltejs/kit';
import { and, count, desc, eq, isNotNull, isNull, like, or, sql } from 'drizzle-orm';
import { requireAdminAccess, requireOwner, scopeCoversApp } from '$lib/server/scope';
import { apps, installs, merchants, partnerAccounts } from '$lib/server/db/schema';
import {
	appChargeList,
	appLifecycleSeries,
	revenueByApp,
	revenueSeries
} from '$lib/server/services/stats';
import { applyHistoryChunk, parseAppHistoryCsv } from '$lib/server/services/history-import';
import { installFunnel, mrrMovement, mrrNow } from '$lib/server/services/metrics';
import type { Actions, PageServerLoad } from './$types';

/** Merchants per page. Small enough that the page stays quick on D1. */
const PAGE_SIZE = 25;

const STATUSES = ['installed', 'uninstalled', 'closed'] as const;
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

	const [
		revenue,
		revenue12m,
		lifecycle,
		charges,
		[extras],
		merchantRows,
		countries,
		plans,
		subscriptions,
		movement,
		funnel
	] = await Promise.all([
			revenueByApp(db, [id]),
			revenueSeries(db, [id]),
			appLifecycleSeries(db, id),
			appChargeList(db, id),
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
				.orderBy(installs.plan),
			mrrNow(db, [id]),
			mrrMovement(db, [id], 12),
			installFunnel(db, id, 6)
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
		subscriptions,
		movement,
		funnel: {
			...funnel,
			// Affiliate clicks are part of the program; hide them with it.
			points: funnel.points.map((p) => ({
				...p,
				affiliateClicks: scope.canViewAffiliates ? p.affiliateClicks : null
			}))
		},
		lifecycleSeries: lifecycle,
		charges,
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

export const actions: Actions = {
	/**
	 * Imports the Partner dashboard's "App history" CSV export.
	 *
	 * The API sync reaches back two years at most; the CSV carries the app's
	 * whole life, so this is how a long-lived app gets its early history in.
	 * The file is re-sent with a growing offset until every shop is applied —
	 * one request cannot hold more than a slice of D1 calls on Workers.
	 */
	importHistory: async (event) => {
		await requireOwner(event);
		const appId = event.params.id;

		const [app] = await event.locals.db
			.select({ id: apps.id, slug: apps.slug })
			.from(apps)
			.where(eq(apps.id, appId))
			.limit(1);
		if (!app) return fail(404, { error: 'App not found.' });

		const form = await event.request.formData();
		const file = form.get('history');
		const offset = Math.max(0, Number(form.get('offset') ?? 0) || 0);

		if (!(file instanceof File) || !file.size) {
			return fail(400, { error: 'Choose the CSV exported from the Partner dashboard.' });
		}
		if (file.size > 20 * 1024 * 1024) {
			return fail(400, { error: 'That file is over 20 MB — not an app-history export.' });
		}

		// The export is named shopify-<app-handle>-app-history-<date>.csv. When
		// the handle in the name belongs to a *different* app we track, this is
		// almost certainly the wrong file picked for the right button — refuse
		// rather than write one app's history onto another.
		const handle = file.name.match(/^shopify-(.+)-app-history/)?.[1];
		if (handle && handle !== app.slug) {
			const [other] = await event.locals.db
				.select({ name: apps.name })
				.from(apps)
				.where(eq(apps.slug, handle))
				.limit(1);
			if (other) {
				return fail(400, {
					error: `That file looks like ${other.name}'s history — import it from that app's page.`
				});
			}
		}

		let parsed;
		try {
			parsed = parseAppHistoryCsv(await file.text());
		} catch (err) {
			return fail(400, { error: err instanceof Error ? err.message : 'Could not parse that file.' });
		}
		if (!parsed.shops.size) {
			return fail(400, { error: 'No usable rows found in that file.' });
		}

		const result = await applyHistoryChunk(event.locals.db, { appId, parsed, offset });
		const done = result.remainingShops === 0;
		const processedSoFar = offset + result.processedShops;

		return {
			success: true,
			done,
			nextOffset: processedSoFar,
			remaining: result.remainingShops,
			message: done
				? `Imported ${parsed.shops.size} shops (${parsed.totalRows} rows, ${parsed.skippedRows} skipped, ${result.internalSkipped} internal).`
				: `${processedSoFar} of ${parsed.shops.size} shops imported — continuing…`
		};
	}
};
