import { json } from '@sveltejs/kit';
import { runFullSync } from '$lib/server/services/sync';
import { processLifecycleEmails } from '$lib/server/services/lifecycle';
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
 * Cron Triggers reach it through worker.js. `?task=lifecycle` skips the Partner
 * API and only sends queued merchant email.
 */
export const POST: RequestHandler = async ({ request, url, locals, platform }) => {
	const accepted = [
		await getIngestKey(locals.db, platform!.env),
		platform?.env?.CRON_SECRET
	].filter(Boolean);
	if (!accepted.length) return json({ error: 'Sync is not configured.' }, { status: 503 });

	const presented = request.headers.get('authorization');
	if (!accepted.some((secret) => presented === `Bearer ${secret}`)) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	// `task=lifecycle` only drains the outbox. The hourly trigger uses it so a
	// welcome email is not delayed by a day, without hitting the Partner API
	// twenty-four times over.
	const task = url.searchParams.get('task') === 'lifecycle' ? 'lifecycle' : 'all';

	if (task === 'lifecycle') {
		const lifecycle = await processLifecycleEmails(locals.db, platform!.env);
		return json({ task, lifecycle });
	}

	const result = await runFullSync(locals.db, platform!.env, 'cron');

	// Drain the outbox regardless of how the sync went — the queue is filled by
	// install webhooks, not by the Partner API.
	const lifecycle = await processLifecycleEmails(locals.db, platform!.env);
	await pruneLoginCodes(locals.db);

	const failed = [...result.apps, ...result.installs, ...result.transactions].some(
		(r) => r.status === 'failed'
	);
	return json({ task, ...result, lifecycle }, { status: failed ? 502 : 200 });
};
