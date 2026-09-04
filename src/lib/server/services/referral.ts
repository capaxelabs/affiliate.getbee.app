import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import type { DrizzleClient } from '$lib/server/db';
import { apps, referralClicks, referrals } from '$lib/server/db/schema';
import { commissionEndsAt, resolveCommissionBps } from './commission';

/** `THE-SHOP.myshopify.com` and `https://the-shop.myshopify.com/` both land here. */
export function normalizeShopDomain(input: string): string | null {
	let value = input.trim().toLowerCase();
	if (!value) return null;

	value = value.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\/$/, '');
	if (!value.includes('.')) value = `${value}.myshopify.com`;

	if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(value)) return null;
	return value;
}

export type AttributionSource = 'click' | 'claim' | 'manual' | 'partner_api';

export type AttributeInput = {
	affiliateId: string;
	appId: string;
	shopDomain: string;
	shopName?: string | null;
	source: AttributionSource;
	clickId?: string | null;
	claimId?: string | null;
	installedAt?: Date | null;
};

export type AttributeResult =
	| { ok: true; referral: typeof referrals.$inferSelect; created: boolean }
	| { ok: false; error: string; existing?: typeof referrals.$inferSelect };

/**
 * Credits a shop to an affiliate for one app. First attribution wins — a shop
 * already attributed to someone else is never silently reassigned.
 */
export async function attributeReferral(
	db: DrizzleClient,
	input: AttributeInput
): Promise<AttributeResult> {
	const shopDomain = normalizeShopDomain(input.shopDomain);
	if (!shopDomain) return { ok: false, error: 'That is not a valid myshopify.com domain.' };

	const [existing] = await db
		.select()
		.from(referrals)
		.where(and(eq(referrals.appId, input.appId), eq(referrals.shopDomain, shopDomain)))
		.limit(1);

	if (existing) {
		if (existing.affiliateId === input.affiliateId) {
			return { ok: true, referral: existing, created: false };
		}
		return {
			ok: false,
			error: 'This shop is already attributed to another affiliate for this app.',
			existing
		};
	}

	const [app] = await db.select().from(apps).where(eq(apps.id, input.appId)).limit(1);
	if (!app) return { ok: false, error: 'Unknown app.' };

	const bps = await resolveCommissionBps(db, input.affiliateId, input.appId);
	const installedAt = input.installedAt ?? null;

	const [referral] = await db
		.insert(referrals)
		.values({
			affiliateId: input.affiliateId,
			appId: input.appId,
			shopDomain,
			shopName: input.shopName ?? null,
			source: input.source,
			clickId: input.clickId ?? null,
			claimId: input.claimId ?? null,
			status: installedAt ? 'active' : 'pending',
			commissionBps: bps,
			commissionEndsAt: commissionEndsAt(app.commissionMonths, installedAt ?? new Date()),
			installedAt
		})
		.returning();

	if (input.clickId) {
		await db
			.update(referralClicks)
			.set({ referralId: referral.id })
			.where(eq(referralClicks.id, input.clickId));
	}

	return { ok: true, referral, created: true };
}

/**
 * The click a merchant actually came from, identified by the ref code their
 * browser carried into the install. Never guesses: without a ref code there is
 * no automatic attribution, only a manual claim.
 */
export async function findClickForRefCode(
	db: DrizzleClient,
	appId: string,
	refCode: string,
	at: Date
) {
	const [click] = await db
		.select()
		.from(referralClicks)
		.where(
			and(
				eq(referralClicks.appId, appId),
				eq(referralClicks.refCode, refCode),
				isNull(referralClicks.referralId),
				gt(referralClicks.expiresAt, at)
			)
		)
		.orderBy(desc(referralClicks.createdAt))
		.limit(1);

	return click ?? null;
}

export function affiliateLink(appUrl: string, refCode: string, appSlug: string) {
	return `${appUrl.replace(/\/$/, '')}/r/${refCode}/${appSlug}`;
}
