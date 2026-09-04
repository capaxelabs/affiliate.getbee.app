import { json } from '@sveltejs/kit';
import { runFullSync } from '$lib/server/services/sync';
import { processLifecycleEmails } from '$lib/server/services/lifecycle';
import { pruneLoginCodes } from '$lib/server/auth';
import type { RequestHandler } from './$types';

/**
 * Scheduled Partner API sync. adapter-cloudflare exports only a fetch handler,
 * so point an external scheduler at this endpoint:
 *
 *   curl -X POST https://affiliate.getbee.app/api/cron/sync \
 *        -H "Authorization: Bearer $CRON_SECRET"
 */
export const POST: RequestHandler = async ({ request, locals, platform }) => {
	const secret = platform?.env?.CRON_SECRET;
	if (!secret) return json({ error: 'Sync is not configured.' }, { status: 503 });

	if (request.headers.get('authorization') !== `Bearer ${secret}`) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const result = await runFullSync(locals.db, platform!.env, 'cron');

	// Drain the merchant lifecycle outbox regardless of how the sync went — the
	// queue is filled by install webhooks, not by the Partner API.
	const lifecycle = await processLifecycleEmails(locals.db, platform!.env);
	await pruneLoginCodes(locals.db);

	const failed = [...result.apps, ...result.installs, ...result.transactions].some(
		(r) => r.status === 'failed'
	);
	return json({ ...result, lifecycle }, { status: failed ? 502 : 200 });
};
