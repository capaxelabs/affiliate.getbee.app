import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { merchants } from '$lib/server/db/schema';
import { findApp } from '$lib/server/services/app-registry';
import { normalizeShopDomain } from '$lib/server/services/referral';
import { readSignedBody } from '$lib/server/ingest';
import { recordUsageEvents } from '$lib/server/services/engagement';
import { sendMerchantEvents } from '$lib/server/raechly';
import type { RequestHandler } from './$types';

/**
 * In-app usage. Post from each Bee app, signed like the install endpoint, as
 * merchants use it. Batch where you can: one request per page load or job,
 * not per click.
 *
 * Every event except page_view also goes to Raechly as a product event, where
 * it decides the merchant's emails (a journey waits for it, branches on it or
 * ends on it). Name milestones for what the merchant did: image_created,
 * bulk_run_started, subscribed.
 *
 *   POST /api/track/event
 *   X-Bee-Signature: <hex hmac>
 *   {
 *     "app": "bee-rankflo",
 *     "apiKey": "<SHOPIFY_API_KEY>",          // optional, resolves renames
 *     "shopDomain": "acme.myshopify.com",
 *     "events": [
 *       { "name": "page_view", "properties": { "path": "/rules" } },
 *       { "name": "rule_created", "occurredAt": "2026-10-02T10:00:00Z" }
 *     ]
 *   }
 */
const bodySchema = z.object({
	app: z.string().min(1),
	apiKey: z.string().trim().max(64).optional(),
	partnerAppId: z.string().trim().max(120).optional(),
	shopDomain: z.string().min(1),
	events: z
		.array(
			z.object({
				name: z
					.string()
					.trim()
					.min(1)
					.max(80)
					.regex(/^[a-z0-9_.:-]+$/i, 'Event names use letters, numbers, _ . : and -.'),
				occurredAt: z.string().datetime().optional(),
				properties: z.record(z.unknown()).optional()
			})
		)
		.min(1)
		.max(100)
});

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	const signed = await readSignedBody(request, platform!.env, locals.db);
	if (!signed.ok) return signed.response;

	const parsed = bodySchema.safeParse(signed.body);
	if (!parsed.success) return json({ error: parsed.error.issues[0].message }, { status: 400 });

	const payload = parsed.data;
	const shopDomain = normalizeShopDomain(payload.shopDomain);
	if (!shopDomain) return json({ error: 'Invalid shop domain.' }, { status: 400 });

	const app = await findApp(locals.db, {
		slug: payload.app,
		apiKey: payload.apiKey,
		partnerAppId: payload.partnerAppId
	});
	if (!app) return json({ error: `Unknown app "${payload.app}".` }, { status: 404 });

	const events = payload.events.map((e) => ({
		name: e.name,
		properties: e.properties ?? null,
		// A clock in the future would start a journey from an event that hasn't happened.
		occurredAt: new Date(Math.min(e.occurredAt ? Date.parse(e.occurredAt) : Date.now(), Date.now()))
	}));
	const result = await recordUsageEvents(locals.db, { appId: app.id, shopDomain, events });

	// recordUsageEvents records nothing for internal shops; Raechly gets nothing either.
	const milestones = events.filter((e) => e.name !== 'page_view');
	if (result.recorded > 0 && milestones.length > 0) {
		const [merchant] = await locals.db
			.select()
			.from(merchants)
			.where(eq(merchants.shopDomain, shopDomain))
			.limit(1);
		if (merchant) {
			platform!.ctx.waitUntil(
				sendMerchantEvents(platform!.env, { appSlug: app.slug, merchant, events: milestones })
			);
		}
	}

	return json(result);
};
