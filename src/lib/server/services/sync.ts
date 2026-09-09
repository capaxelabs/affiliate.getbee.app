import { and, desc, eq, isNotNull, lt, sql } from 'drizzle-orm';
import type { DrizzleClient } from '$lib/server/db';
import {
	apps,
	partnerAccounts,
	partnerSyncRuns,
	referrals,
	transactions
} from '$lib/server/db/schema';
import { recordCommission, releaseMaturedCommissions } from './commission';
import { normalizeShopDomain } from './referral';
import { recordInstall, recordLifecycleHistory, upsertMerchant } from './merchant';
import { findListing } from './listing';
import { findAdoptableApp, uniqueSlug } from './app-registry';
import {
	chargeTypeFor,
	discoverApps,
	fetchApp,
	fetchRelationshipEvents,
	fetchTransactions,
	toCents,
	type PartnerApp,
	type PartnerCredentials,
	type PartnerRelationshipEvent,
	type PartnerTransaction
} from './partner-api';

type Env = App.Platform['env'];
type Account = typeof partnerAccounts.$inferSelect;

export type SyncSummary = {
	runId: string;
	partnerAccountId: string;
	partnerAccountName: string;
	status: 'success' | 'failed';
	recordsSeen: number;
	recordsMatched: number;
	commissionsCreated: number;
	error?: string;
};

/**
 * Marks runs abandoned by a killed request as failed. A Worker can be cut off
 * mid-sync, which used to leave a row stuck on 'running' and the admin spinning.
 */
export async function failStaleRuns(db: DrizzleClient, olderThanMinutes = 15) {
	const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);

	const stale = await db
		.update(partnerSyncRuns)
		.set({
			status: 'failed',
			error: 'Abandoned — the request was cut off before it finished.',
			finishedAt: new Date()
		})
		.where(and(eq(partnerSyncRuns.status, 'running'), lt(partnerSyncRuns.startedAt, cutoff)))
		.returning({ id: partnerSyncRuns.id });

	return stale.length;
}

/** Every account we should sync, or just one when an id is given. */
export async function syncableAccounts(db: DrizzleClient, partnerAccountId?: string) {
	const filters = [eq(partnerAccounts.status, 'active'), isNotNull(partnerAccounts.apiToken)];
	if (partnerAccountId) filters.push(eq(partnerAccounts.id, partnerAccountId));
	return db.select().from(partnerAccounts).where(and(...filters)).orderBy(partnerAccounts.name);
}

function credentialsFor(account: Account): PartnerCredentials {
	if (!account.apiToken) {
		throw new Error(`No Partner Access Token stored for ${account.name}.`);
	}
	return {
		organizationId: account.organizationId,
		apiToken: account.apiToken,
		apiVersion: account.apiVersion
	};
}

export type AppSyncSummary = {
	partnerAccountId: string;
	partnerAccountName: string;
	status: 'success' | 'failed';
	seen: number;
	created: number;
	updated: number;
	error?: string;
};

/**
 * Records every app the Partner organization has billed for. Apps arrive with
 * affiliate participation off — revenue and merchant analytics start flowing
 * immediately, but an admin opts an app into the affiliate program by hand.
 *
 * Only apps with at least one transaction can be found; see discoverApps.
 *
 * Never overwrites the fields an admin owns (slug, listing URL, commission,
 * affiliate opt-in); only the name is refreshed from Shopify.
 */
