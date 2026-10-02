import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { findApp } from '$lib/server/services/app-registry';
import { normalizeShopDomain } from '$lib/server/services/referral';
import { readSignedBody } from '$lib/server/ingest';
import { recordUsageEvents } from '$lib/server/services/engagement';
import type { RequestHandler } from './$types';

/**
 * In-app usage. Post from each Bee app, signed like the install endpoint, as
 * merchants use it. Batch where you can: one request per page load or job,
 * not per click.
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

	const result = await recordUsageEvents(locals.db, {
		appId: app.id,
		shopDomain,
		events: payload.events.map((e) => ({
			name: e.name,
			properties: e.properties ?? null,
			occurredAt: e.occurredAt ? new Date(e.occurredAt) : new Date()
		}))
	});

	return json(result);
};
