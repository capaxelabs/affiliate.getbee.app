import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { DrizzleClient } from '$lib/server/db';
import {
	apps,
	competitorListings,
	keywordPositions,
	listingSnapshots,
	storeKeywords
} from '$lib/server/db/schema';
import { runBatch } from '$lib/server/db/batch';
import { listingHandle, parseReviewsPage } from './reviews';

/**
 * App Store search positions and competitor ratings, read from the public
 * site once a day.
 *
 * The search page loads its results into a Turbo frame, so the frame is
 * requested directly. Every result links to its listing with
 * `surface_type=search` and `surface_intra_position`; that link is what is
 * parsed, not the card markup.
 */

const USER_AGENT = 'BeeAffiliates/1.0 (+https://affiliates.getbee.app)';
/** 24 results a page. Three pages is as deep as anyone scrolls. */
const PAGES = 3;
const PAGE_SIZE = 24;

const today = () => new Date().toISOString().slice(0, 10);

/** Organic results on one search page, in order, as listing handles. */
export function parseSearchResults(html: string) {
	const seen = new Set<string>();
	const results: { handle: string; position: number }[] = [];
	const links = html.matchAll(/href="https:\/\/apps\.shopify\.com\/([a-z0-9-]+)\?([^"]+)"/g);

	for (const [, handle, query] of links) {
		const params = new URLSearchParams(query.replace(/&amp;/g, '&'));
		// Sponsored slots carry their own surface type; only organic rank counts.
		if (params.get('surface_type') !== 'search') continue;
		const position = Number(params.get('surface_intra_position'));
		if (!position || seen.has(handle)) continue;
		seen.add(handle);
		results.push({ handle, position });
	}
	return { results, hasNext: /rel="next"/.test(html) };
}

async function searchPage(keyword: string, page: number) {
	const url = `https://apps.shopify.com/search?q=${encodeURIComponent(keyword)}&page=${page}`;
	const res = await fetch(url, {
		headers: { 'User-Agent': USER_AGENT, Accept: 'text/html', 'Turbo-Frame': 'search_page' }
	});
	if (!res.ok) throw new Error(`App Store search returned ${res.status}`);
	return parseSearchResults(await res.text());
}

/** Handles worth recording: our listed apps and the competitors we follow. */
async function trackedHandles(db: DrizzleClient) {
	const [own, rivals] = await Promise.all([
		db.select({ listingUrl: apps.listingUrl }).from(apps),
		db.select({ handle: competitorListings.handle }).from(competitorListings)
	]);
	return new Set([
		...own.map((a) => listingHandle(a.listingUrl)).filter((h): h is string => Boolean(h)),
		...rivals.map((r) => r.handle)
	]);
}

export async function trackKeywords(db: DrizzleClient) {
	const keywords = await db.select().from(storeKeywords);
	const handles = await trackedHandles(db);
	if (!keywords.length || !handles.size) return { keywords: keywords.length, errors: [] as string[] };

	const day = today();
	const errors: string[] = [];
	const statements: BatchItem<'sqlite'>[] = [];

	for (const keyword of keywords) {
		try {
			const found = new Map<string, number>();
			for (let page = 1; page <= PAGES; page++) {
				const { results, hasNext } = await searchPage(keyword.keyword, page);
				for (const r of results) {
					if (!found.has(r.handle)) found.set(r.handle, (page - 1) * PAGE_SIZE + r.position);
				}
				if (!hasNext || [...handles].every((h) => found.has(h))) break;
			}
			for (const handle of handles) {
				const position = found.get(handle) ?? null;
				statements.push(
					db
						.insert(keywordPositions)
						.values({ keywordId: keyword.id, handle, day, position })
						.onConflictDoUpdate({
							target: [keywordPositions.keywordId, keywordPositions.handle, keywordPositions.day],
							set: { position }
						})
				);
			}
		} catch (error) {
			errors.push(`${keyword.keyword}: ${error instanceof Error ? error.message : error}`);
		}
	}

	await runBatch(db, statements);
	return { keywords: keywords.length, errors };
}

/**
 * Today's rating and review count for every tracked listing. Ours come from
 * the reviews sweep that already ran; competitors' are read from their listing.
 */
