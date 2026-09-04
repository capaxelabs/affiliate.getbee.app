import { and, eq, sql } from 'drizzle-orm';
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
	let reinstall = false;

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
		reinstall = existing.status === 'uninstalled';

		await db
			.update(installs)
			.set({
				status: 'installed',
				installedAt: reinstall ? installedAt : existing.installedAt,
				uninstalledAt: null,
				uninstallReason: null,
				uninstallFeedback: null,
				installCount: reinstall ? existing.installCount + 1 : existing.installCount,
				plan: options.plan ?? existing.plan,
				referralId: options.referralId ?? existing.referralId,
				updatedAt: new Date()
			})
			.where(eq(installs.id, existing.id));
	}

	// A repeat webhook for an install we already have is not an event.
	if (firstInstall || reinstall) {
		await db.insert(installEvents).values({
			installId,
			appId: options.appId,
			merchantId: merchant.id,
			type: reinstall ? 'reinstalled' : 'installed',
			source: options.source ?? 'ingest',
			metadata: { plan: options.plan ?? null },
			occurredAt: installedAt
		});

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
		source?: 'ingest' | 'partner_api' | 'manual';
	}
) {
	const shopDomain = normalizeShopDomain(options.shopDomain);
	if (!shopDomain) return null;

	const [row] = await db
		.select({ install: installs, merchant: merchants })
		.from(installs)
		.innerJoin(merchants, eq(merchants.id, installs.merchantId))
		.where(and(eq(installs.appId, options.appId), eq(merchants.shopDomain, shopDomain)))
		.limit(1);

	if (!row) return null;

	const uninstalledAt = options.uninstalledAt ?? new Date();
	const alreadyUninstalled = row.install.status === 'uninstalled';

	await db
		.update(installs)
		.set({
			status: 'uninstalled',
			uninstalledAt,
			uninstallReason: options.reason ?? row.install.uninstallReason,
			uninstallFeedback: options.feedback ?? row.install.uninstallFeedback,
			updatedAt: new Date()
		})
		.where(eq(installs.id, row.install.id));

	await db.insert(installEvents).values({
		installId: row.install.id,
		appId: options.appId,
		merchantId: row.merchant.id,
		type: alreadyUninstalled ? 'feedback' : 'uninstalled',
		source: options.source ?? 'ingest',
		metadata: { reason: options.reason ?? null, feedback: options.feedback ?? null },
		occurredAt: uninstalledAt
	});

	if (!alreadyUninstalled) {
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
