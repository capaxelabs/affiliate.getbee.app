import { error, redirect } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { sha256 } from '@oslojs/crypto/sha2';
import { encodeHexLowerCase } from '@oslojs/encoding';
import { affiliates, apps, referralClicks } from '$lib/server/db/schema';
import { REFERRAL_COOKIE } from '$lib/constants';
import type { RequestHandler } from './$types';

/**
 * Affiliate link entry point. Records the click, drops a ref cookie for our own
 * domain, and forwards to the App Store listing with the code attached so the
 * Bee app can report it back on install.
 */
export const GET: RequestHandler = async (event) => {
	const { locals, params, url, request, cookies, platform } = event;
	const db = locals.db;
	const refCode = params.code.toUpperCase();

	const [row] = await db
		.select({ affiliate: affiliates, app: apps })
		.from(affiliates)
		.innerJoin(apps, eq(apps.slug, params.app))
		.where(
			and(
				eq(affiliates.refCode, refCode),
				eq(apps.status, 'active'),
				eq(apps.affiliateEnabled, true)
			)
		)
		.limit(1);

	if (!row) error(404, 'That affiliate link is not valid.');

	// Opting an app in requires a listing URL, so this should not happen — but a
	// link with nowhere to send the merchant is worth failing loudly.
	if (!row.app.listingUrl) error(404, 'That app has no App Store listing yet.');

	// Suspended and rejected affiliates stop earning, but the merchant still
	// reaches the listing rather than hitting a dead link.
	const trackable = row.affiliate.status === 'approved';

	if (trackable) {
		const ip = request.headers.get('cf-connecting-ip') ?? '';
		const expiresAt = new Date(Date.now() + row.app.cookieDays * 24 * 60 * 60 * 1000);

		// .execute() starts the query now — a bare builder is a lazy thenable and
		// waitUntil would never kick it off.
		const write = db
			.insert(referralClicks)
			.values({
				affiliateId: row.affiliate.id,
				appId: row.app.id,
				refCode,
				landingUrl: url.href,
				referer: request.headers.get('referer'),
				userAgent: request.headers.get('user-agent')?.slice(0, 400) ?? null,
				country: request.headers.get('cf-ipcountry'),
				ipHash: ip ? encodeHexLowerCase(sha256(new TextEncoder().encode(ip + refCode))) : null,
				expiresAt
			})
			.execute()
			.catch((error) => console.error('click write failed', error));

		if (platform?.ctx) platform.ctx.waitUntil(write);
		else await write;

		cookies.set(REFERRAL_COOKIE, `${refCode}:${row.app.slug}`, {
			path: '/',
			expires: expiresAt,
			httpOnly: false,
			sameSite: 'lax',
			secure: !url.hostname.includes('localhost')
		});
	}

	const target = new URL(row.app.listingUrl);
	target.searchParams.set('ref', refCode.toLowerCase());
	// Shopify passes utm_* through to the app's install request.
	target.searchParams.set('utm_source', 'affiliate');
	target.searchParams.set('utm_medium', 'referral');
	target.searchParams.set('utm_campaign', refCode.toLowerCase());

	redirect(302, target.toString());
};
