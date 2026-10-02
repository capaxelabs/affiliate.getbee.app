import { eq, inArray } from 'drizzle-orm';
import type { DrizzleClient } from '$lib/server/db';
import { appCharges, appCredits, chargeEvents, usageCharges } from '$lib/server/db/schema';
import { chunkRows, runBatch } from '$lib/server/db/batch';
import { toCents, type PartnerBillingEvent, type PartnerChargeEvent } from './partner-api';
import { notify } from './notifications';
import { normalizeShopDomain } from './referral';
import { isInternalDomain } from './internal-shops';

type ChargeStatus = (typeof appCharges.$inferSelect)['status'];

/**
 * What each event does to a charge. A charge is a little state machine and the
 * event feed is its transition log, so the current row is just the last
 * transition folded in.
 */
const STATUS_FOR_ACTION: Record<PartnerChargeEvent['action'], ChargeStatus> = {
	accepted: 'pending',
	activated: 'active',
	// Shopify freezes a subscription when the shop is closed or suspended. The
	// plan is not cancelled — it resumes if the shop comes back — so it is not
	// revenue today and not lost either.
	frozen: 'frozen',
	unfrozen: 'active',
	cancelled: 'cancelled',
	expired: 'expired',
	declined: 'declined'
};

const ENDED: ChargeStatus[] = ['cancelled', 'expired', 'declined'];

