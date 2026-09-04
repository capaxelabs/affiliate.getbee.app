import type { RequestEvent } from '@sveltejs/kit';
import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import { sha256 } from '@oslojs/crypto/sha2';
import { encodeBase64url, encodeHexLowerCase } from '@oslojs/encoding';
import type { DrizzleClient } from '$lib/server/db';
import { affiliates, loginCodes, sessions, users } from '$lib/server/db/schema';
import { newRefCode } from '$lib/server/db/id';

const DAY = 1000 * 60 * 60 * 24;
const SESSION_TTL = DAY * 30;
const SESSION_RENEW_AFTER = DAY * 15;

const CODE_TTL = 1000 * 60 * 10;
const CODE_MAX_ATTEMPTS = 5;
const CODE_LENGTH = 6;

export const sessionCookieName = 'bee_affiliate_session';

export type SessionUser = {
	id: string;
	email: string;
	name: string | null;
	role: 'affiliate' | 'staff' | 'admin';
	/** Staff only: whether they may see the affiliate program. */
	viewAffiliateData: boolean;
	affiliateId: string | null;
	affiliateStatus: 'pending' | 'approved' | 'rejected' | 'suspended' | null;
};

export type Session = {
	id: string;
	userId: string;
	expiresAt: Date;
};

function hash(value: string) {
	return encodeHexLowerCase(sha256(new TextEncoder().encode(value)));
}

/* ------------------------------------------------------------- login codes */

export function generateLoginCode() {
	const digits = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
	return Array.from(digits, (d) => (d % 10).toString()).join('');
}

export async function createLoginCode(db: DrizzleClient, email: string) {
	const normalized = email.trim().toLowerCase();

	// One live code per address at a time.
	await db
		.delete(loginCodes)
		.where(and(eq(loginCodes.email, normalized), isNull(loginCodes.usedAt)));

	const code = generateLoginCode();
	await db.insert(loginCodes).values({
		email: normalized,
		codeHash: hash(code),
		expiresAt: new Date(Date.now() + CODE_TTL)
	});

	return code;
}

export type VerifyResult = { ok: true; email: string } | { ok: false; error: string };

export async function verifyLoginCode(
	db: DrizzleClient,
	email: string,
	code: string
): Promise<VerifyResult> {
	const normalized = email.trim().toLowerCase();
	const cleaned = code.replace(/\D/g, '');

	const [record] = await db
		.select()
		.from(loginCodes)
		.where(
			and(
				eq(loginCodes.email, normalized),
				isNull(loginCodes.usedAt),
				gt(loginCodes.expiresAt, new Date())
			)
		)
		.orderBy(loginCodes.createdAt)
		.limit(1);

	if (!record) return { ok: false, error: 'That code has expired. Request a new one.' };

	if (record.attempts >= CODE_MAX_ATTEMPTS) {
		await db.update(loginCodes).set({ usedAt: new Date() }).where(eq(loginCodes.id, record.id));
		return { ok: false, error: 'Too many attempts. Request a new code.' };
	}

	if (record.codeHash !== hash(cleaned)) {
		await db
			.update(loginCodes)
			.set({ attempts: record.attempts + 1 })
			.where(eq(loginCodes.id, record.id));
		const left = CODE_MAX_ATTEMPTS - record.attempts - 1;
		return {
			ok: false,
			error: left > 0 ? `Wrong code. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Wrong code.'
		};
	}

	await db.update(loginCodes).set({ usedAt: new Date() }).where(eq(loginCodes.id, record.id));
	return { ok: true, email: normalized };
}

/** Drops used and expired codes so the table doesn't grow forever. */
export async function pruneLoginCodes(db: DrizzleClient) {
	await db.delete(loginCodes).where(lt(loginCodes.expiresAt, new Date(Date.now() - DAY)));
}

/* ----------------------------------------------------------------- accounts */

/** Finds the account for an address, creating a pending affiliate on first sign-in. */
export async function findOrCreateUser(db: DrizzleClient, email: string, name?: string) {
	const normalized = email.trim().toLowerCase();

	const [existing] = await db.select().from(users).where(eq(users.email, normalized)).limit(1);
	if (existing) {
		await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, existing.id));
		return existing;
	}

	const [created] = await db
		.insert(users)
		.values({ email: normalized, name: name?.trim() || null, role: 'affiliate', lastLoginAt: new Date() })
		.returning();

	await db.insert(affiliates).values({ userId: created.id, refCode: await uniqueRefCode(db) });

	return created;
}

async function uniqueRefCode(db: DrizzleClient) {
	for (let i = 0; i < 5; i++) {
		const code = newRefCode();
		const [clash] = await db
			.select({ id: affiliates.id })
			.from(affiliates)
			.where(eq(affiliates.refCode, code))
			.limit(1);
		if (!clash) return code;
	}
	return newRefCode(12);
}

/* ----------------------------------------------------------------- sessions */

export function generateSessionToken() {
	return encodeBase64url(crypto.getRandomValues(new Uint8Array(24)));
}

export async function createSession(db: DrizzleClient, token: string, userId: string) {
	const session = {
		id: hash(token),
		userId,
		expiresAt: new Date(Date.now() + SESSION_TTL)
	};
	await db.insert(sessions).values(session);
	return session;
}

export async function validateSessionToken(
	db: DrizzleClient,
	token: string
): Promise<{ session: Session | null; user: SessionUser | null }> {
	const sessionId = hash(token);

	const [row] = await db
		.select({
			session: sessions,
			user: users,
			affiliateId: affiliates.id,
			affiliateStatus: affiliates.status
		})
		.from(sessions)
		.innerJoin(users, eq(sessions.userId, users.id))
		.leftJoin(affiliates, eq(affiliates.userId, users.id))
		.where(eq(sessions.id, sessionId))
		.limit(1);

	if (!row) return { session: null, user: null };

	if (Date.now() >= row.session.expiresAt.getTime()) {
		await db.delete(sessions).where(eq(sessions.id, sessionId));
		return { session: null, user: null };
	}

	let expiresAt = row.session.expiresAt;
	if (Date.now() >= expiresAt.getTime() - SESSION_RENEW_AFTER) {
		expiresAt = new Date(Date.now() + SESSION_TTL);
		await db.update(sessions).set({ expiresAt }).where(eq(sessions.id, sessionId));
	}

	return {
		session: { id: row.session.id, userId: row.session.userId, expiresAt },
		user: {
			id: row.user.id,
			email: row.user.email,
			name: row.user.name,
			role: row.user.role,
			viewAffiliateData: row.user.viewAffiliateData,
			affiliateId: row.affiliateId,
			affiliateStatus: row.affiliateStatus
		}
	};
}

export async function invalidateSession(db: DrizzleClient, sessionId: string) {
	await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export function setSessionCookie(event: RequestEvent, token: string, expiresAt: Date) {
	event.cookies.set(sessionCookieName, token, {
		path: '/',
		expires: expiresAt,
		httpOnly: true,
		sameSite: 'lax',
		secure: !event.url.hostname.includes('localhost')
	});
}

export function deleteSessionCookie(event: RequestEvent) {
	event.cookies.delete(sessionCookieName, { path: '/' });
}
