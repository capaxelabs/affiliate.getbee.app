import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { DrizzleClient } from '$lib/server/db';
import {
	appCharges,
	chargeEvents,
	installEvents,
	merchants,
	subscriptionEvents,
	transactions
} from '$lib/server/db/schema';
import { chunkRows, runBatch } from '$lib/server/db/batch';

/**
 * Subscriptions, derived.
 *
 * The Partner API hands back two streams: what happened to each charge, and the
 * money Shopify later collected. Neither says what MRR was on a date, whether a
 * merchant was on a trial, or that a cancel followed by an activation a second
 * later is an upgrade and not a lost customer. This module works that out for
 * one shop at a time and writes it in two places: derived columns on
 * `app_charges` (the current state) and the `subscription_events` ledger (how
 * it got there, with a signed MRR change on every row).
 *
 * The ledger is the history. MRR on any date is the sum of `mrr_delta_cents`
 * up to that date, and by construction that sum today equals MRR read from
 * `app_charges` — `subscriptionConsistency` checks it.
 */

const DAY = 24 * 60 * 60 * 1000;

/**
 * Shopify models a plan change as cancel-old, activate-new in one operation,
 * milliseconds apart. A minute absorbs that and nothing more: anything wider
 * starts pairing a merchant who left and came back with themselves.
 */
const PLAN_CHANGE_MS = 60 * 1000;
/** The feed occasionally emits the new activation just ahead of the old cancel. */
const PLAN_CHANGE_EARLY_MS = 5 * 1000;

/** A billing date this far out can only be an annual cycle. */
const ANNUAL_GAP_DAYS = 360;

/** A shorter wait before the first bill is rounding, not a trial. */
const TRIAL_MIN_GAP_DAYS = 2;

const ANNUAL_NAME = /\b(annual(ly)?|yearly|per year|a year|\/\s?(yr|year))\b/i;

export type ChargeInput = {
	id: string;
	partnerChargeId: string;
	kind: 'recurring' | 'one_time' | 'usage' | 'credit';
	name: string | null;
	amountCents: number;
	status: string;
	activatedAt: Date | null;
	billingOn: Date | null;
	merchantId: string | null;
	shopDomain: string;
};

export type TrailInput = {
	chargeId: string;
	action: 'accepted' | 'activated' | 'frozen' | 'unfrozen' | 'cancelled' | 'expired' | 'declined';
	occurredAt: Date;
	billingOn: Date | null;
};

export type SaleInput = {
	partnerChargeId: string;
	firstSaleAt: Date;
	billingInterval: 'monthly' | 'annual' | null;
};

export type DepartureInput = {
	type: 'installed' | 'uninstalled' | 'deactivated';
	occurredAt: Date;
};

export type DerivedCharge = {
	id: string;
	billingInterval: 'monthly' | 'annual';
	monthlyAmountCents: number;
	paidAt: Date | null;
	trialStatus: 'none' | 'in_trial' | 'converted' | 'cancelled';
	trialEndsAt: Date | null;
	churnedAt: Date | null;
	churnReason: 'cancelled' | 'uninstalled' | 'closed' | 'plan_change' | null;
	replacesChargeId: string | null;
};

export type LedgerEvent = Omit<typeof subscriptionEvents.$inferInsert, 'id'>;

type Working = {
	charge: ChargeInput;
	trail: TrailInput[];
	activatedAt: Date | null;
	endAt: Date | null;
	endReason: 'cancelled' | 'uninstalled' | 'closed' | null;
	interval: 'monthly' | 'annual';
	monthly: number;
	paidAt: Date | null;
	trialStatus: DerivedCharge['trialStatus'];
	trialEndsAt: Date | null;
	replaces: Working | null;
	replacedBy: Working | null;
};

const days = (from: Date, to: Date) => (to.getTime() - from.getTime()) / DAY;
const ENDING = new Set(['cancelled', 'expired', 'declined']);

/**
 * Everything about one shop's subscriptions to one app, from its raw inputs.
 * Pure, so it can be reasoned about and tested without a database.
 */
