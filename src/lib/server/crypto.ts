import { encodeBase64, decodeBase64 } from '@oslojs/encoding';
import { sha256 } from '@oslojs/crypto/sha2';

/**
 * AES-GCM for the Partner Access Tokens we have to keep in D1. The key is derived
 * from the ENCRYPTION_KEY worker secret, so a database dump on its own is not
 * enough to use the tokens.
 */
async function keyFor(secret: string) {
	// SHA-256 gives us the 32 bytes AES-256 wants from an arbitrary passphrase.
	const raw = sha256(new TextEncoder().encode(secret)) as unknown as BufferSource;
	return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export class EncryptionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'EncryptionError';
	}
}

export function encryptionConfigured(env: App.Platform['env']) {
	return Boolean(env?.ENCRYPTION_KEY);
}

/** Returns `base64(iv).base64(ciphertext)`. */
export async function encryptSecret(env: App.Platform['env'], plaintext: string) {
	if (!env?.ENCRYPTION_KEY) {
		throw new EncryptionError('ENCRYPTION_KEY is not set, so tokens cannot be stored.');
	}

	const key = await keyFor(env.ENCRYPTION_KEY);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ciphertext = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv },
		key,
		new TextEncoder().encode(plaintext)
	);

	return `${encodeBase64(iv)}.${encodeBase64(new Uint8Array(ciphertext))}`;
}

export async function decryptSecret(env: App.Platform['env'], payload: string) {
	if (!env?.ENCRYPTION_KEY) {
		throw new EncryptionError('ENCRYPTION_KEY is not set, so tokens cannot be read.');
	}

	const [ivPart, dataPart] = payload.split('.');
	if (!ivPart || !dataPart) throw new EncryptionError('Stored token is malformed.');

	const key = await keyFor(env.ENCRYPTION_KEY);
	try {
		const plaintext = await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: decodeBase64(ivPart) as unknown as BufferSource },
			key,
			decodeBase64(dataPart) as unknown as BufferSource
		);
		return new TextDecoder().decode(plaintext);
	} catch {
		// Wrong key, or the ciphertext was tampered with.
		throw new EncryptionError('Could not decrypt the stored token. Has ENCRYPTION_KEY changed?');
	}
}

/** Last four characters, for showing which token is on file. */
export function tokenHint(token: string) {
	return token.length <= 4 ? '••••' : `••••${token.slice(-4)}`;
}
