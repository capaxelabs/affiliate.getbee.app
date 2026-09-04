import { and, eq, isNull, sql } from 'drizzle-orm';
import type { DrizzleClient } from '$lib/server/db';
import { apps, partnerAccounts } from '$lib/server/db/schema';
import { findListing } from './listing';

/** "Kaching Bundles & Upsells" -> "kaching-bundles-upsells" */
export function slugify(name: string) {
	return (
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 50) || 'app'
	);
}

/** A slug nobody is using yet. */
export async function uniqueSlug(db: DrizzleClient, name: string, preferred?: string) {
	const base = preferred ? slugify(preferred) : slugify(name);

	for (let i = 0; i < 20; i++) {
		const candidate = i === 0 ? base : `${base}-${i + 1}`;
		const [clash] = await db
			.select({ id: apps.id })
			.from(apps)
			.where(eq(apps.slug, candidate))
			.limit(1);
		if (!clash) return candidate;
	}

	return `${base}-${Math.floor(Date.now() / 1000)}`;
}

/**
 * An app that already exists but has no Partner app id yet — typically one
 * registered by a webhook before it ever billed anyone. Matching on name lets
 * the Partner API sync adopt it instead of creating a duplicate.
 */
export async function findAdoptableApp(db: DrizzleClient, name: string) {
	const [match] = await db
		.select()
		.from(apps)
		.where(and(isNull(apps.partnerAppId), sql`lower(${apps.name}) = lower(${name})`))
		.limit(1);

	return match ?? null;
}

export type RegisterInput = {
	slug: string;
	name: string;
	/** Shopify Partner organization id, so the app lands under the right account. */
	partnerId?: string | null;
	/** gid://partners/App/... when the app knows it. */
	partnerAppId?: string | null;
	listingUrl?: string | null;
};

export type RegisterResult = {
	app: typeof apps.$inferSelect;
	created: boolean;
};

/**
 * Looks up an app by slug and registers it if it is new.
 *
 * This is how apps with no billing history get on the books: the Partner API has
 * no field that lists an organization's apps, and `discoverApps` can only see
 * apps that have already billed someone. An app posting its own install webhook
 * announces itself.
 *
 * Registered apps arrive with affiliate participation off, exactly like
 * discovered ones.
 */
export async function findOrRegisterApp(
	db: DrizzleClient,
	input: RegisterInput
): Promise<RegisterResult | null> {
	const slug = slugify(input.slug);

	const [bySlug] = await db.select().from(apps).where(eq(apps.slug, slug)).limit(1);
	if (bySlug) {
		// Backfill identifiers the app has since learned about itself.
		const patch: Record<string, unknown> = {};
		if (input.partnerAppId && !bySlug.partnerAppId) patch.partnerAppId = input.partnerAppId;
		if (input.listingUrl && !bySlug.listingUrl) patch.listingUrl = input.listingUrl;

		if (input.partnerId && !bySlug.partnerAccountId) {
			const account = await accountForPartnerId(db, input.partnerId);
			if (account) patch.partnerAccountId = account.id;
		}

		if (Object.keys(patch).length) {
			patch.updatedAt = new Date();
			const [updated] = await db
				.update(apps)
				.set(patch)
				.where(eq(apps.id, bySlug.id))
				.returning();
			return { app: updated, created: false };
		}

		return { app: bySlug, created: false };
	}

	// A slug on its own is not enough to create a record — a typo would litter
	// the app list. The caller has to supply a name to mean it.
	if (!input.name?.trim()) return null;

	// Same app under a different slug, already known by Partner app id.
	if (input.partnerAppId) {
		const [byPartnerId] = await db
			.select()
			.from(apps)
			.where(eq(apps.partnerAppId, input.partnerAppId))
			.limit(1);
		if (byPartnerId) return { app: byPartnerId, created: false };
	}

	const account = input.partnerId ? await accountForPartnerId(db, input.partnerId) : null;
	const listing = input.listingUrl
		? { url: input.listingUrl, iconUrl: null }
		: await findListing(slug, input.name);

	const [created] = await db
		.insert(apps)
		.values({
			name: input.name.trim(),
			slug: await uniqueSlug(db, input.name, slug),
			partnerAppId: input.partnerAppId ?? null,
			partnerAccountId: account?.id ?? null,
			listingUrl: listing?.url ?? null,
			iconUrl: listing && 'iconUrl' in listing ? (listing.iconUrl ?? null) : null,
			affiliateEnabled: false,
			source: 'webhook'
		})
		.returning();

	return { app: created, created: true };
}

async function accountForPartnerId(db: DrizzleClient, partnerId: string) {
	const [account] = await db
		.select()
		.from(partnerAccounts)
		.where(eq(partnerAccounts.organizationId, partnerId.trim()))
		.limit(1);
	return account ?? null;
}