export function deriveShop(input: {
	appId: string;
	charges: ChargeInput[];
	trail: TrailInput[];
	sales: SaleInput[];
	departures: DepartureInput[];
	now?: Date;
}): { charges: DerivedCharge[]; ledger: LedgerEvent[] } {
	const now = input.now ?? new Date();
	const salesByCharge = new Map(input.sales.map((s) => [s.partnerChargeId, s]));
	const departures = [...input.departures].sort((a, b) => +a.occurredAt - +b.occurredAt);

	const trailByCharge = new Map<string, TrailInput[]>();
	for (const event of input.trail) {
		const list = trailByCharge.get(event.chargeId) ?? [];
		list.push(event);
		trailByCharge.set(event.chargeId, list);
	}

	const working: Working[] = input.charges
		.filter((c) => c.kind === 'recurring')
		.map((charge) => {
			const trail = (trailByCharge.get(charge.id) ?? []).sort(
				(a, b) => +a.occurredAt - +b.occurredAt
			);
			const activation = trail.find((e) => e.action === 'activated');
			const activatedAt = activation?.occurredAt ?? charge.activatedAt;
			const ending = trail.find(
				(e) => ENDING.has(e.action) && (!activatedAt || e.occurredAt >= activatedAt)
			);

			let endAt = ending?.occurredAt ?? null;
			let endReason: Working['endReason'] = ending ? 'cancelled' : null;

			// Shopify does not always pair an uninstall with a cancel. A store
			// closure is answered with a freeze instead — the store can reopen —
			// so it only ends the subscription when no freeze follows.
			if (activatedAt && !endAt) {
				const gone = departures.find((d) => d.type !== 'installed' && d.occurredAt > activatedAt);
				if (gone?.type === 'uninstalled') {
					endAt = gone.occurredAt;
					endReason = 'uninstalled';
				} else if (gone?.type === 'deactivated') {
					const frozeAfter = trail.some(
						(e) => e.action === 'frozen' && e.occurredAt >= gone.occurredAt
					);
					if (!frozeAfter) {
						endAt = gone.occurredAt;
						endReason = 'closed';
					}
				}
			}

			const sale = salesByCharge.get(charge.partnerChargeId);
			const billingOn = activation?.billingOn ?? charge.billingOn;
			const gap = activatedAt && billingOn ? days(activatedAt, billingOn) : null;

			const interval: Working['interval'] =
				sale?.billingInterval ??
				(gap !== null && gap >= ANNUAL_GAP_DAYS
					? 'annual'
					: ANNUAL_NAME.test(charge.name ?? '')
						? 'annual'
						: 'monthly');

			return {
				charge,
				trail,
				activatedAt,
				endAt,
				endReason,
				interval,
				monthly: interval === 'annual' ? Math.round(charge.amountCents / 12) : charge.amountCents,
				paidAt: null,
				trialStatus: 'none' as const,
				trialEndsAt: null,
				replaces: null,
				replacedBy: null
			};
		})
		.sort((a, b) => +(a.activatedAt ?? 0) - +(b.activatedAt ?? 0));

	// Plan changes: an ended charge followed within a minute by another charge
	// activating on the same shop.
	for (const old of working) {
		if (!old.endAt || old.endReason !== 'cancelled') continue;
		const next = working.find(
			(w) =>
				w !== old &&
				!w.replaces &&
				w.activatedAt &&
				+w.activatedAt - +old.endAt! <= PLAN_CHANGE_MS &&
				+old.endAt! - +w.activatedAt <= PLAN_CHANGE_EARLY_MS &&
				(!old.activatedAt || w.activatedAt >= old.activatedAt)
		);
		if (next) {
			old.replacedBy = next;
			next.replaces = old;
		}
	}

	// When each charge starts counting, and whether it ran a trial. Walked in
	// activation order, because "had this shop already paid" depends on the
	// charges before it.
	for (const w of working) {
		const { charge, activatedAt } = w;
		if (!activatedAt) continue;

		if (charge.amountCents <= 0) {
			w.paidAt = activatedAt;
			continue;
		}

		const billingOn = w.trail.find((e) => e.action === 'activated')?.billingOn ?? charge.billingOn;
		const gap = billingOn ? days(activatedAt, billingOn) : null;
		const cycleDays = (w.interval === 'annual' ? 365 : 30) - 1;

		// Shopify grants a shop one trial per app. A returning customer whose
		// first bill looks close is finishing a cycle they already paid for.
		const paidBefore = working.some(
			(other) =>
				other !== w &&
				other.charge.amountCents > 0 &&
				other.paidAt !== null &&
				other.paidAt <= activatedAt
		);

		// No billing date at all is old history; assume it was billed, as the
		// dashboard always has.
		const billedUpFront = gap === null || gap >= cycleDays || paidBefore;
		const sale = salesByCharge.get(charge.partnerChargeId);

		if (billedUpFront) {
			w.paidAt = activatedAt;
		} else if (sale) {
			w.paidAt = sale.firstSaleAt;
		} else if (billingOn && (!w.endAt || w.endAt > billingOn)) {
			// Can be in the future: a trial still running. Every MRR read
			// compares against now, and a daily refresh moves the ledger on.
			w.paidAt = billingOn;
		}

		if (!billedUpFront && billingOn && gap !== null && gap > TRIAL_MIN_GAP_DAYS) {
			w.trialEndsAt = billingOn;
			if (sale || (w.paidAt && w.paidAt <= now)) w.trialStatus = 'converted';
			else if (w.endAt && w.endAt <= billingOn) w.trialStatus = 'cancelled';
			else w.trialStatus = 'in_trial';
		}
	}

	const ledger: LedgerEvent[] = [];
	const due = (at: Date | null): at is Date => Boolean(at && at <= now);

	const base = (w: Working) => ({
		appId: input.appId,
		chargeId: w.charge.id,
		merchantId: w.charge.merchantId,
		shopDomain: w.charge.shopDomain,
		planName: w.charge.name
	});

	/** What a charge contributes to MRR at the moment it ends. */
	const contributionAtEnd = (w: Working) => {
		if (!w.paidAt || !w.endAt || w.paidAt >= w.endAt) return 0;
		const frozen = w.trail
			.filter((e) => e.occurredAt < w.endAt! && e.occurredAt >= w.paidAt!)
			.reduce(
				(state, e) => (e.action === 'frozen' ? true : e.action === 'unfrozen' ? false : state),
				false
			);
		return frozen ? 0 : w.monthly;
	};

	/**
	 * A charge that counted and was replaced by one that also counts carries
	 * its MRR forward: the replacement books the difference as an upgrade or
	 * downgrade, and this one does not churn.
	 */
	const handsOver = (w: Working) =>
		Boolean(
			w.replacedBy && due(w.replacedBy.paidAt) && due(w.paidAt) && w.endAt && w.paidAt < w.endAt
		);

	/** Follows plan changes to the charge the merchant ended up on. */
	const chainEnd = (w: Working) => {
		let last = w;
		while (last.replacedBy) last = last.replacedBy;
		return last;
	};

	for (const w of working) {
		// A plan change inside a trial is the same trial continuing — Shopify
		// carries the unused days onto the new charge — so it starts once, on
		// the first charge, and ends however the last charge in the chain ends.
		const continuesTrial = Boolean(w.replaces && w.replaces.trialStatus !== 'none');

		if (w.trialStatus !== 'none' && !continuesTrial) {
			const last = chainEnd(w);
			if (last !== w) {
				w.trialStatus = due(last.paidAt) ? 'converted' : due(last.endAt) ? 'cancelled' : 'in_trial';
			}
			const outcomeAt = w.trialStatus === 'converted' ? last.paidAt : last.endAt;

			if (due(w.activatedAt)) {
				ledger.push({
					...base(w),
					type: 'trial_started',
					occurredAt: w.activatedAt,
					monthlyAmountCents: w.monthly
				});
			}
			if (w.trialStatus === 'converted' && due(outcomeAt)) {
				ledger.push({
					...base(w),
					type: 'trial_converted',
					occurredAt: outcomeAt,
					monthlyAmountCents: last.monthly
				});
			}
			if (w.trialStatus === 'cancelled' && due(outcomeAt)) {
				ledger.push({
					...base(w),
					type: 'trial_cancelled',
					occurredAt: outcomeAt,
					monthlyAmountCents: last.monthly,
					churnReason: last.endReason
				});
			}
		}

		const start = w.paidAt;
		if (!due(start) || (w.endAt && start >= w.endAt)) continue;

		let contribution = 0;
		let frozen = false;
		const value = () => (frozen ? 0 : w.monthly);

		// Start: a new customer, a returning one, or a plan change.
		const previous = w.replaces && handsOver(w.replaces) ? w.replaces : null;
		if (previous) {
			const carried = contributionAtEnd(previous);
			const delta = value() - carried;
			contribution = value();
			if (delta !== 0) {
				ledger.push({
					...base(w),
					type: delta > 0 ? 'upgraded' : 'downgraded',
					mrrDeltaCents: delta,
					monthlyAmountCents: w.monthly,
					occurredAt: start
				});
			}
		} else {
			contribution = value();
			const returning = working.some(
				(o) =>
					o !== w && o.monthly > 0 && o.paidAt && o.endAt && o.endAt <= start && o.paidAt < o.endAt
			);
			if (w.monthly > 0) {
				ledger.push({
					...base(w),
					type: returning ? 'reactivated' : 'new',
					mrrDeltaCents: contribution,
					monthlyAmountCents: w.monthly,
					occurredAt: start
				});
			}
		}

		for (const e of w.trail) {
			if (e.occurredAt < start || (w.endAt && e.occurredAt >= w.endAt) || !due(e.occurredAt))
				continue;
			if (e.action !== 'frozen' && e.action !== 'unfrozen') continue;
			const was = contribution;
			frozen = e.action === 'frozen';
			contribution = value();
			if (contribution !== was) {
				ledger.push({
					...base(w),
					type: e.action,
					mrrDeltaCents: contribution - was,
					monthlyAmountCents: w.monthly,
					occurredAt: e.occurredAt
				});
			}
		}

		if (due(w.endAt) && !handsOver(w) && (w.monthly > 0 || contribution !== 0)) {
			ledger.push({
				...base(w),
				type: 'churned',
				mrrDeltaCents: -contribution,
				monthlyAmountCents: 0,
				churnReason: w.endReason,
				occurredAt: w.endAt
			});
		}
	}

	return {
		charges: working.map((w) => ({
			id: w.charge.id,
			billingInterval: w.interval,
			monthlyAmountCents: w.monthly,
			paidAt: w.paidAt,
			trialStatus: w.trialStatus,
			trialEndsAt: w.trialEndsAt,
			churnedAt: due(w.endAt) ? w.endAt : null,
			churnReason: !due(w.endAt) ? null : w.replacedBy ? 'plan_change' : w.endReason,
			replacesChargeId: w.replaces?.charge.partnerChargeId ?? null
		})),
		ledger: ledger.sort((a, b) => +a.occurredAt - +b.occurredAt)
	};
}

