import { json } from '@sveltejs/kit';
import { runFullSync } from '$lib/server/services/sync';
import { pruneLoginCodes } from '$lib/server/auth';
import { getIngestKey } from '$lib/server/services/ingest-key';
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
 * Cron Triggers reach it through worker.js. Merchant lifecycle email moved to
 * Raechly (journeys driven by install events), so there is one task: the full
 * Partner API sync.
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

	const failed = [...result.apps, ...result.installs, ...result.transactions].some(
		(r) => r.status === 'failed'
	);
	return json({ task, ...result }, { status: failed ? 502 : 200 });
};
