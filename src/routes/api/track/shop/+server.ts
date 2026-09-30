import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { merchants } from '$lib/server/db/schema';
import { findApp } from '$lib/server/services/app-registry';
import { upsertMerchant } from '$lib/server/services/merchant';
import { normalizeShopDomain } from '$lib/server/services/referral';
import { readSignedBody } from '$lib/server/ingest';
import type { RequestHandler } from './$types';

/**
 * Shop profile ingest. Post from the shop/update webhook handler in each Bee
 * app, signed the same way as the install endpoint.
 *
 * The Partner API carries no merchant email, so without this a store that
 * changes hands keeps its old owner's address here forever. Only the fields
 * you send are overwritten; leave one out to keep what is on record.
 *
 *   POST /api/track/shop
 *   X-Bee-Signature: <hex hmac>
 *   {
 *     "app": "kaching-bundles",
 *     "shopDomain": "acme.myshopify.com",
 *     "shop": {
 *       "name": "Acme", "email": "owner@acme.com", "ownerName": "Ada Lovelace",
 *       "phone": "+1...", "primaryDomain": "acme.com", "country": "US",
 *       "currency": "USD", "timezone": "America/New_York", "plan": "shopify_plus"
 *     }
 *   }
 */
const bodySchema = z.object({
	app: z.string().min(1),
	/** The app's SHOPIFY_API_KEY. Resolves the record even after a rename. */
	apiKey: z.string().trim().max(64).optional(),
	/** gid://partners/App/... when the app knows it. */
	partnerAppId: z.string().trim().max(120).optional(),
	shopDomain: z.string().min(1),
	shop: z.object({
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
});

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	const parsedBody = await readSignedBody(request, platform!.env, locals.db);
	if (!parsedBody.ok) return parsedBody.response;

	const parsed = bodySchema.safeParse(parsedBody.body);
	if (!parsed.success) {
		return json({ error: parsed.error.issues[0].message }, { status: 400 });
	}

	const payload = parsed.data;
	const shopDomain = normalizeShopDomain(payload.shopDomain);
	if (!shopDomain) return json({ error: 'Invalid shop domain.' }, { status: 400 });

	const app = await findApp(locals.db, {
		slug: payload.app,
		apiKey: payload.apiKey,
		partnerAppId: payload.partnerAppId
	});
	if (!app) return json({ error: `Unknown app "${payload.app}".` }, { status: 404 });

	// A profile change for a shop we never saw install is not a reason to invent
	// a merchant. Answer 200 so the app does not retry.
	const [existing] = await locals.db
		.select({ id: merchants.id })
		.from(merchants)
		.where(eq(merchants.shopDomain, shopDomain))
		.limit(1);
	if (!existing) return json({ recorded: false, reason: 'no_merchant_on_record' });

	const { shop } = payload;
	const merchant = await upsertMerchant(locals.db, {
		shopDomain,
		name: shop.name,
		email: shop.email,
		ownerName: shop.ownerName,
		phone: shop.phone,
		primaryDomain: shop.primaryDomain,
		country: shop.country,
		currency: shop.currency,
		timezone: shop.timezone,
		shopifyPlan: shop.plan
	});

	// Internal shops are filtered out by the upsert; nothing to record for them.
	if (!merchant) return json({ recorded: false, reason: 'internal_shop' });

	return json({ recorded: true, merchantId: merchant.id, email: merchant.email });
};
