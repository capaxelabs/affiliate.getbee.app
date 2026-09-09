import { eq } from 'drizzle-orm';
import type { DrizzleClient } from '$lib/server/db';
import { settings } from '$lib/server/db/schema';
import { newIngestKey, tokenHint } from '$lib/server/secrets';

/**
 * The one key every app signs its webhooks with, and the one the cron endpoint
 * accepts as a bearer token.
 *
 * It is stored here instead of as a worker secret because `wrangler secret put`
 * is write-only — nobody can read CRON_SECRET back to configure a new app, and
 * nobody remembers it a week later.
 */
const KEY = 'ingest_key';

/** The key, or null when none has been generated yet. */
export async function getIngestKey(db: DrizzleClient) {
	const [row] = await db.select().from(settings).where(eq(settings.key, KEY)).limit(1);
	return row?.value ?? null;
}

/** What the admin shows before anyone asks to see the key itself. */
export async function ingestKeyHint(db: DrizzleClient) {
	const [row] = await db.select().from(settings).where(eq(settings.key, KEY)).limit(1);
	return row?.hint ?? null;
}

/** Generates a new key, replacing any existing one. The old key stops working. */
export async function rotateIngestKey(db: DrizzleClient) {
	const key = newIngestKey();
	const hint = tokenHint(key);

	await db
		.insert(settings)
		.values({ key: KEY, value: key, hint })
		.onConflictDoUpdate({
			target: settings.key,
			set: { value: key, hint, updatedAt: new Date() }
		});

	return key;
}

/** The key, generating one on first use. */
export async function ensureIngestKey(db: DrizzleClient) {
	return (await getIngestKey(db)) ?? (await rotateIngestKey(db));
}
