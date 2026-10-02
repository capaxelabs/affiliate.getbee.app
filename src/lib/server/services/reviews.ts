import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { DrizzleClient } from '$lib/server/db';
import { appReviews, apps, installs, merchants } from '$lib/server/db/schema';
import { runBatch } from '$lib/server/db/batch';
import { notify } from './notifications';

/**
 * App Store reviews, read from the public listing. The Partner API has no
 * reviews, so this is the only source.
 *
 * Each run walks the listing newest-first to the last page. Seeing the whole
 * list is what lets a review that vanished be marked removed; a listing too
 * long to walk in one request is still read, but nothing is marked removed.
 */

const USER_AGENT = 'BeeAffiliates/1.0 (+https://affiliates.getbee.app)';
const MAX_PAGES = 20;

export type ParsedReview = {
	reviewKey: string;
	rating: number;
	body: string | null;
	author: string | null;
	country: string | null;
	usage: string | null;
	postedAt: Date | null;
	replied: boolean;
};

export type ParsedPage = {
	reviews: ParsedReview[];
	hasNext: boolean;
	ratingHundredths: number | null;
	reviewCount: number | null;
};

const ENTITIES: Record<string, string> = {
	'&amp;': '&',
	'&lt;': '<',
	'&gt;': '>',
	'&quot;': '"',
	'&#39;': "'",
	'&#x27;': "'",
	'&nbsp;': ' '
};

