import { and, desc, eq, like, or, sql } from 'drizzle-orm';
import { requireAffiliateVisibility, appScopeFilter } from '$lib/server/scope';
import { affiliates, commissions, referrals, users } from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';

const STATUSES = ['pending', 'approved', 'rejected', 'suspended'] as const;

export const load: PageServerLoad = async (event) => {
	const scope = await requireAffiliateVisibility(event);

	const search = event.url.searchParams.get('q')?.trim().toLowerCase() ?? '';
	const statusParam = event.url.searchParams.get('status') ?? '';
	const status = (STATUSES as readonly string[]).includes(statusParam) ? statusParam : '';

	const filters = [];
	if (status) filters.push(eq(affiliates.status, status as (typeof STATUSES)[number]));

	// Staff only see affiliates who have a referral in one of their apps.
	if (scope.appIds !== null) {
		filters.push(
			scope.appIds.length
				? sql`exists (
						select 1 from referrals r
						where r.affiliate_id = affiliates.id
						and r.app_id in (${sql.join(scope.appIds.map((id) => sql`${id}`), sql`, `)})
					)`
				: sql`1 = 0`
		);
	}
	if (search) {
		filters.push(
			or(
				like(users.email, `%${search}%`),
				like(users.name, `%${search}%`),
				like(affiliates.refCode, `%${search.toUpperCase()}%`)
			)
		);
	}

	const rows = await event.locals.db
		.select({
			id: affiliates.id,
			refCode: affiliates.refCode,
			status: affiliates.status,
			company: affiliates.company,
			createdAt: affiliates.createdAt,
			name: users.name,
			email: users.email,
			referralCount: sql<number>`(select count(*) from referrals r where r.affiliate_id = affiliates.id)`,
			earnedCents: sql<number>`(
				select coalesce(sum(c.amount_cents), 0) from commissions c
				where c.affiliate_id = affiliates.id
			)`
		})
		.from(affiliates)
		.innerJoin(users, eq(users.id, affiliates.userId))
		.where(filters.length ? and(...filters) : undefined)
		.orderBy(desc(affiliates.createdAt))
		.limit(200);

	return {
		canWrite: scope.canWrite,
		affiliates: rows.map((r) => ({
			...r,
			referralCount: Number(r.referralCount ?? 0),
			earnedCents: Number(r.earnedCents ?? 0)
		})),
		search,
		status
	};
};
