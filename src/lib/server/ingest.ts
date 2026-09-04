import { json } from '@sveltejs/kit';

/**
 * Shared HMAC check for the endpoints each Bee app posts to. The signature is
 * hex SHA-256 over the exact raw body, keyed with CRON_SECRET, so a merchant
 * can't forge an install or an attribution.
 */
export async function verifySignature(secret: string, raw: string, signature: string | null) {
	if (!signature) return false;

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

/** Reads and authenticates an ingest request, or hands back the error response. */
export async function readSignedBody(
	request: Request,
	secret: string | undefined
): Promise<IngestBody> {
	if (!secret) {
		return { ok: false, response: json({ error: 'Ingest is not configured.' }, { status: 503 }) };
	}

	const raw = await request.text();
	const signature = request.headers.get('x-bee-signature');

	if (!(await verifySignature(secret, raw, signature))) {
		return { ok: false, response: json({ error: 'Bad signature.' }, { status: 401 }) };
	}

	try {
		return { ok: true, raw, body: JSON.parse(raw) };
	} catch {
		return { ok: false, response: json({ error: 'Body must be JSON.' }, { status: 400 }) };
	}
}
