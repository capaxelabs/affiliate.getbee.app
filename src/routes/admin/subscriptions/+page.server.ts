import { inArray } from 'drizzle-orm';
import { requireAdminAccess, scopeCoversApp } from '$lib/server/scope';
import { apps } from '$lib/server/db/schema';
import {
	churnMetrics,
	mrrByApp,
	mrrMovement,
	mrrNow,
	recentSubscriptionEvents
} from '$lib/server/services/metrics';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const scope = await requireAdminAccess(event);
	const db = event.locals.db;

	const requested = event.url.searchParams.get('app') ?? '';
	// An app outside the caller's scope is treated as no filter rather than an
	// error, so the page never confirms that app exists.
	const appId = requested && scopeCoversApp(scope, requested) ? requested : '';
	const filter = appId ? [appId] : scope.appIds;

	const [appRows, now, byApp, movement, churn, recent] = await Promise.all([
		db
			.select({ id: apps.id, name: apps.name })
			.from(apps)
			.where(
				scope.appIds === null
					? undefined
					: inArray(apps.id, scope.appIds.length ? scope.appIds : [''])
			)
			.orderBy(apps.name),
		mrrNow(db, filter),
		mrrByApp(db, filter),
		mrrMovement(db, filter, 12),
		churnMetrics(db, filter),
		recentSubscriptionEvents(db, filter, 20)
	]);

	return {
		appId,
		apps: appRows,
		now,
		byApp: appRows
			.map((a) => ({ ...a, ...(byApp.get(a.id) ?? { mrrCents: 0, subscriptions: 0 }) }))
			.filter((a) => a.mrrCents > 0 || a.subscriptions > 0)
			.sort((a, b) => b.mrrCents - a.mrrCents),
		movement,
		churn,
		recent
	};
};
