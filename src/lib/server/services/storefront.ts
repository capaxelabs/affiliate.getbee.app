import { eq, sql } from 'drizzle-orm';
import type { DrizzleClient } from '$lib/server/db';
import { installs, merchants } from '$lib/server/db/schema';
import { applyLifecycleEvent } from './merchant';

/**
 * Closes installs on stores Shopify has shut, and reopens them when they return.
 *
 * Shopify sends no RelationshipDeactivated for many frozen or paused stores, so
 * the Partner sync leaves them live forever. Their storefront answers 423 with
 * "This store is unavailable", which is the one signal we can read. Only 423
 * counts: a password page or a timeout says nothing about whether the store
 * still trades.
 */
export async function checkStorefronts(db: DrizzleClient) {
	const latestSource = sql<string | null>`(
		select e.source from install_events e
		where e.install_id = ${installs.id} and e.type in ('installed', 'uninstalled', 'deactivated')
		order by e.occurred_at desc limit 1
	)`;

	const rows = await db
		.select({
			id: installs.id,
			appId: installs.appId,
			merchantId: installs.merchantId,
			status: installs.status,
			shopDomain: merchants.shopDomain,
			latestSource
		})
		.from(installs)
		.innerJoin(merchants, eq(merchants.id, installs.merchantId))
		.where(
			sql`${installs.status} = 'installed' or (${installs.status} = 'closed' and ${latestSource} = 'storefront')`
		);

	const domains = [...new Set(rows.map((r) => r.shopDomain))];
	const unavailable = new Set<string>();
	const reachable = new Set<string>();

	// Ten at a time: every fetch is a subrequest, and Shopify throttles bursts.
	for (let i = 0; i < domains.length; i += 10) {
		await Promise.all(
			domains.slice(i, i + 10).map(async (domain) => {
				try {
					const res = await fetch(`https://${domain}/`, {
						redirect: 'manual',
						headers: { 'user-agent': 'Mozilla/5.0 (compatible; BeeAffiliates/1.0)' },
						signal: AbortSignal.timeout(15_000)
					});
					if (res.status === 423) unavailable.add(domain);
					else if (res.status < 500 && res.status !== 429) reachable.add(domain);
				} catch {
					// Unknown is not closed.
				}
			})
		);
	}

	const now = new Date();
	let closed = 0;
	let reopened = 0;

	for (const row of rows) {
		const shutNow = unavailable.has(row.shopDomain);
		if (row.status === 'installed' && shutNow) {
			await applyLifecycleEvent(db, {
				installId: row.id,
				appId: row.appId,
				merchantId: row.merchantId,
				type: 'deactivated',
				occurredAt: now,
				source: 'storefront',
				metadata: { storefront: 423 }
			});
			closed++;
		} else if (row.status === 'closed' && reachable.has(row.shopDomain)) {
			await applyLifecycleEvent(db, {
				installId: row.id,
				appId: row.appId,
				merchantId: row.merchantId,
				type: 'installed',
				occurredAt: now,
				source: 'storefront',
				metadata: { storefront: 'reopened' }
			});
			reopened++;
		}
	}

	return { checked: domains.length, closed, reopened };
}
