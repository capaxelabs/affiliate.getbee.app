import { json } from '@sveltejs/kit';
import { runFullSync } from '$lib/server/services/sync';
import { pruneLoginCodes } from '$lib/server/auth';
import { getIngestKey } from '$lib/server/services/ingest-key';
import { syncAllReviews } from '$lib/server/services/reviews';
import { syncListingTraffic } from '$lib/server/services/bigquery';
import { snapshotListings, trackKeywords } from '$lib/server/services/appstore';
import type { RequestHandler } from './$types';

/**
 * Scheduled Partner API sync. adapter-cloudflare exports only a fetch handler,
 * so point an external scheduler at this endpoint:
 *
 *   curl -X POST https://affiliates.getbee.app/api/cron/sync \
 *        -H "Authorization: Bearer $INGEST_KEY"
 *
 * The bearer is the ingest key from /admin/apps, the same one apps sign their
 * webhooks with. CRON_SECRET still works so an existing scheduler keeps running.
 *
 * Cron Triggers reach it through worker.js. One daily run: the full Partner API
 * sync, then App Store reviews, GA4 listing traffic, keyword ranks and
 * competitor ratings.
 */
export const POST: RequestHandler = async ({ request, locals, platform }) => {
	const accepted = [
		await getIngestKey(locals.db),
		platform?.env?.CRON_SECRET
	].filter(Boolean);
	if (!accepted.length) return json({ error: 'Sync is not configured.' }, { status: 503 });

	const presented = request.headers.get('authorization');
	if (!accepted.some((secret) => presented === `Bearer ${secret}`)) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const task = 'all';
	const result = await runFullSync(locals.db, platform!.env, 'cron');
	await pruneLoginCodes(locals.db);

	// Neither is part of the Partner sync, and neither may fail it.
	const reviews = await syncAllReviews(locals.db).catch((e) => [{ error: String(e) }]);
	const traffic = await syncListingTraffic(locals.db).catch((e) => ({ error: String(e) }));
	const ranks = await trackKeywords(locals.db).catch((e) => ({ error: String(e) }));
	const listings = await snapshotListings(locals.db).catch((e) => ({ error: String(e) }));

	const failed = [...result.apps, ...result.installs, ...result.transactions].some(
		(r) => r.status === 'failed'
	);
	return json({ task, ...result, reviews, traffic, ranks, listings }, { status: failed ? 502 : 200 });
};
