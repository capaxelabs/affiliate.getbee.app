import { eq } from 'drizzle-orm';
import type { DrizzleClient } from '$lib/server/db';
import { settings } from '$lib/server/db/schema';
import { decryptSecret, encryptSecret, newIngestKey, tokenHint } from '$lib/server/crypto';

/**
 * The one key every app signs its webhooks with, and the one the cron endpoint
 * accepts as a bearer token.
 *
 * It is stored here instead of as a worker secret because `wrangler secret put`
 * is write-only — nobody can read CRON_SECRET back to configure a new app, and
 * nobody remembers it a week later. Encrypted at rest with ENCRYPTION_KEY.
 */
const KEY = 'ingest_key';

type Env = App.Platform['env'];

/** The key in plaintext, or null when none has been generated yet. */
export async function getIngestKey(db: DrizzleClient, env: Env) {
	const [row] = await db.select().from(settings).where(eq(settings.key, KEY)).limit(1);
	if (!row) return null;

	try {
		return await decryptSecret(env, row.value);
	} catch (error) {
		// Treated as absent so CRON_SECRET still works and the key can be
		// regenerated. Logged because the two states are otherwise identical from
		// the outside: every app keeps getting "Bad signature" with a key the
		// admin happily displays, and nothing anywhere says why.
		console.error(
			`[ingest-key] stored key ${row.hint ?? '(no hint)'} could not be decrypted. ` +
				'ENCRYPTION_KEY does not match the one that encrypted it — regenerate ' +
				'the key from the admin on this environment.',
			error
		);
		return null;
	}
}

/** What the admin shows before anyone asks to see the key itself. */
export async function ingestKeyHint(db: DrizzleClient) {
	const [row] = await db.select().from(settings).where(eq(settings.key, KEY)).limit(1);
	return row?.hint ?? null;
}

/** Generates a new key, replacing any existing one. The old key stops working. */
export async function rotateIngestKey(db: DrizzleClient, env: Env) {
	const key = newIngestKey();
	const value = await encryptSecret(env, key);
	const hint = tokenHint(key);

	await db
		.insert(settings)
		.values({ key: KEY, value, hint })
		.onConflictDoUpdate({
			target: settings.key,
			set: { value, hint, updatedAt: new Date() }
		});

	return key;
}

/** The key, generating one on first use. */
export async function ensureIngestKey(db: DrizzleClient, env: Env) {
	return (await getIngestKey(db, env)) ?? (await rotateIngestKey(db, env));
}
