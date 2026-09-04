import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { affiliates, apps } from '$lib/server/db/schema';
import {
	attributeReferral,
	findClickForRefCode,
	normalizeShopDomain
} from '$lib/server/services/referral';
import { recordInstall } from '$lib/server/services/merchant';
import { readSignedBody } from '$lib/server/ingest';
import type { RequestHandler } from './$types';

/**
 * Install ingest for the Bee apps. Each app posts here from its OAuth callback.
 *
 * Two jobs in one call:
 *   1. Record the merchant and the install — always, referred or not. This is
 *      what the merchant list, lifecycle email and churn numbers run on.
 *   2. Attribute the shop to an affiliate when a ref code came through.
 *
 * Signed with HMAC-SHA256 over the raw body using CRON_SECRET.
 *
 *   POST /api/track/install
 *   X-Bee-Signature: <hex hmac>
 *   {
 *     "app": "kaching-bundles",
 *     "shopDomain": "acme.myshopify.com",
 *     "ref": "K7QP2M4X",                       // optional
 *     "installedAt": "2026-09-04T10:00:00Z",   // optional
 *     "plan": "pro",                            // optional
 *     "shop": {                                 // optional, all fields optional
 *       "name": "Acme", "email": "owner@acme.com", "ownerName": "Ada Lovelace",
 *       "phone": "+1...", "primaryDomain": "acme.com", "country": "US",
 *       "currency": "USD", "timezone": "America/New_York", "plan": "shopify_plus"
 *     }
 *   }
 */
const bodySchema = z.object({
	app: z.string().min(1),
	shopDomain: z.string().min(1),
	ref: z.string().min(4).max(24).optional().nullable(),
	installedAt: z.string().datetime().optional().nullable(),
	plan: z.string().max(80).optional().nullable(),
	shop: z
		.object({
			name: z.string().max(200).optional().nullable(),
			email: z.string().email().max(200).optional().nullable(),
			ownerName: z.string().max(200).optional().nullable(),
			phone: z.string().max(60).optional().nullable(),
			primaryDomain: z.string().max(200).optional().nullable(),
			country: z.string().max(80).optional().nullable(),
			currency: z.string().max(10).optional().nullable(),
			timezone: z.string().max(80).optional().nullable(),
			plan: z.string().max(80).optional().nullable()
		})
		.optional()
});

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	const parsedBody = await readSignedBody(request, platform?.env?.CRON_SECRET);
	if (!parsedBody.ok) return parsedBody.response;

	const parsed = bodySchema.safeParse(parsedBody.body);
	if (!parsed.success) {
		return json({ error: parsed.error.issues[0].message }, { status: 400 });
	}

	const payload = parsed.data;
	const shopDomain = normalizeShopDomain(payload.shopDomain);
	if (!shopDomain) return json({ error: 'Invalid shop domain.' }, { status: 400 });

	const [app] = await locals.db.select().from(apps).where(eq(apps.slug, payload.app)).limit(1);
	if (!app) return json({ error: `Unknown app "${payload.app}".` }, { status: 404 });

	const installedAt = payload.installedAt ? new Date(payload.installedAt) : new Date();

	// Attribution first, so the install row can carry the referral id.
	let attribution: { attributed: boolean; reason?: string; referralId?: string } = {
		attributed: false,
		reason: 'no_ref'
	};

	if (payload.ref) {
		const refCode = payload.ref.toUpperCase();
		const [affiliate] = await locals.db
			.select()
			.from(affiliates)
			.where(and(eq(affiliates.refCode, refCode), eq(affiliates.status, 'approved')))
			.limit(1);

		if (!affiliate) {
			attribution = { attributed: false, reason: 'unknown_ref' };
		} else {
			const click = await findClickForRefCode(locals.db, app.id, refCode, installedAt);
			const result = await attributeReferral(locals.db, {
				affiliateId: affiliate.id,
				appId: app.id,
				shopDomain,
				shopName: payload.shop?.name ?? null,
				source: 'click',
				clickId: click?.id ?? null,
				installedAt
			});

			attribution = result.ok
				? { attributed: true, referralId: result.referral.id }
				: { attributed: false, reason: 'conflict' };
		}
	}

	// Record the merchant and install regardless of attribution.
	const install = await recordInstall(locals.db, {
		appId: app.id,
		profile: {
			shopDomain,
			name: payload.shop?.name ?? null,
			email: payload.shop?.email ?? null,
			ownerName: payload.shop?.ownerName ?? null,
			phone: payload.shop?.phone ?? null,
			primaryDomain: payload.shop?.primaryDomain ?? null,
			country: payload.shop?.country ?? null,
			currency: payload.shop?.currency ?? null,
			timezone: payload.shop?.timezone ?? null,
			shopifyPlan: payload.shop?.plan ?? null
		},
		installedAt,
		plan: payload.plan ?? null,
		referralId: attribution.referralId ?? null,
		source: 'ingest'
	});

	return json({
		recorded: Boolean(install),
		merchantId: install?.merchantId ?? null,
		installId: install?.installId ?? null,
		reinstall: install?.reinstall ?? false,
		...attribution
	});
};
