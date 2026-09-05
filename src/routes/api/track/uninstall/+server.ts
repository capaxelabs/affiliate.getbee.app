import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { findApp } from '$lib/server/services/app-registry';
import { recordUninstall } from '$lib/server/services/merchant';
import { normalizeShopDomain } from '$lib/server/services/referral';
import { readSignedBody } from '$lib/server/ingest';
import type { RequestHandler } from './$types';

/**
 * Uninstall ingest. Post from the app/uninstalled webhook handler in each Bee
 * app, signed the same way as the install endpoint.
 *
 *   POST /api/track/uninstall
 *   X-Bee-Signature: <hex hmac>
 *   {
 *     "app": "kaching-bundles",
 *     "shopDomain": "acme.myshopify.com",
 *     "uninstalledAt": "2026-09-04T10:00:00Z",  // optional
 *     "reason": "too_expensive",                 // optional
 *     "feedback": "Free plan was enough for us"  // optional
 *   }
 *
 * Calling it again with a reason or feedback after the fact records that too —
 * useful when the merchant answers the offboarding email later.
 */
const bodySchema = z.object({
	app: z.string().min(1),
	/** The app's SHOPIFY_API_KEY. Resolves the record even after a rename. */
	apiKey: z.string().trim().max(64).optional(),
	/** gid://partners/App/... when the app knows it. */
	partnerAppId: z.string().trim().max(120).optional(),
	shopDomain: z.string().min(1),
	uninstalledAt: z.string().datetime().optional().nullable(),
	reason: z.string().max(120).optional().nullable(),
	feedback: z.string().max(4000).optional().nullable()
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

	// Resolved the same way the install endpoint does. Matching on slug alone
	// meant an app that changed the slug it reports under kept installing fine
	// and silently 404'd on every uninstall.
	const app = await findApp(locals.db, {
		slug: payload.app,
		apiKey: payload.apiKey,
		partnerAppId: payload.partnerAppId
	});
	if (!app) return json({ error: `Unknown app "${payload.app}".` }, { status: 404 });

	const result = await recordUninstall(locals.db, {
		appId: app.id,
		shopDomain,
		uninstalledAt: payload.uninstalledAt ? new Date(payload.uninstalledAt) : new Date(),
		reason: payload.reason ?? null,
		feedback: payload.feedback ?? null,
		source: 'ingest'
	});

	// No install on record means the app never told us about it — not an error
	// worth retrying, so answer 200 with the reason.
	if (!result) return json({ recorded: false, reason: 'no_install_on_record' });

	return json({
		recorded: true,
		installId: result.installId,
		merchantId: result.merchantId,
		alreadyUninstalled: result.alreadyUninstalled
	});
};
