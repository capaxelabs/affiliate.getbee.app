import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { DrizzleClient } from '$lib/server/db';
import { apps, installEvents, installs, merchants } from '$lib/server/db/schema';
import { normalizeShopDomain } from './referral';
import { queueLifecycleEmail } from './lifecycle';

export type MerchantProfile = {
	shopDomain: string;
	name?: string | null;
	email?: string | null;
	ownerName?: string | null;
	phone?: string | null;
	primaryDomain?: string | null;
	country?: string | null;
	currency?: string | null;
	timezone?: string | null;
	shopifyPlan?: string | null;
};

/**
 * Creates or refreshes the merchant row for a shop. Only overwrites a field
 * when the caller actually supplied one, so a sparse Partner API record can't
 * blank out richer details the app sent at install time.
 */
export async function upsertMerchant(db: DrizzleClient, profile: MerchantProfile, seenAt = new Date()) {
	const shopDomain = normalizeShopDomain(profile.shopDomain);
	if (!shopDomain) return null;

	const [existing] = await db
		.select()
		.from(merchants)
		.where(eq(merchants.shopDomain, shopDomain))
		.limit(1);

	if (!existing) {
		const [created] = await db
			.insert(merchants)
			.values({
				shopDomain,
				name: profile.name ?? null,
				email: profile.email?.toLowerCase() ?? null,
				ownerName: profile.ownerName ?? null,
				phone: profile.phone ?? null,
				primaryDomain: profile.primaryDomain ?? null,
				country: profile.country ?? null,
				currency: profile.currency ?? null,
				timezone: profile.timezone ?? null,
				shopifyPlan: profile.shopifyPlan ?? null,
				firstSeenAt: seenAt,
				lastSeenAt: seenAt
			})
			.returning();
		return created;
	}

	const patch: Record<string, unknown> = { lastSeenAt: seenAt, updatedAt: new Date() };
	const fields = [
		'name',
		'ownerName',
		'phone',
		'primaryDomain',
		'country',
		'currency',
		'timezone',
		'shopifyPlan'
	] as const;

	for (const field of fields) {
		const value = profile[field];
		if (value !== undefined && value !== null && value !== '') patch[field] = value;
	}
	if (profile.email) patch.email = profile.email.toLowerCase();

	const [updated] = await db
		.update(merchants)
		.set(patch)
		.where(eq(merchants.id, existing.id))
		.returning();

	return updated;
}


/**
 * Records one lifecycle event and rebuilds the install row from the full trail.
 *
 * Installs and uninstalls arrive from two independent places — the Shopify
 * Partner API and each app's own webhook — in no guaranteed order, and the
 * Partner sync deliberately re-reads an overlapping window. Mutating the install
 * row on arrival made the result depend on who got there first: replaying a
 * history the webhook had already summarised inflated `installCount`, and a
 * re-read uninstall appended a duplicate event every run.
 *
 * So the events are the truth and the row is derived. Writing the same event
 * twice is a no-op, and the outcome does not depend on arrival order.
 */
async function applyLifecycleEvent(
	db: DrizzleClient,
	options: {
		installId: string;
		appId: string;
		merchantId: string;
		type: 'installed' | 'uninstalled' | 'feedback' | 'plan_changed';
		occurredAt: Date;
		source: 'ingest' | 'partner_api' | 'manual';
		metadata?: Record<string, unknown> | null;
	}
) {
	const inserted = await db
		.insert(installEvents)
		.values({
			installId: options.installId,
			appId: options.appId,
			merchantId: options.merchantId,
			type: options.type,
			source: options.source,
			metadata: options.metadata ?? null,
			occurredAt: options.occurredAt
		})
		.onConflictDoNothing({
			target: [installEvents.installId, installEvents.type, installEvents.occurredAt]
		})
		.returning();

	const isNew = inserted.length > 0;

	// Only install and uninstall move the state; feedback and plan changes do not.
	if (options.type === 'installed' || options.type === 'uninstalled') {
		await rebuildInstallState(db, options.installId);
	}

	return isNew;
}

/** Derives status, timestamps and install count from the event trail. */
async function rebuildInstallState(db: DrizzleClient, installId: string) {
	const events = await db
		.select({ type: installEvents.type, occurredAt: installEvents.occurredAt })
		.from(installEvents)
		.where(
			and(
				eq(installEvents.installId, installId),
				inArray(installEvents.type, ['installed', 'uninstalled'])
			)
		)
		.orderBy(asc(installEvents.occurredAt));

	if (!events.length) return;

	const installs_ = events.filter((e) => e.type === 'installed');
	const uninstalls = events.filter((e) => e.type === 'uninstalled');
	const latest = events[events.length - 1];

	await db
		.update(installs)
		.set({
			status: latest.type === 'uninstalled' ? 'uninstalled' : 'installed',
			installedAt: installs_.at(-1)?.occurredAt ?? latest.occurredAt,
			uninstalledAt: latest.type === 'uninstalled' ? (uninstalls.at(-1)?.occurredAt ?? null) : null,
			installCount: Math.max(1, installs_.length),
			updatedAt: new Date()
		})
		.where(eq(installs.id, installId));
}