function text(html: string) {
	return html
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
		.replace(/<[^>]+>/g, '')
		.replace(/&[#a-z0-9]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? e)
		.replace(/[ \t]+/g, ' ')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

/** "October 2, 2026" → that day at midnight UTC. */
function parseDate(value: string) {
	const parsed = new Date(`${value.trim()} UTC`);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * One reviews page. Anchored on the attributes Shopify uses for its own
 * scripts (`data-review-content-id`, `data-truncate-content-copy`,
 * `data-merchant-review-reply`) rather than on styling classes, which change
 * with every redesign.
 */
export function parseReviewsPage(html: string): ParsedPage {
	const starts = [...html.matchAll(/data-review-content-id="(\d+)"/g)];
	const reviews: ParsedReview[] = [];

	for (let i = 0; i < starts.length; i++) {
		const from = starts[i].index!;
		const to = i + 1 < starts.length ? starts[i + 1].index! : html.length;
		const block = html.slice(from, to);

		const rating = Number(block.match(/aria-label="(\d) out of 5 stars"/)?.[1] ?? 0);
		if (!rating) continue;

		const date = block.match(/role="img">[\s\S]*?<\/div>\s*<div[^>]*>\s*([A-Z][a-z]+ \d{1,2}, \d{4})\s*<\/div>/);
		const body = block.match(/data-truncate-content-copy[^>]*>([\s\S]*?)<\/div>/);
		const author = block.match(/<span[^>]*title="([^"]*)"/);
		const after = author ? block.slice(author.index!) : '';
		const meta = [...after.matchAll(/<div>([^<]{2,120})<\/div>/g)].map((m) => text(m[1]));

		reviews.push({
			reviewKey: starts[i][1],
			rating,
			body: body ? text(body[1]) || null : null,
			author: author ? text(author[1]) || null : null,
			country: meta.find((m) => !/using the app/i.test(m)) ?? null,
			usage: meta.find((m) => /using the app/i.test(m)) ?? null,
			postedAt: date ? parseDate(date[1]) : null,
			replied: /id="review-reply-\d+"/.test(block)
		});
	}

	const aggregate = html.match(
		/"aggregateRating":\{[^}]*"ratingValue":([\d.]+)[^}]*"ratingCount":(\d+)/
	);

	return {
		reviews,
		hasNext: /rel="next"/.test(html),
		ratingHundredths: aggregate ? Math.round(Number(aggregate[1]) * 100) : null,
		reviewCount: aggregate ? Number(aggregate[2]) : null
	};
}

/** The listing handle, from a stored `apps.shopify.com/<handle>` URL. */
export function listingHandle(listingUrl: string | null) {
	if (!listingUrl) return null;
	try {
		const url = new URL(listingUrl);
		if (url.hostname !== 'apps.shopify.com') return null;
		return url.pathname.split('/').filter(Boolean)[0] ?? null;
	} catch {
		return null;
	}
}

async function fetchPage(handle: string, page: number) {
	const url = `https://apps.shopify.com/${encodeURIComponent(handle)}/reviews?sort_by=newest&page=${page}`;
	const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' } });
	if (!res.ok) throw new Error(`App Store returned ${res.status} for ${handle}`);
	return parseReviewsPage(await res.text());
}

const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);

export type ReviewSyncResult = {
	appId: string;
	name: string;
	seen: number;
	added: number;
	changed: number;
	removed: number;
	error?: string;
};

export async function syncAppReviews(
	db: DrizzleClient,
	app: typeof apps.$inferSelect
): Promise<ReviewSyncResult> {
	const result: ReviewSyncResult = { appId: app.id, name: app.name, seen: 0, added: 0, changed: 0, removed: 0 };
	const handle = listingHandle(app.listingUrl);
	if (!handle) return { ...result, error: 'No App Store listing URL.' };

	try {
		const parsed: ParsedReview[] = [];
		let complete = false;
		let first: ParsedPage | null = null;

		for (let page = 1; page <= MAX_PAGES; page++) {
			const current = await fetchPage(handle, page);
			first ??= current;
			parsed.push(...current.reviews);
			if (!current.hasNext || !current.reviews.length) {
				complete = true;
				break;
			}
		}
		result.seen = parsed.length;

		const existing = await db.select().from(appReviews).where(eq(appReviews.appId, app.id));
		const byKey = new Map(existing.map((r) => [r.reviewKey, r]));
		const now = new Date();
		const statements: BatchItem<'sqlite'>[] = [];
		const alerts: { key: string; text: string }[] = [];
		const authors = new Map<string, string>();

		for (const review of parsed) {
			const stored = byKey.get(review.reviewKey);
			if (!stored) {
				result.added++;
				statements.push(
					db.insert(appReviews).values({ appId: app.id, ...review, firstSeenAt: now, lastSeenAt: now })
				);
				// The first sweep of an app loads its history; only later ones are news.
				if (existing.length) {
					alerts.push({
						key: `review:${app.id}:${review.reviewKey}`,
						text: `:star: *${app.name}*: new ${stars(review.rating)} review from ${review.author ?? 'a merchant'}${review.body ? `\n> ${review.body.slice(0, 280)}` : ''}`
					});
				}
			} else {
				const changed = stored.rating !== review.rating || (stored.body ?? null) !== review.body;
				if (changed) {
					result.changed++;
					alerts.push({
						key: `review:${app.id}:${review.reviewKey}:${review.rating}:${(review.body ?? '').length}`,
						text: `:pencil2: *${app.name}*: ${review.author ?? 'a merchant'} changed their review from ${stars(stored.rating)} to ${stars(review.rating)}`
					});
				}
				statements.push(
					db
						.update(appReviews)
						.set({ ...review, lastSeenAt: now, removedAt: null, updatedAt: now })
						.where(eq(appReviews.id, stored.id))
				);
			}
			if (review.author) authors.set(review.reviewKey, review.author);
		}

		if (complete) {
			const seen = new Set(parsed.map((r) => r.reviewKey));
			for (const stored of existing) {
				if (seen.has(stored.reviewKey) || stored.removedAt) continue;
				result.removed++;
				statements.push(
					db.update(appReviews).set({ removedAt: now, updatedAt: now }).where(eq(appReviews.id, stored.id))
				);
				alerts.push({
					key: `review-removed:${app.id}:${stored.reviewKey}`,
					text: `:wastebasket: *${app.name}*: the ${stars(stored.rating)} review from ${stored.author ?? 'a merchant'} is no longer on the listing`
				});
			}
		}

		statements.push(
			db
				.update(apps)
				.set({
					ratingHundredths: first?.ratingHundredths ?? app.ratingHundredths,
					reviewCount: first?.reviewCount ?? app.reviewCount,
					reviewsSyncedAt: now,
					updatedAt: now
				})
				.where(eq(apps.id, app.id))
		);

		await runBatch(db, statements);
		await matchReviewAuthors(db, app.id);
		for (const alert of alerts) await notify(db, { ...alert, topic: 'reviews' });

		return result;
	} catch (error) {
		return { ...result, error: error instanceof Error ? error.message : String(error) };
	}
}

/**
 * Links unmatched reviews to a merchant of this app with exactly the same store
 * name. A name shared by two merchants is left alone — a wrong link is worse
 * than none, and it can always be set by hand.
 */
export async function matchReviewAuthors(db: DrizzleClient, appId: string) {
	const unmatched = await db
		.select({ id: appReviews.id, author: appReviews.author })
		.from(appReviews)
		.where(and(eq(appReviews.appId, appId), isNull(appReviews.merchantId)));
	const names = [...new Set(unmatched.map((r) => r.author?.trim().toLowerCase()).filter(Boolean))] as string[];
	if (!names.length) return 0;

	const candidates: { id: string; name: string | null }[] = [];
	for (let i = 0; i < names.length; i += 90) {
		candidates.push(
			...(await db
				.select({ id: merchants.id, name: merchants.name })
				.from(merchants)
				.innerJoin(installs, and(eq(installs.merchantId, merchants.id), eq(installs.appId, appId)))
				.where(inArray(sql`lower(trim(${merchants.name}))`, names.slice(i, i + 90))))
		);
	}

	const byName = new Map<string, string[]>();
	for (const c of candidates) {
		const key = c.name!.trim().toLowerCase();
		byName.set(key, [...(byName.get(key) ?? []), c.id]);
	}

	const statements: BatchItem<'sqlite'>[] = [];
	for (const review of unmatched) {
		const ids = byName.get(review.author?.trim().toLowerCase() ?? '');
		if (ids?.length !== 1) continue;
		statements.push(
			db
				.update(appReviews)
				.set({ merchantId: ids[0], matchedBy: 'name', updatedAt: new Date() })
				.where(eq(appReviews.id, review.id))
		);
	}
	await runBatch(db, statements);
	return statements.length;
}

/** Every app with a listing, one after another — politely, never in parallel. */
export async function syncAllReviews(db: DrizzleClient) {
	const listed = (await db.select().from(apps)).filter((a) => listingHandle(a.listingUrl));
	const results: ReviewSyncResult[] = [];
	for (const app of listed) results.push(await syncAppReviews(db, app));
	return results;
}
