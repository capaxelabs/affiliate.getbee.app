const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

function randomString(length: number) {
	const bytes = crypto.getRandomValues(new Uint8Array(length));
	let out = '';
	for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
	return out;
}

export function newId(prefix: string, length = 16) {
	return `${prefix}_${randomString(length)}`;
}

/** Public affiliate code. Ambiguous characters removed so it survives being read aloud. */
export function newRefCode(length = 8) {
	const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
	const bytes = crypto.getRandomValues(new Uint8Array(length));
	let out = '';
	for (const byte of bytes) out += alphabet[byte % alphabet.length];
	return out;
}