/**
 * Re-derives the given shops' subscriptions to one app and rewrites their
 * ledger rows. Safe to run any number of times; the result depends only on
 * what is stored.
 *
 * Costs five reads per chunk of shops and one batched write, so it stays
 * inside the Workers subrequest cap however many shops a sync touched.
 */
export async function rebuildSubscriptions(
	db: DrizzleClient,
	appId: string,
	shopDomains: Iterable<string>,
	now = new Date()
): Promise<{ shops: number; events: number }> {
	const shops = [...new Set(shopDomains)].filter(Boolean);
	let events = 0;

	for (let i = 0; i < shops.length; i += 40) {
		const chunk = shops.slice(i, i + 40);

		const charges = await db
			.select()
			.from(appCharges)
			.where(and(eq(appCharges.appId, appId), inArray(appCharges.shopDomain, chunk)));

		const chargeIds = charges.map((c) => c.id);
		const partnerIds = charges.map((c) => c.partnerChargeId);

		const trail: TrailInput[] = [];
		const sales: SaleInput[] = [];
		for (let j = 0; j < chargeIds.length; j += 90) {
			const rows = await db
				.select({
					chargeId: chargeEvents.chargeId,
					action: chargeEvents.action,
					occurredAt: chargeEvents.occurredAt,
					billingOn: chargeEvents.billingOn
				})
				.from(chargeEvents)
				.where(inArray(chargeEvents.chargeId, chargeIds.slice(j, j + 90)));
			trail.push(...rows);

			const saleRows = await db
				.select({
					partnerChargeId: transactions.partnerChargeId,
					firstSaleAt: sql<number>`min(${transactions.occurredAt})`,
					billingInterval: sql<string | null>`max(${transactions.billingInterval})`
				})
				.from(transactions)
				.where(
					and(
						inArray(transactions.partnerChargeId, partnerIds.slice(j, j + 90)),
						eq(transactions.chargeType, 'recurring')
					)
				)
				.groupBy(transactions.partnerChargeId);
			for (const s of saleRows) {
				if (!s.partnerChargeId) continue;
				sales.push({
					partnerChargeId: s.partnerChargeId,
					firstSaleAt: new Date(Number(s.firstSaleAt) * 1000),
					billingInterval:
						s.billingInterval === 'annual' || s.billingInterval === 'monthly'
							? s.billingInterval
							: null
				});
			}
		}

		const departureRows = await db
			.select({
				shopDomain: merchants.shopDomain,
				type: installEvents.type,
				occurredAt: installEvents.occurredAt
			})
			.from(installEvents)
			.innerJoin(merchants, eq(merchants.id, installEvents.merchantId))
			.where(
				and(
					eq(installEvents.appId, appId),
					inArray(merchants.shopDomain, chunk),
					inArray(installEvents.type, ['installed', 'uninstalled', 'deactivated'])
				)
			);

		const statements: BatchItem<'sqlite'>[] = [];
		const ledger: LedgerEvent[] = [];

		for (const shop of chunk) {
			const shopCharges = charges.filter((c) => c.shopDomain === shop);
			const ids = new Set(shopCharges.map((c) => c.id));
			const partner = new Set(shopCharges.map((c) => c.partnerChargeId));

			const derived = deriveShop({
				appId,
				now,
				charges: shopCharges,
				trail: trail.filter((t) => ids.has(t.chargeId)),
				sales: sales.filter((s) => partner.has(s.partnerChargeId)),
				departures: departureRows
					.filter((d) => d.shopDomain === shop)
					.map((d) => ({ type: d.type as DepartureInput['type'], occurredAt: d.occurredAt }))
			});

			for (const d of derived.charges) {
				const stored = shopCharges.find((c) => c.id === d.id)!;
				if (sameDerived(stored, d)) continue;
				const { id, ...patch } = d;
				statements.push(db.update(appCharges).set(patch).where(eq(appCharges.id, id)));
			}
			ledger.push(...derived.ledger);
		}

		statements.push(
			db
				.delete(subscriptionEvents)
				.where(
					and(eq(subscriptionEvents.appId, appId), inArray(subscriptionEvents.shopDomain, chunk))
				)
		);
		for (const rows of chunkRows(ledger, 11)) {
			statements.push(db.insert(subscriptionEvents).values(rows).onConflictDoNothing());
		}

		await runBatch(db, statements);
		events += ledger.length;
	}

	return { shops: shops.length, events };
}

