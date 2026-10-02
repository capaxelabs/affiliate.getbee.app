import { inArray } from 'drizzle-orm';
import { requireAdminAccess, scopeCoversApp } from '$lib/server/scope';
import { apps } from '$lib/server/db/schema';
import {
	cashflow,
	customerBreakdown,
	installCohorts,
	lifecycleTiming,
	mrrByPlan,
	revenueCohorts,
	revenueMix,
	trafficReport,
	uninstallReasons,
	type Dimension
} from '$lib/server/services/insights';
import { activationRate, churnRisk, engagementSummary } from '$lib/server/services/engagement';
import { keywordReport } from '$lib/server/services/appstore';
import type { PageServerLoad } from './$types';

const TABS = ['revenue', 'retention', 'customers', 'acquisition', 'engagement'] as const;
type Tab = (typeof TABS)[number];
const DIMENSIONS: Dimension[] = ['country', 'shopifyPlan', 'currency'];

export const load: PageServerLoad = async (event) => {
	const scope = await requireAdminAccess(event);
	const db = event.locals.db;
	const params = event.url.searchParams;

	const tab: Tab = (TABS as readonly string[]).includes(params.get('tab') ?? '')
		? (params.get('tab') as Tab)
		: 'revenue';
	const requested = params.get('app') ?? '';
	const appId = requested && scopeCoversApp(scope, requested) ? requested : '';
	const filter = appId ? [appId] : scope.appIds;
	const dimension = DIMENSIONS.includes(params.get('by') as Dimension)
		? (params.get('by') as Dimension)
		: 'country';

	const appRows = await db
		.select({ id: apps.id, name: apps.name, activationEvent: apps.activationEvent })
		.from(apps)
		.where(scope.appIds === null ? undefined : inArray(apps.id, scope.appIds.length ? scope.appIds : ['']))
		.orderBy(apps.name);

	const base = { tab, appId, apps: appRows.map(({ id, name }) => ({ id, name })), dimension };

	if (tab === 'revenue') {
		const [mix, flow, plans, timing] = await Promise.all([
			revenueMix(db, filter),
			cashflow(db, filter),
			mrrByPlan(db, filter),
			lifecycleTiming(db, filter)
		]);
		return { ...base, revenue: { mix, flow, plans, timing } };
	}

	if (tab === 'retention') {
		const [installsByCohort, revenueByCohort] = await Promise.all([
			installCohorts(db, filter),
			revenueCohorts(db, filter)
		]);
		return { ...base, retention: { installs: installsByCohort, revenue: revenueByCohort } };
	}

	if (tab === 'customers') {
		const [breakdown, reasons] = await Promise.all([
			customerBreakdown(db, filter, dimension),
			uninstallReasons(db, filter)
		]);
		return { ...base, customers: { breakdown, reasons } };
	}

	if (tab === 'acquisition') {
		const [traffic, ranks] = await Promise.all([trafficReport(db, filter), keywordReport(db, filter)]);
		return { ...base, acquisition: { traffic, ranks } };
	}

	const targets = appId ? appRows.filter((a) => a.id === appId) : appRows;
	const [summary, risk, activation] = await Promise.all([
		engagementSummary(db, filter),
		churnRisk(db, filter),
		Promise.all(
			targets
				.filter((a) => a.activationEvent)
				.map(async (a) => ({ app: a.name, ...(await activationRate(db, a.id))! }))
		)
	]);
	return { ...base, engagement: { summary, risk, activation } };
};