export type RecordInstallResult = {
	merchantId: string;
	installId: string;
	/** false when the same merchant reinstalled an app they had before. */
	firstInstall: boolean;
	reinstall: boolean;
};

/**
 * Records that a merchant installed an app, and queues the welcome email when
 * the app has it switched on. Safe to call twice for one webhook delivery.
 */
export async function recordInstall(
	db: DrizzleClient,
	options: {
		appId: string;
		profile: MerchantProfile;
		installedAt?: Date;
		plan?: string | null;
		referralId?: string | null;
		source?: 'ingest' | 'partner_api' | 'manual';
	}
): Promise<RecordInstallResult | null> {
	const installedAt = options.installedAt ?? new Date();
	const merchant = await upsertMerchant(db, options.profile, installedAt);
	if (!merchant) return null;

	const [existing] = await db
		.select()
		.from(installs)
		.where(and(eq(installs.appId, options.appId), eq(installs.merchantId, merchant.id)))
		.limit(1);

	let installId: string;
	let firstInstall = false;

	if (!existing) {
		const [created] = await db
			.insert(installs)
			.values({
				appId: options.appId,
				merchantId: merchant.id,
				status: 'installed',
				installedAt,
				plan: options.plan ?? null,
				referralId: options.referralId ?? null
			})
			.returning();
		installId = created.id;
		firstInstall = true;
	} else {
		installId = existing.id;

		// Only fields the caller actually supplied; the projection owns the rest.
		const patch: Record<string, unknown> = { updatedAt: new Date() };
		if (options.plan) patch.plan = options.plan;
		if (options.referralId && !existing.referralId) patch.referralId = options.referralId;
		if (Object.keys(patch).length > 1) {
			await db.update(installs).set(patch).where(eq(installs.id, installId));
		}
	}

	const wasUninstalled = existing?.status === 'uninstalled';

	const recorded = await applyLifecycleEvent(db, {
		installId,
		appId: options.appId,
		merchantId: merchant.id,
		type: 'installed',
		occurredAt: installedAt,
		source: options.source ?? 'ingest',
		metadata: { plan: options.plan ?? null }
	});

	// Only queue a welcome for a genuinely new install we have not seen before.
	if (recorded && (firstInstall || wasUninstalled)) {
		const [app] = await db.select().from(apps).where(eq(apps.id, options.appId)).limit(1);
		if (app?.welcomeEmailEnabled && merchant.email) {
			await queueLifecycleEmail(db, {
				installId,
				appId: options.appId,
				merchantId: merchant.id,
				kind: 'welcome',
				toEmail: merchant.email,
				// A short hold keeps the welcome from landing before the app finishes setting up.
				sendAfter: new Date(installedAt.getTime() + 15 * 60 * 1000)
			});
		}
	}

	const reinstall = wasUninstalled;

	return { merchantId: merchant.id, installId, firstInstall, reinstall };
}

/** Records an uninstall and queues the offboarding email when enabled. */
export async function recordUninstall(
	db: DrizzleClient,
	options: {
		appId: string;
		shopDomain: string;
		uninstalledAt?: Date;
		reason?: string | null;
		feedback?: string | null;
		shopName?: string | null;
		source?: 'ingest' | 'partner_api' | 'manual';
		/**
		 * Create the merchant and install when we have no record of the install.
		 * The Partner API reports churn from before our first sync, and dropping
		 * it would leave a hole in the history.
		 */
		createIfMissing?: boolean;
	}
) {
	const shopDomain = normalizeShopDomain(options.shopDomain);
	if (!shopDomain) return null;

	const find = () =>
		db
			.select({ install: installs, merchant: merchants })
			.from(installs)
			.innerJoin(merchants, eq(merchants.id, installs.merchantId))
			.where(and(eq(installs.appId, options.appId), eq(merchants.shopDomain, shopDomain)))
			.limit(1);

	let [row] = await find();

	if (!row && options.createIfMissing) {
		await recordInstall(db, {
			appId: options.appId,
			profile: { shopDomain, name: options.shopName ?? null },
			// The install predates what we can see; date it at the uninstall.
			installedAt: options.uninstalledAt ?? new Date(),
			source: options.source ?? 'partner_api'
		});
		[row] = await find();
	}

	if (!row) return null;

	const uninstalledAt = options.uninstalledAt ?? new Date();
	const source = options.source ?? 'ingest';
	const alreadyUninstalled = row.install.status === 'uninstalled';

	// The app's own exit survey beats Shopify's dropdown, whichever lands first:
	// it is your question, and it carries free text alongside it.
	const reasonPatch: Record<string, unknown> = { updatedAt: new Date() };
	if (options.reason && (source === 'ingest' || !row.install.uninstallReason)) {
		reasonPatch.uninstallReason = options.reason;
	}
	if (options.feedback) reasonPatch.uninstallFeedback = options.feedback;

	if (Object.keys(reasonPatch).length > 1) {
		await db.update(installs).set(reasonPatch).where(eq(installs.id, row.install.id));
	}

	const recorded = await applyLifecycleEvent(db, {
		installId: row.install.id,
		appId: options.appId,
		merchantId: row.merchant.id,
		type: 'uninstalled',
		occurredAt: uninstalledAt,
		source,
		metadata: { reason: options.reason ?? null, feedback: options.feedback ?? null }
	});

	// Feedback arriving after the fact is its own event, not another uninstall.
	if (!recorded && options.feedback) {
		await applyLifecycleEvent(db, {
			installId: row.install.id,
			appId: options.appId,
			merchantId: row.merchant.id,
			type: 'feedback',
			occurredAt: new Date(),
			source,
			metadata: { reason: options.reason ?? null, feedback: options.feedback }
		});
	}

	if (recorded && !alreadyUninstalled) {
		const [app] = await db.select().from(apps).where(eq(apps.id, options.appId)).limit(1);
		if (app?.offboardEmailEnabled && row.merchant.email) {
			await queueLifecycleEmail(db, {
				installId: row.install.id,
				appId: options.appId,
				merchantId: row.merchant.id,
				kind: 'offboard',
				toEmail: row.merchant.email,
				// Give them a beat before asking what went wrong.
				sendAfter: new Date(uninstalledAt.getTime() + 60 * 60 * 1000)
			});
		}
	}

	return { installId: row.install.id, merchantId: row.merchant.id, alreadyUninstalled };
}


