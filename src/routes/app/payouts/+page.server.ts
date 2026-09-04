import { desc, eq, inArray } from 'drizzle-orm';
import { requireAffiliate } from '$lib/server/guards';
import { apps, commissions, payouts } from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const user = requireAffiliate(event);
	const db = event.locals.db;

	const rows = await db
		.select()
		.from(payouts)
		.where(eq(payouts.affiliateId, user.affiliateId))
		.orderBy(desc(payouts.createdAt))
		.limit(50);

	const lines = rows.length
		? await db
				.select({
					payoutId: commissions.payoutId,
					id: commissions.id,
					amountCents: commissions.amountCents,
					chargeType: commissions.chargeType,
					occurredAt: commissions.occurredAt,
					appName: apps.name
				})
				.from(commissions)
				.innerJoin(apps, eq(apps.id, commissions.appId))
				.where(inArray(commissions.payoutId, rows.map((r) => r.id)))
				.orderBy(desc(commissions.occurredAt))
		: [];

	return {
		payouts: rows.map((payout) => ({
			...payout,
			lines: lines.filter((line) => line.payoutId === payout.id)
		}))
	};
};