function sameDerived(stored: typeof appCharges.$inferSelect, d: DerivedCharge) {
	const t = (v: Date | null) => (v ? Math.floor(v.getTime() / 1000) : null);
	return (
		stored.billingInterval === d.billingInterval &&
		stored.monthlyAmountCents === d.monthlyAmountCents &&
		t(stored.paidAt) === t(d.paidAt) &&
		stored.trialStatus === d.trialStatus &&
		t(stored.trialEndsAt) === t(d.trialEndsAt) &&
		t(stored.churnedAt) === t(d.churnedAt) &&
		stored.churnReason === d.churnReason &&
		stored.replacesChargeId === d.replacesChargeId
	);
}

/** Shops that have a subscription to this app, for a full rebuild in slices. */
export async function subscriptionShops(db: DrizzleClient, appId: string) {
	const rows = await db
		.selectDistinct({ shopDomain: appCharges.shopDomain })
		.from(appCharges)
		.where(and(eq(appCharges.appId, appId), eq(appCharges.kind, 'recurring')))
		.orderBy(appCharges.shopDomain);
	return rows.map((r) => r.shopDomain);
}

/**
 * Trials whose end date has passed. Nothing in the event feed marks the moment
 * a trial converts — the sale arrives days later — so the daily sync moves
 * these on itself.
 */
export async function refreshDueTrials(db: DrizzleClient, now = new Date()) {
	const due = await db
		.selectDistinct({ appId: appCharges.appId, shopDomain: appCharges.shopDomain })
		.from(appCharges)
		.where(and(eq(appCharges.trialStatus, 'in_trial'), lte(appCharges.trialEndsAt, now)));

	const byApp = new Map<string, string[]>();
	for (const row of due) {
		const list = byApp.get(row.appId) ?? [];
		list.push(row.shopDomain);
		byApp.set(row.appId, list);
	}

	let shops = 0;
	for (const [appId, list] of byApp) {
		shops += (await rebuildSubscriptions(db, appId, list, now)).shops;
	}
	return shops;
}