export async function syncApps(
	db: DrizzleClient,
	env: Env,
	account: Account
): Promise<AppSyncSummary> {
	const base = { partnerAccountId: account.id, partnerAccountName: account.name };
	let seen = 0;
	let created = 0;
	let updated = 0;

	try {
		const credentials = credentialsFor(account);
		const discovered = await discoverApps(credentials);
		seen = discovered.length;

		{
			for (const partnerApp of discovered) {
				let [existing] = await db
					.select()
					.from(apps)
					.where(eq(apps.partnerAppId, partnerApp.id))
					.limit(1);

				// The Partner app detail carries the OAuth client id, which is what a
				// webhook-registered record can be matched on. Fetched lazily and at
				// most once: adoption needs it, and so does the backfill below.
				let appDetail: PartnerApp | null | undefined;
				const loadDetail = async (): Promise<PartnerApp | null> => {
					if (appDetail === undefined) {
						appDetail = await fetchApp(credentials, partnerApp.id).catch(() => null);
					}
					return appDetail;
				};

				// An app registered by its own install webhook has no Partner app id
				// yet. Adopt it rather than creating a second record.
				if (!existing) {
					const adoptable = await findAdoptableApp(
						db,
						partnerApp.name,
						(await loadDetail())?.apiKey
					);
					if (adoptable) {
						const [adopted] = await db
							.update(apps)
							.set({
								partnerAppId: partnerApp.id,
								partnerAccountId: account.id,
								updatedAt: new Date()
							})
							.where(eq(apps.id, adoptable.id))
							.returning();
						existing = adopted;
						updated++;
					}
				}

				if (existing) {
					// The OAuth client id is what a webhook resolves by, so make sure
					// we hold it even for apps discovered before this existed.
					if (!existing.apiKey) {
						const loaded = await loadDetail();
						if (loaded?.apiKey) {
							const [clash] = await db
								.select({ id: apps.id })
								.from(apps)
								.where(eq(apps.apiKey, loaded.apiKey))
								.limit(1);
							if (!clash) {
								await db
									.update(apps)
									.set({ apiKey: loaded.apiKey, updatedAt: new Date() })
									.where(eq(apps.id, existing.id));
								updated++;
							}
						}
					}

					if (!existing.listingUrl || !existing.iconUrl) {
						const listing = await findListing(existing.slug, partnerApp.name);
						if (listing) {
							await db
								.update(apps)
								.set({
									listingUrl: existing.listingUrl ?? listing.url,
									iconUrl: existing.iconUrl ?? listing.iconUrl,
									updatedAt: new Date()
								})
								.where(eq(apps.id, existing.id));
							updated++;
						}
					}

					if (existing.name !== partnerApp.name || existing.partnerAccountId !== account.id) {
						await db
							.update(apps)
							.set({
								name: partnerApp.name,
								partnerAccountId: account.id,
								updatedAt: new Date()
							})
							.where(eq(apps.id, existing.id));
						updated++;
					}
					continue;
				}

				const detail = await loadDetail();
				const slug = await uniqueSlug(db, partnerApp.name);
				// Icon and listing URL only exist on the public App Store page.
				const listing = await findListing(slug, partnerApp.name);

				await db.insert(apps).values({
					name: partnerApp.name,
					slug,
					partnerAppId: partnerApp.id,
					apiKey: detail?.apiKey ?? null,
					partnerAccountId: account.id,
					listingUrl: listing?.url ?? null,
					iconUrl: listing?.iconUrl ?? null,
					affiliateEnabled: false,
					source: 'partner_api'
				});
				created++;
			}
		}

		await db
			.update(partnerAccounts)
			.set({ lastSyncError: null, updatedAt: new Date() })
			.where(eq(partnerAccounts.id, account.id));

		return { ...base, status: 'success', seen, created, updated };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await db
			.update(partnerAccounts)
			.set({ lastSyncError: message, updatedAt: new Date() })
			.where(eq(partnerAccounts.id, account.id));

		return { ...base, status: 'failed', seen, created, updated, error: message };
	}
}

/** Where to resume from for this account: its last successful run, else 30 days back. */
async function windowStart(
	db: DrizzleClient,
	accountId: string,
	kind: 'transactions' | 'installs',
	/** How far back the very first run reaches. */
	firstRunDays = 30
) {
	const [last] = await db
		.select({ startedAt: partnerSyncRuns.startedAt })
		.from(partnerSyncRuns)
		.where(
			and(
				eq(partnerSyncRuns.partnerAccountId, accountId),
				eq(partnerSyncRuns.kind, kind),
				eq(partnerSyncRuns.status, 'success')
			)
		)
		.orderBy(desc(partnerSyncRuns.startedAt))
		.limit(1);

	if (!last) return new Date(Date.now() - firstRunDays * 24 * 60 * 60 * 1000);

	// Overlap by a day so nothing slips between runs.
	return new Date(last.startedAt.getTime() - 24 * 60 * 60 * 1000);
}