export async function snapshotListings(db: DrizzleClient) {
	const day = today();
	const statements: BatchItem<'sqlite'>[] = [];
	const errors: string[] = [];

	const snapshot = (handle: string, rating: number | null, reviewCount: number | null) =>
		db
			.insert(listingSnapshots)
			.values({ handle, day, ratingHundredths: rating, reviewCount })
			.onConflictDoUpdate({
				target: [listingSnapshots.handle, listingSnapshots.day],
				set: { ratingHundredths: rating, reviewCount }
			});

	for (const app of await db.select().from(apps)) {
		const handle = listingHandle(app.listingUrl);
		if (handle && app.reviewCount !== null) {
			statements.push(snapshot(handle, app.ratingHundredths, app.reviewCount));
		}
	}

	for (const rival of await db.select().from(competitorListings)) {
		try {
			const res = await fetch(
				`https://apps.shopify.com/${encodeURIComponent(rival.handle)}/reviews?sort_by=newest&page=1`,
				{ headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' } }
			);
			if (!res.ok) throw new Error(`App Store returned ${res.status}`);
			const html = await res.text();
			const page = parseReviewsPage(html);
			const name = html.match(/"@type":"SoftwareApplication","name":"([^"]+)"/)?.[1] ?? rival.name;

			statements.push(
				db
					.update(competitorListings)
					.set({
						name,
						ratingHundredths: page.ratingHundredths,
						reviewCount: page.reviewCount,
						checkedAt: new Date()
					})
					.where(eq(competitorListings.id, rival.id)),
				snapshot(rival.handle, page.ratingHundredths, page.reviewCount)
			);
		} catch (error) {
			errors.push(`${rival.handle}: ${error instanceof Error ? error.message : error}`);
		}
	}

	await runBatch(db, statements);
	return { errors };
}

export async function addKeyword(db: DrizzleClient, keyword: string) {
	const clean = keyword.trim().toLowerCase().replace(/\s+/g, ' ');
	if (!clean || clean.length > 80) return null;
	await db.insert(storeKeywords).values({ keyword: clean }).onConflictDoNothing();
	return clean;
}

export async function addCompetitor(db: DrizzleClient, input: string) {
	const handle = listingHandle(input.includes('://') ? input : `https://apps.shopify.com/${input.trim()}`);
	if (!handle || !/^[a-z0-9-]+$/.test(handle)) return null;
	await db.insert(competitorListings).values({ handle }).onConflictDoNothing();
	return handle;
}

export type KeywordRow = {
	keywordId: string;
	keyword: string;
	positions: { handle: string; own: boolean; name: string; now: number | null; weekAgo: number | null }[];
};

/** Latest position per keyword and listing, with the change over a week. */
export async function keywordReport(db: DrizzleClient, scope: string[] | null = null) {
	const [keywords, ownApps, rivals] = await Promise.all([
		db.select().from(storeKeywords).orderBy(storeKeywords.keyword),
		db
			.select({ id: apps.id, name: apps.name, listingUrl: apps.listingUrl })
			.from(apps)
			.where(scope === null ? undefined : inArray(apps.id, scope.length ? scope : [''])),
		db.select().from(competitorListings).orderBy(competitorListings.handle)
	]);

	const names = new Map<string, { name: string; own: boolean }>();
	for (const a of ownApps) {
		const h = listingHandle(a.listingUrl);
		if (h) names.set(h, { name: a.name, own: true });
	}
	for (const r of rivals) if (!names.has(r.handle)) names.set(r.handle, { name: r.name ?? r.handle, own: false });

	const since = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
	const history = keywords.length
		? await db
				.select()
				.from(keywordPositions)
				.where(gte(keywordPositions.day, since))
				.orderBy(desc(keywordPositions.day))
		: [];

	const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

	const rows: KeywordRow[] = keywords.map((k) => ({
		keywordId: k.id,
		keyword: k.keyword,
		positions: [...names].map(([handle, meta]) => {
			const mine = history.filter((h) => h.keywordId === k.id && h.handle === handle);
			return {
				handle,
				own: meta.own,
				name: meta.name,
				now: mine[0]?.position ?? null,
				weekAgo: mine.find((h) => h.day <= weekAgo)?.position ?? null
			};
		})
	}));

	const rivalRows = await Promise.all(
		rivals.map(async (r) => {
			const [old] = await db
				.select()
				.from(listingSnapshots)
				.where(
					and(
						eq(listingSnapshots.handle, r.handle),
						gte(listingSnapshots.day, new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10))
					)
				)
				.orderBy(listingSnapshots.day)
				.limit(1);
			return { ...r, reviewsMonthAgo: old?.reviewCount ?? null };
		})
	);

	return { keywords: rows, competitors: rivalRows };
}
