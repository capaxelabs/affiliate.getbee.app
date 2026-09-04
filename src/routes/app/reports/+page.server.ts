import { requireAffiliate } from '$lib/server/guards';
import { affiliateReport } from '$lib/server/services/stats';
import type { PageServerLoad } from './$types';

const RANGES = {
	'30d': { label: 'Last 30 days', days: 30 },
	'90d': { label: 'Last 90 days', days: 90 },
	'12m': { label: 'Last 12 months', days: 365 },
	all: { label: 'All time', days: 3650 }
} as const;

export type RangeKey = keyof typeof RANGES;

export const load: PageServerLoad = async (event) => {
	const user = requireAffiliate(event);

	const key = event.url.searchParams.get('range') as RangeKey;
	const range = RANGES[key] ? key : '12m';
	const to = new Date();
	const from = new Date(to.getTime() - RANGES[range].days * 24 * 60 * 60 * 1000);

	return {
		range,
		ranges: Object.entries(RANGES).map(([value, { label }]) => ({ value, label })),
		report: await affiliateReport(event.locals.db, user.affiliateId, from, to)
	};
};
