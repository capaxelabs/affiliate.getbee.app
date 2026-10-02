import { fail } from '@sveltejs/kit';
import { and, count, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { requireAdminAccess, requireOwner, scopeCoversApp } from '$lib/server/scope';
import { appReviews, apps, auditLog, installs, merchants } from '$lib/server/db/schema';
import { normalizeShopDomain } from '$lib/server/services/referral';
import type { Actions, PageServerLoad } from './$types';

const PAGE_SIZE = 25;

export const load: PageServerLoad = async (event) => {
	const scope = await requireAdminAccess(event);
	const db = event.locals.db;
	const params = event.url.searchParams;

	const requested = params.get('app') ?? '';
	const appId = requested && scopeCoversApp(scope, requested) ? requested : '';
	const rating = Number(params.get('rating') ?? 0);
	const show = params.get('show') ?? '';

	const filters = [
		appId
			? eq(appReviews.appId, appId)
			: scope.appIds === null
				? undefined
				: inArray(appReviews.appId, scope.appIds.length ? scope.appIds : [''])
	];
	if (rating >= 1 && rating <= 5) filters.push(eq(appReviews.rating, rating));
	if (show === 'unreplied') filters.push(eq(appReviews.replied, false), isNull(appReviews.removedAt));
	if (show === 'removed') filters.push(isNotNull(appReviews.removedAt));
	if (show === 'unmatched') filters.push(isNull(appReviews.merchantId), isNull(appReviews.removedAt));
	const where = and(...filters);

	const [{ value: total }] = await db.select({ value: count() }).from(appReviews).where(where);
	const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
	const page = Math.min(pageCount, Math.max(1, Number(params.get('page') ?? 1) || 1));

	const [rows, appRows, summary] = await Promise.all([
		db
			.select({
				review: appReviews,
				appName: apps.name,
				shopDomain: merchants.shopDomain
			})
			.from(appReviews)
			.innerJoin(apps, eq(apps.id, appReviews.appId))
			.leftJoin(merchants, eq(merchants.id, appReviews.merchantId))
			.where(where)
			.orderBy(desc(sql`coalesce(${appReviews.postedAt}, ${appReviews.firstSeenAt})`))
			.limit(PAGE_SIZE)
			.offset((page - 1) * PAGE_SIZE),
		db
			.select({
				id: apps.id,
				name: apps.name,
				ratingHundredths: apps.ratingHundredths,
				reviewCount: apps.reviewCount
			})
			.from(apps)
			.where(scope.appIds === null ? undefined : inArray(apps.id, scope.appIds.length ? scope.appIds : ['']))
			.orderBy(apps.name),
		db
			.select({ rating: appReviews.rating, value: count() })
			.from(appReviews)
			.where(and(filters[0], isNull(appReviews.removedAt)))
			.groupBy(appReviews.rating)
	]);

	return {
		canWrite: scope.role === 'admin',
		reviews: rows.map((r) => ({ ...r.review, appName: r.appName, shopDomain: r.shopDomain })),
		apps: appRows,
		distribution: [5, 4, 3, 2, 1].map((n) => ({
			rating: n,
			count: Number(summary.find((s) => s.rating === n)?.value ?? 0)
		})),
		filters: { appId, rating: rating >= 1 && rating <= 5 ? String(rating) : '', show },
		page,
		pageCount,
		total,
		pageSize: PAGE_SIZE
	};
};

export const actions: Actions = {
	/** Links a review to a merchant by shop domain, or clears the link. */
	link: async (event) => {
		const owner = await requireOwner(event);
		const db = event.locals.db;
		const form = await event.request.formData();
		const reviewId = String(form.get('reviewId') ?? '');
		const raw = String(form.get('shopDomain') ?? '').trim();

		const [review] = await db.select().from(appReviews).where(eq(appReviews.id, reviewId)).limit(1);
		if (!review) return fail(404, { error: 'Review not found.' });

		let merchantId: string | null = null;
		if (raw) {
			const shopDomain = normalizeShopDomain(raw);
			if (!shopDomain) return fail(400, { error: 'Enter a myshopify.com domain.' });
			const [match] = await db
				.select({ id: merchants.id })
				.from(merchants)
				.innerJoin(installs, and(eq(installs.merchantId, merchants.id), eq(installs.appId, review.appId)))
				.where(eq(merchants.shopDomain, shopDomain))
				.limit(1);
			if (!match) return fail(400, { error: `${shopDomain} has never installed this app.` });
			merchantId = match.id;
		}

		await db
			.update(appReviews)
			.set({ merchantId, matchedBy: merchantId ? 'manual' : null, updatedAt: new Date() })
			.where(eq(appReviews.id, reviewId));
		await db.insert(auditLog).values({
			actorUserId: owner.userId,
			action: merchantId ? 'review.link' : 'review.unlink',
			entityType: 'app_review',
			entityId: reviewId,
			metadata: { shopDomain: raw || null }
		});

		return { success: true, message: merchantId ? 'Review linked.' : 'Link removed.' };
	}
};
