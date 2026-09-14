import type { DrizzleClient } from '$lib/server/db';
import type { MerchantProfile } from './merchant';
import { recordLifecycleHistory } from './merchant';
import { applyChargeEvents } from './charges';
import { normalizeShopDomain } from './referral';
import type { PartnerChargeEvent } from './partner-api';

/**
 * Imports the Partner dashboard's "App history" CSV export.
 *
 * The API caps how far back a sync can reach — the event feed thins out and the
 * backfill window is two years — but the CSV export carries an app's whole
 * life, so a ten-year-old app backfills from a file upload. It is also the only
 * source that includes the shop's email, which is what identifies a Shopify
 * reviewer store; the API reports reviewers under ordinary-looking domains.
 *
 * Charge ids in the CSV are the same ids the Partner API uses
 * ("Subscription ID: 27864039502" is gid://shopify/AppSubscription/27864039502),
 * and event timestamps match to the second, so an import and a sync running
 * over the same period dedupe against each other instead of double-counting.
 */

export type ParsedHistory = {
	/** One entry per shop, keyed by normalised domain, insertion-ordered. */
	shops: Map<
		string,
		{
			profile: MerchantProfile;
			events: {
				type: 'installed' | 'uninstalled' | 'deactivated';
				occurredAt: Date;
				reason: string | null;
			}[];
			charges: PartnerChargeEvent[];
		}
	>;
	totalRows: number;
	skippedRows: number;
};

/** RFC-ish CSV reader: quoted fields, embedded commas and doubled quotes. */
function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let inQuotes = false;

	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (inQuotes) {
			if (ch === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i++;
				} else inQuotes = false;
			} else field += ch;
		} else if (ch === '"') inQuotes = true;
		else if (ch === ',') {
			row.push(field);
			field = '';
		} else if (ch === '\n' || ch === '\r') {
			if (ch === '\r' && text[i + 1] === '\n') i++;
			row.push(field);
			field = '';
			if (row.length > 1 || row[0] !== '') rows.push(row);
			row = [];
		} else field += ch;
	}
	row.push(field);
	if (row.length > 1 || row[0] !== '') rows.push(row);
	return rows;
}