function dateOrNull(value: string | null | undefined) {
	if (!value) return null;
	// billingOn is a bare date ("2026-10-12"); everything else is an ISO stamp.
	const parsed = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export type ChargeSyncResult = {
	seen: number;
	written: number;
	/** Shops whose charge trail moved, so their subscriptions need a rebuild. */
	shops: Set<string>;
};

/**
 * Folds a window of charge events into `app_charges`, one row per charge.
 *
 * Test charges are dropped rather than stored. Most of the history on a
 * developed app is a developer clicking through plans on a dev store — 83 of
 * Shootflo Studio's 92 charge events, and 281 of 330 across the eight apps —
 * and keeping them would both distort every total and cost a write each, which
 * on Workers is a subrequest against a hard per-request cap.
 *
 * Events are grouped by charge before anything is written, so a charge that
 * was accepted, activated and cancelled inside one window costs one write
 * rather than three. A re-read of an overlapping window is a no-op: a stored
 * row only moves when the incoming event is newer than the one it already has.
 *
 * Every event also lands in `charge_events`, older ones included — the row
 * only needs the latest status, but freezes and plan changes live in the trail.
 */
export async function applyChargeEvents(
	db: DrizzleClient,
	options: {
		appId: string;
		events: PartnerChargeEvent[];
		knownInternal?: Set<string>;
		merchantIdFor?: (shopDomain: string) => string | null | undefined;
	}
): Promise<ChargeSyncResult> {
	const byCharge = new Map<string, PartnerChargeEvent[]>();

	for (const event of options.events) {
		if (event.test) continue;
		const shopDomain = event.shopDomain && normalizeShopDomain(event.shopDomain);
		if (!shopDomain || isInternalDomain(shopDomain)) continue;
		if (options.knownInternal?.has(shopDomain)) continue;

		const list = byCharge.get(event.chargeId) ?? [];
		list.push({ ...event, shopDomain });
		byCharge.set(event.chargeId, list);
	}

	if (!byCharge.size) return { seen: 0, written: 0, shops: new Set() };

	// D1 caps bound parameters at 100 per query, and every id in an IN list binds
	// one. A two-year backfill of a busy app can easily pass that, so the lookup
	// is chunked rather than sent as one statement.
	const ids = [...byCharge.keys()];
	const existing = new Map<string, typeof appCharges.$inferSelect>();

	for (let i = 0; i < ids.length; i += 90) {
		const rows = await db
			.select()
			.from(appCharges)
			.where(inArray(appCharges.partnerChargeId, ids.slice(i, i + 90)));
		for (const row of rows) existing.set(row.partnerChargeId, row);
	}

	let written = 0;
	const shops = new Set<string>();
	const trail: (typeof chargeEvents.$inferInsert)[] = [];

	for (const [chargeId, events] of byCharge) {
		const ordered = [...events].sort(
			(a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime()
		);
		const latest = ordered[ordered.length - 1];
		const latestAt = new Date(latest.occurredAt);
		const stored = existing.get(chargeId);

		// Everything about the charge except its status is stable, so a stale
		// event can still fill in a detail we never had.
		const activated = ordered.find((e) => e.action === 'activated');
		const shopDomain = latest.shopDomain!;
		const status = STATUS_FOR_ACTION[latest.action];
		const amountCents = toCents(
			(activated ?? latest).amount?.amount ?? latest.amount?.amount ?? null
		);

		let rowId = stored?.id;

		if (stored && stored.occurredAt >= latestAt) {
			trail.push(...trailFor(rowId!, options.appId, ordered));
			continue;
		}

		const patch = {
			appId: options.appId,
			merchantId: options.merchantIdFor?.(shopDomain) ?? stored?.merchantId ?? null,
			shopDomain,
			kind: latest.kind,
			name: latest.name ?? stored?.name ?? null,
			amountCents: amountCents || (stored?.amountCents ?? 0),
			currency: (activated ?? latest).amount?.currencyCode ?? stored?.currency ?? 'USD',
			status,
			activatedAt: activated ? new Date(activated.occurredAt) : (stored?.activatedAt ?? null),
			billingOn:
				dateOrNull(latest.billingOn) ?? (status === 'active' ? stored?.billingOn : null) ?? null,
			endedAt: ENDED.includes(status) ? latestAt : null,
			occurredAt: latestAt,
			updatedAt: new Date()
		};

		if (stored) {
			await db.update(appCharges).set(patch).where(eq(appCharges.id, stored.id));
		} else {
			const [created] = await db
				.insert(appCharges)
				.values({ partnerChargeId: chargeId, ...patch })
				.returning({ id: appCharges.id });
			rowId = created.id;
		}
		written++;
		trail.push(...trailFor(rowId!, options.appId, ordered));
	}

	// The trail is written whether or not the row moved: a CSV import carries
	// history older than anything the row remembers. Every shop in the window
	// is handed back for a rebuild — cheaper than finding out which rows were new.
	await runBatch(
		db,
		chunkRows(trail, 7).map((rows) => db.insert(chargeEvents).values(rows).onConflictDoNothing())
	);
	for (const events of byCharge.values()) shops.add(events[0].shopDomain!);

	return { seen: byCharge.size, written, shops };
}

function trailFor(
	chargeRowId: string,
	appId: string,
	events: PartnerChargeEvent[]
): (typeof chargeEvents.$inferInsert)[] {
	return events.map((event) => ({
		chargeId: chargeRowId,
		appId,
		action: event.action,
		amountCents: event.amount ? toCents(event.amount.amount) : null,
		billingOn: dateOrNull(event.billingOn),
		occurredAt: new Date(event.occurredAt)
	}));
}

/**
 * Usage applied inside a cycle, credits issued, and capped-amount warnings.
 * Usage and credits are stored; a subscription nearing its cap is an alert,
 * because the next usage charge past it will be declined.
 */
export async function applyBillingEvents(
	db: DrizzleClient,
	options: {
		appId: string;
		appName: string;
		events: PartnerBillingEvent[];
		knownInternal?: Set<string>;
		merchantIdFor?: (shopDomain: string) => string | null | undefined;
	}
) {
	const usage: (typeof usageCharges.$inferInsert)[] = [];
	const credits: (typeof appCredits.$inferInsert)[] = [];
	const recent = Date.now() - 48 * 60 * 60 * 1000;

	for (const event of options.events) {
		if (event.test) continue;
		const shopDomain = event.shopDomain && normalizeShopDomain(event.shopDomain);
		if (!shopDomain || isInternalDomain(shopDomain) || options.knownInternal?.has(shopDomain)) {
			continue;
		}
		const base = {
			appId: options.appId,
			merchantId: options.merchantIdFor?.(shopDomain) ?? null,
			shopDomain,
			name: event.name,
			amountCents: toCents(event.amount?.amount),
			currency: event.amount?.currencyCode ?? 'USD',
			occurredAt: new Date(event.occurredAt)
		};

		if (event.kind === 'usage') usage.push({ ...base, partnerRecordId: event.id });
		else if (event.kind === 'credit') credits.push({ ...base, partnerCreditId: event.id });
		else if (+base.occurredAt >= recent) {
			const day = event.occurredAt.slice(0, 10);
			await notify(db, {
				key: `cap:${event.kind}:${event.id}:${day}`,
				topic: 'subscriptions',
				text:
					event.kind === 'cap_approaching'
						? `:warning: *${options.appName}*: ${shopDomain} is close to the usage cap on ${event.name ?? 'their plan'}. Usage past it will be declined.`
						: `:arrow_up: *${options.appName}*: ${shopDomain} raised the usage cap on ${event.name ?? 'their plan'}`
			});
		}
	}

	await runBatch(db, [
		...chunkRows(usage, 9).map((rows) => db.insert(usageCharges).values(rows).onConflictDoNothing()),
		...chunkRows(credits, 9).map((rows) => db.insert(appCredits).values(rows).onConflictDoNothing())
	]);

	return { usage: usage.length, credits: credits.length };
}
