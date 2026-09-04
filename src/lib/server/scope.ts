import { error, redirect } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { DrizzleClient } from '$lib/server/db';
import { adminScopes, apps } from '$lib/server/db/schema';

/**
 * What the signed-in person may see in the admin.
 *
 * `appIds === null` means unrestricted — that is a full admin. Staff always get
 * an explicit list, which may be empty if nobody has granted them anything yet.
 */
export type AdminScope = {
	userId: string;
	role: 'admin' | 'staff';
	/** null = every app. */
	appIds: string[] | null;
	/** Staff are read-only; only a full admin may change anything. */
	canWrite: boolean;
	/** Staff see the affiliate program only when this is switched on for them. */
	canViewAffiliates: boolean;
};

/** Expands a staff member's scope rows into the concrete apps they can see. */
export async function resolveScopedAppIds(db: DrizzleClient, userId: string): Promise<string[]> {
	const rows = await db
		.select({ partnerAccountId: adminScopes.partnerAccountId, appId: adminScopes.appId })
		.from(adminScopes)
		.where(eq(adminScopes.userId, userId));

	if (!rows.length) return [];

	const direct = rows.map((r) => r.appId).filter((id): id is string => Boolean(id));
	const accountIds = rows
		.filter((r) => !r.appId && r.partnerAccountId)
		.map((r) => r.partnerAccountId as string);

	if (!accountIds.length) return [...new Set(direct)];

	// A partner-account grant covers every app under it, including ones added later.
	const viaAccount = await db
		.select({ id: apps.id })
		.from(apps)
		.where(inArray(apps.partnerAccountId, accountIds));

	return [...new Set([...direct, ...viaAccount.map((a) => a.id)])];
}

/** Admin or staff. Redirects to login when signed out, 403s for affiliates. */
export async function requireAdminAccess(event: RequestEvent): Promise<AdminScope> {
	const user = event.locals.user;
	if (!user) redirect(303, `/login?next=${encodeURIComponent(event.url.pathname)}`);

	if (user.role === 'admin') {
		return {
			userId: user.id,
			role: 'admin',
			appIds: null,
			canWrite: true,
			canViewAffiliates: true
		};
	}

	if (user.role !== 'staff') error(403, 'Admins only');

	return {
		userId: user.id,
		role: 'staff',
		appIds: await resolveScopedAppIds(event.locals.db, user.id),
		canWrite: false,
		canViewAffiliates: user.viewAffiliateData
	};
}

/** For pages that only a full admin may open. */
export async function requireOwner(event: RequestEvent) {
	const scope = await requireAdminAccess(event);
	if (scope.role !== 'admin') error(403, 'This section is limited to full admins.');
	return scope;
}

/** For the affiliate-program pages, which staff see only when allowed. */
export async function requireAffiliateVisibility(event: RequestEvent) {
	const scope = await requireAdminAccess(event);
	if (!scope.canViewAffiliates) {
		error(403, 'You do not have access to the affiliate program.');
	}
	return scope;
}

/**
 * A `where` fragment restricting a query to the scoped apps, or undefined when
 * unrestricted. A staff member with no grants gets an always-false clause, so
 * an unscoped person sees nothing rather than everything.
 */
export function appScopeFilter(scope: AdminScope, column: SQLiteColumn): SQL | undefined {
	if (scope.appIds === null) return undefined;
	if (scope.appIds.length === 0) return sql`1 = 0`;
	return inArray(column, scope.appIds);
}

/** True when the scope covers this specific app. */
export function scopeCoversApp(scope: AdminScope, appId: string) {
	return scope.appIds === null || scope.appIds.includes(appId);
}