/** "2026-02-01 11:23:17 UTC" → Date. */
function parseStamp(value: string): Date | null {
	const iso = value.trim().replace(' UTC', 'Z').replace(' ', 'T');
	const parsed = new Date(iso);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const RELATIONSHIP_EVENTS: Record<string, 'installed' | 'uninstalled' | 'deactivated'> = {
	Installed: 'installed',
	// Same call as the API's RelationshipReactivated: a shop that is back is in
	// the installed state; reinstall vs reopen is not a distinction we keep.
	'Store re-opened': 'installed',
	Uninstalled: 'uninstalled',
	'Store closed': 'deactivated'
};

const CHARGE_ACTIONS: Record<string, PartnerChargeEvent['action']> = {
	accepted: 'accepted',
	activated: 'activated',
	canceled: 'cancelled',
	declined: 'declined',
	expired: 'expired',
	frozen: 'frozen',
	unfrozen: 'unfrozen'
};

/**
 * "Elite Plan - 25000 credits/month - $200.00 USD (Test). Subscription ID: 123"
 * → its parts. Returns null when there is no charge id to dedupe on.
 */
function parseChargeDetails(details: string) {
	const idMatch = details.match(/(Subscription ID|One-Time Charge ID):\s*(\d+)/);
	if (!idMatch) return null;

	const kind = idMatch[1] === 'Subscription ID' ? ('recurring' as const) : ('one_time' as const);
	const chargeId =
		kind === 'recurring'
			? `gid://shopify/AppSubscription/${idMatch[2]}`
			: `gid://shopify/AppPurchaseOneTime/${idMatch[2]}`;

	const amountMatch = details.match(/\$([0-9][0-9,]*(?:\.[0-9]+)?)\s+([A-Z]{3})/);
	const name = details.split(/ - \$/)[0].trim() || null;

	return {
		kind,
		chargeId,
		name,
		amount: amountMatch
			? { amount: amountMatch[1].replace(/,/g, ''), currencyCode: amountMatch[2] }
			: null,
		test: /\(Test\)/.test(details)
	};
}

export function parseAppHistoryCsv(text: string): ParsedHistory {
	const rows = parseCsv(text);
	if (!rows.length) return { shops: new Map(), totalRows: 0, skippedRows: 0 };

	const header = rows[0].map((h) => h.trim().toLowerCase());
	const col = (name: string) => header.indexOf(name);
	const iDate = col('date');
	const iEvent = col('event');
	const iDetails = col('details');
	const iBilling = col('billing on');
	const iName = col('shop name');
	const iCountry = col('shop country');
	const iEmail = col('shop email');
	const iDomain = col('shop domain');

	if (iDate < 0 || iEvent < 0 || iDomain < 0) {
		throw new Error(
			'That does not look like a Shopify app-history export — expected Date, Event and Shop domain columns.'
		);
	}

	const shops: ParsedHistory['shops'] = new Map();
	let skipped = 0;

	for (const row of rows.slice(1)) {
		const shopDomain = normalizeShopDomain(row[iDomain] ?? '');
		const occurredAt = parseStamp(row[iDate] ?? '');
		const event = (row[iEvent] ?? '').trim();
		if (!shopDomain || !occurredAt || !event) {
			skipped++;
			continue;
		}

		const entry = shops.get(shopDomain) ?? {
			profile: { shopDomain } as MerchantProfile,
			events: [],
			charges: []
		};

		// Later rows win, so the profile ends on the freshest contact details.
		if (iName >= 0 && row[iName]?.trim()) entry.profile.name = row[iName].trim();
		if (iEmail >= 0 && row[iEmail]?.trim()) entry.profile.email = row[iEmail].trim();
		if (iCountry >= 0 && row[iCountry]?.trim()) entry.profile.country = row[iCountry].trim();

		const relationship = RELATIONSHIP_EVENTS[event];
		if (relationship) {
			entry.events.push({
				type: relationship,
				occurredAt,
				reason:
					relationship === 'uninstalled' && iDetails >= 0 && row[iDetails]?.trim()
						? row[iDetails].trim()
						: null
			});
			shops.set(shopDomain, entry);
			continue;
		}

		const actionWord = event.match(/^(?:Subscription charge|Charge)\s+(\w+)/i);
		const action = actionWord && CHARGE_ACTIONS[actionWord[1].toLowerCase()];
		if (action) {
			const details = iDetails >= 0 ? (row[iDetails] ?? '') : '';
			const charge = parseChargeDetails(details);
			// A charge row without an id cannot be deduped, so it is skipped
			// rather than risked as a duplicate.
			if (!charge) {
				skipped++;
				continue;
			}
			entry.charges.push({
				kind: charge.kind,
				action,
				occurredAt: occurredAt.toISOString(),
				shopDomain,
				shopName: entry.profile.name ?? null,
				chargeId: charge.chargeId,
				name: charge.name,
				amount: charge.amount,
				billingOn: iBilling >= 0 && row[iBilling]?.trim() ? row[iBilling].trim() : null,
				test: charge.test
			});
			shops.set(shopDomain, entry);
			continue;
		}

		// Credits, usage charges, capped-amount notices — nothing we track yet.
		skipped++;
	}

	return { shops, totalRows: rows.length - 1, skippedRows: skipped };
}

export type ImportChunkResult = {
	processedShops: number;
	remainingShops: number;
	eventsInserted: number;
	chargesWritten: number;
	internalSkipped: number;
};

/**
 * Applies one slice of a parsed history.
 *
 * Chunked for the same reason the Partner backfill is: every shop costs a
 * handful of D1 calls, each one a Workers subrequest against a hard
 * per-request cap. The caller resubmits with the next offset until nothing
 * remains — shops are keyed in file order, so (file, offset) is stable across
 * requests.
 */
export async function applyHistoryChunk(
	db: DrizzleClient,
	options: { appId: string; parsed: ParsedHistory; offset: number; limit?: number }
): Promise<ImportChunkResult> {
	const limit = options.limit ?? 50;
	const domains = [...options.parsed.shops.keys()];
	const chunk = domains.slice(options.offset, options.offset + limit);

	let eventsInserted = 0;
	let chargesWritten = 0;
	let internalSkipped = 0;
	const merchantByShop = new Map<string, string>();

	for (const shopDomain of chunk) {
		const entry = options.parsed.shops.get(shopDomain)!;
		if (!entry.events.length) continue;

		// No preloaded internal list on purpose: the CSV carries the email, and
		// the per-shop path is what recognises a reviewer's @shopify.com address
		// and remembers the domain for every future sync.
		const result = await recordLifecycleHistory(db, {
			appId: options.appId,
			profile: entry.profile,
			events: entry.events,
			source: 'manual'
		});

		if (!result) {
			internalSkipped++;
			continue;
		}
		merchantByShop.set(shopDomain, result.merchantId);
		eventsInserted += result.inserted;
	}

	// Only shops that actually recorded: a reviewer store recognised a moment
	// ago must not sneak its charges in through the second pass.
	const chargeEvents = chunk
		.filter((domain) => merchantByShop.has(domain))
		.flatMap((domain) => options.parsed.shops.get(domain)?.charges ?? []);
	if (chargeEvents.length) {
		const charges = await applyChargeEvents(db, {
			appId: options.appId,
			events: chargeEvents,
			merchantIdFor: (shop) => merchantByShop.get(shop)
		});
		chargesWritten = charges.written;
	}

	return {
		processedShops: chunk.length,
		remainingShops: Math.max(0, domains.length - options.offset - chunk.length),
		eventsInserted,
		chargesWritten,
		internalSkipped
	};
}
