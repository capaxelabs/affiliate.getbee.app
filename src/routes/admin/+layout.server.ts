import { and, count, eq } from 'drizzle-orm';
import { requireAdminAccess, appScopeFilter } from '$lib/server/scope';
import { affiliates, referralClaims } from '$lib/server/db/schema';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async (event) => {
	const scope = await requireAdminAccess(event);
	const user = event.locals.user!;

	// Queue badges only mean anything to someone who can act on them.
	let queues = { affiliates: 0, claims: 0 };

	if (scope.canViewAffiliates) {
		const claimFilter = appScopeFilter(scope, referralClaims.appId);

		const [pendingAffiliates, pendingClaims] = await Promise.all([
			scope.role === 'admin'
				? event.locals.db
						.select({ value: count() })
						.from(affiliates)
						.where(eq(affiliates.status, 'pending'))
				: Promise.resolve([{ value: 0 }]),
			event.locals.db
				.select({ value: count() })
				.from(referralClaims)
				.where(
					claimFilter
						? and(eq(referralClaims.status, 'pending'), claimFilter)
						: eq(referralClaims.status, 'pending')
				)
		]);

		queues = {
			affiliates: Number(pendingAffiliates[0]?.value ?? 0),
			claims: Number(pendingClaims[0]?.value ?? 0)
		};
	}

	return {
		user: { id: user.id, name: user.name, email: user.email },
		access: {
			role: scope.role,
			canWrite: scope.canWrite,
			canViewAffiliates: scope.canViewAffiliates,
			appCount: scope.appIds?.length ?? null
		},
		queues
	};
};
