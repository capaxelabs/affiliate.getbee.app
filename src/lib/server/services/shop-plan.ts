import { sql, type AnyColumn, type SQL } from 'drizzle-orm';

/**
 * Whether a shop pays Shopify, read from the plan name the apps report.
 *
 * Apps send either Shopify's display name ("Basic", "Grow") or the API handle
 * ("basic", "professional"), so both spellings are listed. Anything not listed
 * is `unknown` rather than paid: ShootFlo reports "Regular" for every shop that
 * is neither Plus nor a dev store, trials included, and some apps fall back to
 * their own plan name ("free", "pro") when they have no Shopify plan.
 */
export const STORE_TYPES = ['paid', 'dev', 'trial', 'inactive', 'unknown'] as const;
export type StoreType = (typeof STORE_TYPES)[number];

const PLANS: Record<Exclude<StoreType, 'unknown'>, string[]> = {
	paid: [
		'basic',
		'grow',
		'shopify',
		'professional',
		'advanced',
		'unlimited',
		'plus',
		'shopify plus',
		'shopify_plus',
		'starter',
		'retail',
		'lite'
	],
	dev: [
		'development',
		'developer preview',
		'affiliate',
		'partner_test',
		'plus_partner_sandbox',
		'staff',
		'staff_business',
		'staff business'
	],
	trial: ['trial', 'free trial', 'paid_trial', 'paid trial', 'plus trial'],
	inactive: ['frozen', 'cancelled', 'dormant', 'fraudulent', 'closed', 'paused', 'inactive']
};

/** Dev stores that simulate a plan report it as "Basic App Development". */
const DEV_SUFFIX = 'app development';

export function storeType(plan: string | null | undefined): StoreType {
	const name = (plan ?? '').trim().toLowerCase();
	if (name.endsWith(DEV_SUFFIX)) return 'dev';
	for (const type of ['paid', 'dev', 'trial', 'inactive'] as const) {
		if (PLANS[type].includes(name)) return type;
	}
	return 'unknown';
}

// Inlined rather than bound: D1 caps a query at 100 parameters, and these are
// constants from this file.
const list = (names: string[]) => sql.raw(names.map((n) => `'${n}'`).join(', '));

/** The same classification as `storeType`, as a SQL expression over a plan column. */
export function storeTypeSql(column: AnyColumn | SQL) {
	const name = sql`lower(trim(coalesce(${column}, '')))`;
	return sql<StoreType>`case
		when ${name} like ${sql.raw(`'%${DEV_SUFFIX}'`)} or ${name} in (${list(PLANS.dev)}) then 'dev'
		when ${name} in (${list(PLANS.paid)}) then 'paid'
		when ${name} in (${list(PLANS.trial)}) then 'trial'
		when ${name} in (${list(PLANS.inactive)}) then 'inactive'
		else 'unknown' end`;
}