/**
 * Applies a whole shop's lifecycle history in one pass.
 *
 * The per-event path costs roughly eight D1 calls, and on Workers every one of
 * those is a subrequest against a hard per-request cap. A two-year backfill of a
 * couple of hundred events blew through it and the request was killed mid-run.
 * Grouping by shop makes the cost scale with shops rather than events: one
 * merchant upsert, one multi-row event insert, one state rebuild.
 */
export async function recordLifecycleHistory(
	db: DrizzleClient,
	options: {
		appId: string;
		profile: MerchantProfile;
		events: {
			type: 'installed' | 'uninstalled';
			occurredAt: Date;
			reason?: string | null;
		}[];
		source?: 'ingest' | 'partner_api' | 'manual';
	}
): Promise<{ merchantId: string; installId: string; inserted: number } | null> {
	if (!options.events.length) return null;

	const ordered = [...options.events].sort(
		(a, b) => a.occurredAt.getTime() - b.occurredAt.getTime()
	);
	const first = ordered[0];
	const last = ordered[ordered.length - 1];

	const merchant = await upsertMerchant(db, options.profile, last.occurredAt);
	if (!merchant) return null;

	const [existing] = await db
		.select()
		.from(installs)
		.where(and(eq(installs.appId, options.appId), eq(installs.merchantId, merchant.id)))
		.limit(1);

	let installId: string;
	if (existing) {
		installId = existing.id;
	} else {
		const [created] = await db
			.insert(installs)
			.values({
				appId: options.appId,
				merchantId: merchant.id,
				status: last.type === 'uninstalled' ? 'uninstalled' : 'installed',
				installedAt: first.occurredAt
			})
			.returning();
		installId = created.id;
	}

	const rows = ordered.map((event) => ({
		installId,
		appId: options.appId,
		merchantId: merchant.id,
		type: event.type,
		source: options.source ?? 'partner_api',
		metadata: event.reason ? { reason: event.reason } : null,
		occurredAt: event.occurredAt
	}));

	// D1 caps bound parameters per query at 100, and each row binds eight. A shop
	// that has cycled dozens of times would blow past that in one statement, so
	// insert in chunks. The unique key still drops anything we already had.
	const ROWS_PER_INSERT = 10;
	let inserted = 0;

	for (let i = 0; i < rows.length; i += ROWS_PER_INSERT) {
		const chunk = await db
			.insert(installEvents)
			.values(rows.slice(i, i + ROWS_PER_INSERT))
			.onConflictDoNothing({
				target: [installEvents.installId, installEvents.type, installEvents.occurredAt]
			})
			.returning({ id: installEvents.id });
		inserted += chunk.length;
	}

	// Shopify's churn reason only fills a blank; the app's own survey wins.
	const latestReason = [...ordered].reverse().find((e) => e.type === 'uninstalled' && e.reason);
	if (latestReason?.reason && !existing?.uninstallReason) {
		await db
			.update(installs)
			.set({ uninstallReason: latestReason.reason, updatedAt: new Date() })
			.where(eq(installs.id, installId));
	}

	await rebuildInstallState(db, installId);

	return { merchantId: merchant.id, installId, inserted };
}

/** Links an install to an affiliate referral once attribution is known. */
export async function linkInstallToReferral(
	db: DrizzleClient,
	appId: string,
	shopDomain: string,
	referralId: string
) {
	const normalized = normalizeShopDomain(shopDomain);
	if (!normalized) return;

	await db
		.update(installs)
		.set({ referralId, updatedAt: new Date() })
		.where(
			and(
				eq(installs.appId, appId),
				eq(
					installs.merchantId,
					sql`(select id from merchants where shop_domain = ${normalized})`
				)
			)
		);
}
