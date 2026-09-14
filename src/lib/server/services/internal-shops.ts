import { eq, inArray } from 'drizzle-orm';
import type { DrizzleClient } from '$lib/server/db';
import { internalShops, merchants } from '$lib/server/db/schema';

/**
 * Domains that are never a merchant whatever the source says.
 *
 * `app-review-*` are the throwaway stores Shopify spins up to run App Store
 * review. `redacted` is what an app posts once Shopify has redacted the shop
 * under the GDPR shop/redact webhook — every app writes to that same string, so
 * it is one row standing in for many unrelated shops rather than a shop at all.
 */
const INTERNAL_DOMAIN = /^(app-review-|redacted\.)/;

/** The address Shopify's reviewers sign their stores up with. */
const INTERNAL_EMAIL = /@shopify\.com$/i;

export function isInternalDomain(shopDomain: string): boolean {
	return INTERNAL_DOMAIN.test(shopDomain);
}

export function isInternalEmail(email: string | null | undefined): boolean {
	return Boolean(email && INTERNAL_EMAIL.test(email.trim()));
}

/**
 * Every remembered domain, as a set.
 *
 * The sync loads this once per run and filters in memory. Checking per shop
 * would be a D1 call each, and on Workers every one of those is a subrequest
 * against a hard per-request cap — the thing that killed the original backfill.
 */
export async function loadInternalShops(db: DrizzleClient): Promise<Set<string>> {
	const rows = await db.select({ shopDomain: internalShops.shopDomain }).from(internalShops);
	return new Set(rows.map((r) => r.shopDomain));
}

/**
 * Remembers a shop as internal, and removes the merchant if one slipped in
 * before we knew.
 *
 * The reviewer's `@shopify.com` address only ever arrives on the app's own
 * install webhook. The Partner sync sees the same store hours later with no
 * email at all, so without this the nightly run would put it straight back.
 */
export async function markInternalShop(
	db: DrizzleClient,
	shopDomain: string,
	reason: typeof internalShops.$inferSelect['reason'] = 'app_review',
	note?: string | null
) {
	await db
		.insert(internalShops)
		.values({ shopDomain, reason, note: note ?? null })
		.onConflictDoNothing({ target: internalShops.shopDomain });

	// Cascades to installs and install_events, so the counts correct themselves
	// the moment a reviewer is recognised.
	await db.delete(merchants).where(eq(merchants.shopDomain, shopDomain));
}

/**
 * True when this shop must not be stored.
 *
 * `known` lets a caller that already holds the list skip the lookup; without it
 * the check costs one query, which is fine on the single-shop ingest path.
 */
export async function isInternalShop(
	db: DrizzleClient,
	shopDomain: string,
	options: { email?: string | null; known?: Set<string> } = {}
): Promise<boolean> {
	if (isInternalDomain(shopDomain)) return true;
	if (options.known) return options.known.has(shopDomain);

	// A reviewer identifying itself for the first time. Remember it before
	// answering, so tonight's Partner sync cannot bring it back.
	if (isInternalEmail(options.email)) {
		await markInternalShop(db, shopDomain, 'app_review', `email ${options.email}`);
		return true;
	}

	const [row] = await db
		.select({ id: internalShops.id })
		.from(internalShops)
		.where(eq(internalShops.shopDomain, shopDomain))
		.limit(1);

	return Boolean(row);
}

/** Bulk check for a set of domains, used when seeding or auditing. */
export async function filterInternal(db: DrizzleClient, domains: string[]): Promise<Set<string>> {
	const internal = new Set(domains.filter(isInternalDomain));
	const rest = domains.filter((d) => !internal.has(d));
	if (!rest.length) return internal;

	// D1 binds one parameter per value and caps a query at 100.
	for (let i = 0; i < rest.length; i += 90) {
		const rows = await db
			.select({ shopDomain: internalShops.shopDomain })
			.from(internalShops)
			.where(inArray(internalShops.shopDomain, rest.slice(i, i + 90)));
		for (const row of rows) internal.add(row.shopDomain);
	}

	return internal;
}
