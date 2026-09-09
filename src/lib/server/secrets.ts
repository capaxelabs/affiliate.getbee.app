/**
 * Helpers for the two credentials we keep in D1: the Partner Access Token and
 * the ingest key.
 *
 * Both are stored in plaintext. They used to be AES-GCM encrypted under an
 * ENCRYPTION_KEY worker secret, which protected against a database dump leaking
 * on its own — but the key lived in the same Cloudflare account as the database,
 * so it did nothing against the breach that would actually matter, and losing it
 * orphaned every stored secret at once. That happened, and cost more than the
 * encryption was worth on a single-operator install.
 *
 * The tradeoff now: treat any D1 export as credential material.
 */

/** Last four characters, for showing which token is on file. */
export function tokenHint(token: string) {
	return token.length <= 4 ? '••••' : `••••${token.slice(-4)}`;
}

/** A fresh ingest key. Prefixed so it is recognisable in logs and configs. */
export function newIngestKey() {
	const bytes = crypto.getRandomValues(new Uint8Array(24));
	const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
	return `bee_ingest_${hex}`;
}
