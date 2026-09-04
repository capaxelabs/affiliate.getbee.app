import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import type { DrizzleClient } from '$lib/server/db';
import {
	apps,
	partnerAccounts,
	partnerSyncRuns,
	referrals,
	transactions
} from '$lib/server/db/schema';
import { decryptSecret } from '$lib/server/crypto';
import { recordCommission, releaseMaturedCommissions } from './commission';
import { normalizeShopDomain } from './referral';
import { recordInstall, recordUninstall, upsertMerchant } from './merchant';
import { findListing } from './listing';
import { findAdoptableApp, uniqueSlug } from './app-registry';
import {
	chargeTypeFor,
	discoverApps,
	fetchRelationshipEvents,
	fetchTransactions,
	toCents,
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

/** Every account we should sync, or just one when an id is given. */
export async function syncableAccounts(db: DrizzleClient, partnerAccountId?: string) {
	const filters = [eq(partnerAccounts.status, 'active'), isNotNull(partnerAccounts.apiTokenEncrypted)];
	if (partnerAccountId) filters.push(eq(partnerAccounts.id, partnerAccountId));
	return db.select().from(partnerAccounts).where(and(...filters)).orderBy(partnerAccounts.name);
}

async function credentialsFor(env: Env, account: Account): Promise<PartnerCredentials> {
	if (!account.apiTokenEncrypted) {
		throw new Error(`No Partner Access Token stored for ${account.name}.`);
	}
	return {
		organizationId: account.organizationId,
		apiToken: await decryptSecret(env, account.apiTokenEncrypted),
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
		const credentials = await credentialsFor(env, account);
		const discovered = await discoverApps(credentials);
		seen = discovered.length;

		{
			for (const partnerApp of discovered) {
				let [existing] = await db
					.select()
					.from(apps)
					.where(eq(apps.partnerAppId, partnerApp.id))
					.limit(1);

				// An app registered by its own install webhook has no Partner app id
				// yet. Adopt it by name rather than creating a second record.
				if (!existing) {
					const adoptable = await findAdoptableApp(db, partnerApp.name);
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

				const slug = await uniqueSlug(db, partnerApp.name);
				// Icon and listing URL only exist on the public App Store page.
				const listing = await findListing(slug, partnerApp.name);

				await db.insert(apps).values({
					name: partnerApp.name,
					slug,
					partnerAppId: partnerApp.id,
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
		const credentials = await credentialsFor(env, account);

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
		const credentials = await credentialsFor(env, account);
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
			collected.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

			for (const event of collected) {
				const shopDomain = event.shopDomain && normalizeShopDomain(event.shopDomain);
				if (!shopDomain) continue;

				const occurredAt = new Date(event.occurredAt);

				if (event.kind === 'uninstalled') {
					const result = await recordUninstall(db, {
						appId: app.id,
						shopDomain,
						shopName: event.shopName,
						uninstalledAt: occurredAt,
						reason: event.reason,
						source: 'partner_api',
						createIfMissing: true
					});
					if (result) matched++;
					continue;
				}

				await recordInstall(db, {
					appId: app.id,
					profile: { shopDomain, name: event.shopName },
					installedAt: occurredAt,
					source: 'partner_api'
				});
				matched++;

				await db
					.update(referrals)
					.set({
						status: 'active',
						installedAt: sql`coalesce(${referrals.installedAt}, ${Math.floor(occurredAt.getTime() / 1000)})`,
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
