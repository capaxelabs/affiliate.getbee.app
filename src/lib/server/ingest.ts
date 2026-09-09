import { json } from '@sveltejs/kit';
import type { DrizzleClient } from '$lib/server/db';
import { getIngestKey } from '$lib/server/services/ingest-key';

/**
 * Signature checking for the endpoints each Bee app posts to.
 *
 * One key for every app, stored in the database and revealable in the admin —
 * a worker secret cannot be read back, and nobody remembers one a week later.
 * CRON_SECRET still verifies as a fallback so anything configured before the
 * key existed keeps working.
 */
export async function verifySignature(secret: string, raw: string, signature: string | null) {
	if (!signature || !secret) return false;

	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw));
	const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');

	if (expected.length !== signature.length) return false;
	let diff = 0;
	for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
	return diff === 0;
}

export type IngestBody = { ok: true; raw: string; body: unknown } | { ok: false; response: Response };

type Env = App.Platform['env'];

/** Reads and authenticates an ingest request, or hands back the error response. */
export async function readSignedBody(
	request: Request,
	env: Env,
	db: DrizzleClient
): Promise<IngestBody> {
	const raw = await request.text();
	const signature = request.headers.get('x-bee-signature');

	let body: unknown;
	try {
		body = JSON.parse(raw);
	} catch {
		return { ok: false, response: json({ error: 'Body must be JSON.' }, { status: 400 }) };
	}

	const candidates = [await getIngestKey(db), env?.CRON_SECRET].filter(
		(candidate): candidate is string => Boolean(candidate)
	);

	if (!candidates.length) {
		return { ok: false, response: json({ error: 'Ingest is not configured.' }, { status: 503 }) };
	}

	for (const candidate of candidates) {
		if (await verifySignature(candidate, raw, signature)) return { ok: true, raw, body };
	}

	return { ok: false, response: json({ error: 'Bad signature.' }, { status: 401 }) };
}