async function finishRun(
	db: DrizzleClient,
	runId: string,
	accountId: string,
	patch: Record<string, unknown>,
	error?: string
) {
	await db
		.update(partnerSyncRuns)
		.set({ ...patch, error: error ?? null, finishedAt: new Date() })
		.where(eq(partnerSyncRuns.id, runId));

	await db
		.update(partnerAccounts)
		.set({ lastSyncedAt: new Date(), lastSyncError: error ?? null, updatedAt: new Date() })
		.where(eq(partnerAccounts.id, accountId));
}

/**
 * Pulls Partner billing transactions for one account. Every one is stored as app
 * revenue and its shop recorded as a merchant. Commissions are then written only
 * for shops already attributed to an affiliate — a shop with no attribution
 * still counts toward revenue, it just earns nobody a commission.
 */
export async function syncTransactions(
	db: DrizzleClient,
	env: Env,
	account: Account,
	trigger: 'cron' | 'manual' = 'cron'
): Promise<SyncSummary> {
	const [run] = await db
		.insert(partnerSyncRuns)
		.values({
			partnerAccountId: account.id,
			kind: 'transactions',
			trigger,
			status: 'running'
		})
		.returning();

	const base = {
		runId: run.id,
		partnerAccountId: account.id,
		partnerAccountName: account.name
	};

	let seen = 0;
	let matched = 0;
	let created = 0;
	let cursor: string | null = null;

	try {
		const credentials = credentialsFor(account);

		// Only apps belonging to this account can match its transactions.
		const appsByPartnerId = new Map<string, typeof apps.$inferSelect>();
		for (const app of await db
			.select()
			.from(apps)
			.where(eq(apps.partnerAccountId, account.id))) {
			if (app.partnerAppId) appsByPartnerId.set(app.partnerAppId, app);
		}

		const createdAtMin = (await windowStart(db, account.id, 'transactions')).toISOString();
		let hasNextPage = true;

		while (hasNextPage) {
			const page = await fetchTransactions(credentials, { after: cursor, createdAtMin });
			hasNextPage = page.hasNextPage;
			cursor = page.cursor;
			seen += page.transactions.length;

			for (const txn of page.transactions) {
				const result = await applyTransaction(db, txn, appsByPartnerId);
				if (result.matched) matched++;
				if (result.commission) created++;
			}

			if (!page.cursor) break;
		}

		await finishRun(db, run.id, account.id, {
			status: 'success',
			cursor,
			recordsSeen: seen,
			recordsMatched: matched,
			commissionsCreated: created
		});

		return {
			...base,
			status: 'success',
			recordsSeen: seen,
			recordsMatched: matched,
			commissionsCreated: created
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await finishRun(
			db,
			run.id,
			account.id,
			{
				status: 'failed',
				cursor,
				recordsSeen: seen,
				recordsMatched: matched,
				commissionsCreated: created
			},
			message
		);

		return {
			...base,
			status: 'failed',
			recordsSeen: seen,
			recordsMatched: matched,
			commissionsCreated: created,
			error: message
		};
	}
}

type TransactionOutcome = {
	/** The transaction belongs to an app we track. */
	matched: boolean;
	/** A new commission line was written for an attributed shop. */
	commission: boolean;
};

async function applyTransaction(
	db: DrizzleClient,
	txn: PartnerTransaction,
	appsByPartnerId: Map<string, typeof apps.$inferSelect>
): Promise<TransactionOutcome> {
	const skipped: TransactionOutcome = { matched: false, commission: false };
	if (!txn.appId) return skipped;

	const app = appsByPartnerId.get(txn.appId);
	if (!app) return skipped;

	const shopDomain = txn.shopDomain ? normalizeShopDomain(txn.shopDomain) : null;
	const occurredAt = new Date(txn.createdAt);
	const chargeType = chargeTypeFor(txn.type);
	const currency = txn.netAmount?.currencyCode ?? 'USD';
	const grossAmountCents = toCents(txn.grossAmount?.amount);
	const netAmountCents = toCents(txn.netAmount?.amount);

	// Every shop that pays us becomes a merchant, referred or not.
	let merchantId: string | null = null;
	if (shopDomain) {
		const merchant = await upsertMerchant(db, { shopDomain, name: txn.shopName ?? null }, occurredAt);
		merchantId = merchant?.id ?? null;
	}

	// Store the raw revenue row first — this is what the dashboards read.
	const stored = await db
		.insert(transactions)
		.values({
			partnerTransactionId: txn.id,
			appId: app.id,
			merchantId,
			shopDomain,
			chargeType,
			currency,
			grossAmountCents,
			netAmountCents,
			occurredAt
		})
		.onConflictDoNothing({ target: transactions.partnerTransactionId })
		.returning();

	const transaction = stored.at(0) ?? null;
	if (!shopDomain) return { matched: true, commission: false };

	const [referral] = await db
		.select()
		.from(referrals)
		.where(and(eq(referrals.appId, app.id), eq(referrals.shopDomain, shopDomain)))
		.limit(1);

	// Revenue is recorded either way; only an attributed shop earns a commission.
	if (!referral || referral.status === 'rejected') return { matched: true, commission: false };

	if (referral.commissionEndsAt && occurredAt > referral.commissionEndsAt) {
		return { matched: true, commission: false };
	}

	const commission = await recordCommission(db, {
		referralId: referral.id,
		affiliateId: referral.affiliateId,
		appId: app.id,
		partnerTransactionId: txn.id,
		transactionId: transaction?.id ?? null,
		chargeType,
		currency,
		grossAmountCents,
		netAmountCents,
		commissionBps: referral.commissionBps,
		occurredAt
	});

	return { matched: true, commission: Boolean(commission) };
}

/**
 * Pulls install, uninstall and reactivation events for one account's apps.
 *
 * Records every merchant, keeps install state current, and captures Shopify's
 * own churn reason on uninstall. Referrals that were waiting on an install get
 * marked active; attribution is never invented here.
 */
export async function syncInstalls(
	db: DrizzleClient,
	env: Env,
	account: Account,
	trigger: 'cron' | 'manual' = 'cron'
): Promise<SyncSummary> {
	const [run] = await db
		.insert(partnerSyncRuns)
		.values({ partnerAccountId: account.id, kind: 'installs', trigger, status: 'running' })
		.returning();

	const base = {
		runId: run.id,
		partnerAccountId: account.id,
		partnerAccountName: account.name
	};

	let seen = 0;
	let matched = 0;

	try {
		const credentials = credentialsFor(account);
		// Two years on the first run so churn history is not a blank slate.
		const occurredAtMin = (await windowStart(db, account.id, 'installs', 730)).toISOString();

		const tracked = (
			await db.select().from(apps).where(eq(apps.partnerAccountId, account.id))
		).filter((a) => a.partnerAppId);

		for (const app of tracked) {
			// Collect the whole window before applying it: a shop that installed,
			// churned and came back must be replayed in order or it ends up in the
			// wrong state.
			const collected: PartnerRelationshipEvent[] = [];
			let cursor: string | null = null;
			let hasNextPage = true;

			while (hasNextPage) {
				const page = await fetchRelationshipEvents(credentials, app.partnerAppId!, {
					after: cursor,
					occurredAtMin
				});
				hasNextPage = page.hasNextPage;
				cursor = page.cursor;
				collected.push(...page.events);
				if (!page.cursor) break;
			}

			seen += collected.length;

			// One lookup up front beats a conditional update per shop.
			const pendingReferralShops = new Set(
				(
					await db
						.select({ shopDomain: referrals.shopDomain })
						.from(referrals)
						.where(and(eq(referrals.appId, app.id), eq(referrals.status, 'pending')))
				).map((r) => r.shopDomain)
			);

			// Group by shop before touching the database. Per-event writes cost
			// about eight D1 calls each, and on Workers every one is a subrequest
			// against a hard per-request cap — a couple of hundred events was
			// enough to have the request killed mid-run.
			const byShop = new Map<
				string,
				{ shopName: string | null; events: { type: 'installed' | 'uninstalled'; occurredAt: Date; reason: string | null }[] }
			>();

			for (const event of collected) {
				const shopDomain = event.shopDomain && normalizeShopDomain(event.shopDomain);
				if (!shopDomain) continue;

				const type = event.kind === 'uninstalled' ? 'uninstalled' : 'installed';
				const entry = byShop.get(shopDomain) ?? { shopName: null, events: [] };
				entry.shopName ??= event.shopName;
				entry.events.push({ type, occurredAt: new Date(event.occurredAt), reason: event.reason });
				byShop.set(shopDomain, entry);
			}

			for (const [shopDomain, entry] of byShop) {
				const result = await recordLifecycleHistory(db, {
					appId: app.id,
					profile: { shopDomain, name: entry.shopName },
					events: entry.events,
					source: 'partner_api'
				});
				if (!result) continue;
				matched += entry.events.length;

				// Only shops with a pending referral need the extra write.
				const firstInstall = entry.events.find((e) => e.type === 'installed');
				if (firstInstall && pendingReferralShops.has(shopDomain)) {
					await db
						.update(referrals)
						.set({
							status: 'active',
							installedAt: sql`coalesce(${referrals.installedAt}, ${Math.floor(firstInstall.occurredAt.getTime() / 1000)})`,
							updatedAt: new Date()
						})
						.where(
							and(
								eq(referrals.appId, app.id),
								eq(referrals.shopDomain, shopDomain),
								eq(referrals.status, 'pending')
							)
						);
				}
			}
		}

		await finishRun(db, run.id, account.id, {
			status: 'success',
			recordsSeen: seen,
			recordsMatched: matched
		});

		return {
			...base,
			status: 'success',
			recordsSeen: seen,
			recordsMatched: matched,
			commissionsCreated: 0
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await finishRun(
			db,
			run.id,
			account.id,
			{ status: 'failed', recordsSeen: seen, recordsMatched: matched },
			message
		);

		return {
			...base,
			status: 'failed',
			recordsSeen: seen,
			recordsMatched: matched,
			commissionsCreated: 0,
			error: message
		};
	}
}

export type FullSyncResult = {
	accounts: number;
	apps: AppSyncSummary[];
	installs: SyncSummary[];
	transactions: SyncSummary[];
	released: number;
};

/** Runs both syncs for every connected account, then clears matured commissions. */
export async function runFullSync(
	db: DrizzleClient,
	env: Env,
	trigger: 'cron' | 'manual' = 'cron',
	partnerAccountId?: string
): Promise<FullSyncResult> {
	await failStaleRuns(db);
	const accounts = await syncableAccounts(db, partnerAccountId);

	const appRuns: AppSyncSummary[] = [];
	const installs: SyncSummary[] = [];
	const transactionRuns: SyncSummary[] = [];

	for (const account of accounts) {
		// Discover first, so an app added in Shopify today starts collecting
		// revenue on this same run.
		appRuns.push(await syncApps(db, env, account));
		installs.push(await syncInstalls(db, env, account, trigger));
		transactionRuns.push(await syncTransactions(db, env, account, trigger));
	}

	// One pass at the end rather than once per account.
	const released = accounts.length ? await releaseMaturedCommissions(db) : 0;

	return {
		accounts: accounts.length,
		apps: appRuns,
		installs,
		transactions: transactionRuns,
		released
	};
}
