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
 * registered by a webhook before it ever billed anyone. Lets the Partner API
 * sync adopt it instead of creating a duplicate.
 *
 * Resolves by OAuth client id first. The name is a display string that can be
 * changed in the Partner dashboard at any time, and a rename between the
 * webhook and the sync would otherwise leave two records for one app. The name
 * stays as a fallback for apps registered before the client id was recorded.
 */
export async function findAdoptableApp(
	db: DrizzleClient,
	name: string,
	apiKey?: string | null
) {
	const key = apiKey?.trim();

	if (key) {
		const [byKey] = await db
			.select()
			.from(apps)
			.where(and(isNull(apps.partnerAppId), eq(apps.apiKey, key)))
			.limit(1);
		if (byKey) return byKey;
	}

	const [match] = await db
		.select()
		.from(apps)
		.where(and(isNull(apps.partnerAppId), sql`lower(${apps.name}) = lower(${name})`))
		.limit(1);

	return match ?? null;
}

/**
 * Resolves an app the way every ingest endpoint should: by the identifiers that
 * cannot drift, and only then by slug.
 *
 * The OAuth client id and the Partner app id are fixed for the life of an app.
 * The slug is ours and the App Store handle is Shopify's, and either can be
 * renamed — so matching on it alone makes an app disappear the moment it is.
 */
export async function findApp(
	db: DrizzleClient,
	input: { slug: string; apiKey?: string | null; partnerAppId?: string | null }
) {
	const apiKey = input.apiKey?.trim() || null;
	const partnerAppId = input.partnerAppId?.trim() || null;

	if (apiKey) {
		const [byKey] = await db.select().from(apps).where(eq(apps.apiKey, apiKey)).limit(1);
		if (byKey) return byKey;
	}

	if (partnerAppId) {
		const [byPartner] = await db
			.select()
			.from(apps)
			.where(eq(apps.partnerAppId, partnerAppId))
			.limit(1);
		if (byPartner) return byPartner;
	}

	const [bySlug] = await db
		.select()
		.from(apps)
		.where(eq(apps.slug, slugify(input.slug)))
		.limit(1);

	return bySlug ?? null;
}

export type RegisterInput = {
	slug: string;
	name: string;
	/**
	 * The app's OAuth client id (SHOPIFY_API_KEY). The most stable identifier we
	 * can be given: App Store handles and our own slug can both be renamed.
	 */
	apiKey?: string | null;
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

	// Empty strings are not NULL: two of them would collide on the unique index,
	// and an empty key must never match an existing row.
	const apiKey = input.apiKey?.trim() || null;
	const partnerAppIdInput = input.partnerAppId?.trim() || null;

	// Resolve by the most stable identifier available. Matching on the slug first
	// would register a duplicate the moment an app handle is renamed.
	const bySlug = await findApp(db, { slug, apiKey, partnerAppId: partnerAppIdInput });
	if (bySlug) {
		// Backfill identifiers the app has since learned about itself.
		const patch: Record<string, unknown> = {};

		if (partnerAppIdInput && !bySlug.partnerAppId) {
			// Another record may already own this Partner app; claiming it twice
			// would split its revenue across both.
			const [taken] = await db
				.select({ id: apps.id })
				.from(apps)
				.where(eq(apps.partnerAppId, partnerAppIdInput))
				.limit(1);
			if (!taken) patch.partnerAppId = partnerAppIdInput;
		}
		if (apiKey && !bySlug.apiKey) {
			const [taken] = await db
				.select({ id: apps.id })
				.from(apps)
				.where(eq(apps.apiKey, apiKey))
				.limit(1);
			if (!taken) patch.apiKey = apiKey;
		}
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

	const account = input.partnerId ? await accountForPartnerId(db, input.partnerId) : null;

	// Same guard on the insert path.
	let partnerAppId = partnerAppIdInput;
	if (partnerAppId) {
		const [taken] = await db
			.select({ id: apps.id })
			.from(apps)
			.where(eq(apps.partnerAppId, partnerAppId))
			.limit(1);
		if (taken) partnerAppId = null;
	}
	const listing = input.listingUrl
		? { url: input.listingUrl, iconUrl: null }
		: await findListing(slug, input.name);

	const [created] = await db
		.insert(apps)
		.values({
			name: input.name.trim(),
			slug: await uniqueSlug(db, input.name, slug),
			partnerAppId,
			apiKey,
			partnerAccountId: account?.id ?? null,
			listingUrl: listing?.url ?? null,
			iconUrl: listing && 'iconUrl' in listing ? (listing.iconUrl ?? null) : null,
			affiliateEnabled: false,
			source: 'webhook'
		})
		.returning();

	return { app: created, created: true };
}

/**
 * The connected account for a Partner organization id.
 *
 * When the organization is not connected yet, records a placeholder so the admin
 * sees exactly which org to add a token for, instead of the app silently having
 * no account and never syncing. The placeholder is paused and tokenless, and
 * `syncableAccounts` requires both an active status and a stored token, so it is
 * inert until someone finishes connecting it.
 */
async function accountForPartnerId(db: DrizzleClient, partnerId: string) {
	const organizationId = partnerId.trim();
	if (!organizationId) return null;

	const [account] = await db
		.select()
		.from(partnerAccounts)
		.where(eq(partnerAccounts.organizationId, organizationId))
		.limit(1);
	if (account) return account;

	const [placeholder] = await db
		.insert(partnerAccounts)
		.values({
			name: `Partner ${organizationId}`,
			organizationId,
			status: 'paused',
			lastSyncError: 'Reported by an app webhook. Add a Partner Access Token to start syncing.'
		})
		.onConflictDoNothing({ target: partnerAccounts.organizationId })
		.returning();

	return placeholder ?? null;
}
