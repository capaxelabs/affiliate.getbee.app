import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';
import { newId } from './id';

const now = sql`(unixepoch())`;

const timestamps = {
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
	updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(now)
};

/* ---------------------------------------------------------------- accounts */

export const users = sqliteTable(
	'users',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => newId('usr')),
		email: text('email').notNull(),
		name: text('name'),
		role: text('role', { enum: ['affiliate', 'staff', 'admin'] })
			.notNull()
			.default('affiliate'),
		/**
		 * Staff only. Off means they see the partner/app analytics side and none
		 * of the affiliate program. Ignored for the other roles.
		 */
		viewAffiliateData: integer('view_affiliate_data', { mode: 'boolean' })
			.notNull()
			.default(false),
		lastLoginAt: integer('last_login_at', { mode: 'timestamp' }),
		...timestamps
	},
	(t) => [uniqueIndex('users_email_idx').on(t.email)]
);

export const sessions = sqliteTable(
	'sessions',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
		createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now)
	},
	(t) => [index('sessions_user_idx').on(t.userId)]
);

/** Single sign-in path: a one-time code emailed to the address. */
export const loginCodes = sqliteTable(
	'login_codes',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => newId('lc')),
		email: text('email').notNull(),
		codeHash: text('code_hash').notNull(),
		expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
		attempts: integer('attempts').notNull().default(0),
		usedAt: integer('used_at', { mode: 'timestamp' }),
		createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now)
	},
	(t) => [index('login_codes_email_idx').on(t.email)]
);

/* -------------------------------------------------------- partner accounts */

/**
 * A Shopify Partner organization. Several can be connected at once; each app
 * belongs to exactly one. The Partner Access Token is encrypted at rest and never leaves
 * the server.
 */
export const partnerAccounts = sqliteTable(
	'partner_accounts',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => newId('pac')),
		name: text('name').notNull(),
		organizationId: text('organization_id').notNull(),
		/** AES-GCM ciphertext, never rendered to a browser. */
		apiTokenEncrypted: text('api_token_encrypted'),
		/** Last 4 characters, so the UI can show which token is stored. */
		apiTokenHint: text('api_token_hint'),
		apiVersion: text('api_version').notNull().default('2026-07'),
		status: text('status', { enum: ['active', 'paused'] })
			.notNull()
			.default('active'),
		lastSyncedAt: integer('last_synced_at', { mode: 'timestamp' }),
		lastSyncError: text('last_sync_error'),
		...timestamps
	},
	(t) => [uniqueIndex('partner_accounts_org_idx').on(t.organizationId)]
);

/* -------------------------------------------------------------------- apps */

/** A Shopify app in the program. Admins manage several. */
export const apps = sqliteTable(
	'apps',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => newId('app')),
		slug: text('slug').notNull(),
		name: text('name').notNull(),
		iconUrl: text('icon_url'),
		/**
		 * Needed only to build affiliate links, so it stays empty for apps
		 * discovered from the Partner API until someone opts them in.
		 */
		listingUrl: text('listing_url'),
		/**
		 * Whether this app is offered to affiliates. Discovery brings in every app
		 * for revenue and merchant analytics; only opted-in apps get links,
		 * referrals and commissions.
		 */
		affiliateEnabled: integer('affiliate_enabled', { mode: 'boolean' })
			.notNull()
			.default(false),
		/** Where the record came from. */
		source: text('source', { enum: ['partner_api', 'webhook', 'manual'] })
			.notNull()
			.default('manual'),
		/** Which Partner organization this app lives under. */
		partnerAccountId: text('partner_account_id').references(() => partnerAccounts.id, {
			onDelete: 'set null'
		}),
		/** Shopify Partner API app id, used to match transactions. */
		partnerAppId: text('partner_app_id'),
		/** Default commission in basis points. 2000 = 20%. */
		commissionBps: integer('commission_bps').notNull().default(2000),
		/** null = lifetime, otherwise commissions stop after N months. */
		commissionMonths: integer('commission_months'),
		/** Attribution window for a click, in days. */
		cookieDays: integer('cookie_days').notNull().default(90),
		status: text('status', { enum: ['active', 'paused'] })
			.notNull()
			.default('active'),
		/** Where merchants should reply. Also the from-name on lifecycle email. */
		supportEmail: text('support_email'),
		/** Merchant lifecycle email, off until someone turns it on per app. */
		welcomeEmailEnabled: integer('welcome_email_enabled', { mode: 'boolean' })
			.notNull()
			.default(false),
		offboardEmailEnabled: integer('offboard_email_enabled', { mode: 'boolean' })
			.notNull()
			.default(false),
		...timestamps
	},
	(t) => [
		uniqueIndex('apps_slug_idx').on(t.slug),
		index('apps_partner_idx').on(t.partnerAppId),
		index('apps_partner_account_idx').on(t.partnerAccountId)
	]
);

/* --------------------------------------------------------------- merchants */

/** Every shop we have ever seen, referred or not. One row per shop domain. */
export const merchants = sqliteTable(
	'merchants',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => newId('mer')),
		shopDomain: text('shop_domain').notNull(),
		name: text('name'),
		email: text('email'),
		ownerName: text('owner_name'),
		phone: text('phone'),
		/** The storefront domain when it differs from the myshopify one. */
		primaryDomain: text('primary_domain'),
		country: text('country'),
		currency: text('currency'),
		timezone: text('timezone'),
		shopifyPlan: text('shopify_plan'),
		firstSeenAt: integer('first_seen_at', { mode: 'timestamp' }).notNull().default(now),
		lastSeenAt: integer('last_seen_at', { mode: 'timestamp' }).notNull().default(now),
		...timestamps
	},
	(t) => [
		uniqueIndex('merchants_shop_domain_idx').on(t.shopDomain),
		index('merchants_email_idx').on(t.email)
	]
);

/** One row per merchant per app. Survives uninstall so churn stays visible. */
export const installs = sqliteTable(
	'installs',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => newId('ins')),
		appId: text('app_id')
			.notNull()
			.references(() => apps.id, { onDelete: 'cascade' }),
		merchantId: text('merchant_id')
			.notNull()
			.references(() => merchants.id, { onDelete: 'cascade' }),
		status: text('status', { enum: ['installed', 'uninstalled'] })
			.notNull()
			.default('installed'),
		installedAt: integer('installed_at', { mode: 'timestamp' }).notNull().default(now),
		uninstalledAt: integer('uninstalled_at', { mode: 'timestamp' }),
		/** Counts reinstalls so a churned-then-returned shop is obvious. */
		installCount: integer('install_count').notNull().default(1),
		uninstallReason: text('uninstall_reason'),
		uninstallFeedback: text('uninstall_feedback'),
		plan: text('plan'),
		/** Set when this install is credited to an affiliate. */
		referralId: text('referral_id'),
		...timestamps
	},
	(t) => [
		uniqueIndex('installs_app_merchant_idx').on(t.appId, t.merchantId),
		index('installs_status_idx').on(t.status),
		index('installs_installed_idx').on(t.installedAt)
	]
);

/** Append-only lifecycle trail for an install. */
export const installEvents = sqliteTable(
	'install_events',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => newId('ive')),
		installId: text('install_id')
			.notNull()
			.references(() => installs.id, { onDelete: 'cascade' }),
		appId: text('app_id')
			.notNull()
			.references(() => apps.id, { onDelete: 'cascade' }),
		merchantId: text('merchant_id')
			.notNull()
			.references(() => merchants.id, { onDelete: 'cascade' }),
		type: text('type', {
			enum: ['installed', 'reinstalled', 'uninstalled', 'plan_changed', 'feedback']
		}).notNull(),
		source: text('source', { enum: ['ingest', 'partner_api', 'manual'] })
			.notNull()
			.default('ingest'),
		metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
		occurredAt: integer('occurred_at', { mode: 'timestamp' }).notNull().default(now),
		createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now)
	},
	(t) => [
		index('install_events_install_idx').on(t.installId),
		index('install_events_occurred_idx').on(t.occurredAt)
	]
);

/* ------------------------------------------------------------- app revenue */

/**
 * Every Shopify Partner billing transaction, referred or not. This is the
 * source of truth for app revenue; affiliate commissions derive from it.
 */
export const transactions = sqliteTable(
	'transactions',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => newId('txn')),
		partnerTransactionId: text('partner_transaction_id').notNull(),
		appId: text('app_id')
			.notNull()
			.references(() => apps.id, { onDelete: 'cascade' }),
		merchantId: text('merchant_id').references(() => merchants.id, { onDelete: 'set null' }),
		shopDomain: text('shop_domain'),
		chargeType: text('charge_type', {
			enum: ['recurring', 'one_time', 'usage', 'adjustment', 'refund']
		}).notNull(),
		currency: text('currency').notNull().default('USD'),
		/** What the merchant paid. */
		grossAmountCents: integer('gross_amount_cents').notNull().default(0),
		/** What we received after Shopify's cut. */
		netAmountCents: integer('net_amount_cents').notNull().default(0),
		occurredAt: integer('occurred_at', { mode: 'timestamp' }).notNull(),
		createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now)
	},
	(t) => [
		uniqueIndex('transactions_partner_idx').on(t.partnerTransactionId),
		index('transactions_app_idx').on(t.appId),
		index('transactions_merchant_idx').on(t.merchantId),
		index('transactions_occurred_idx').on(t.occurredAt)
	]
);

/* -------------------------------------------------------- lifecycle email */

/**
 * Outbox for merchant lifecycle mail. A row per (install, kind) keeps sending
 * idempotent even if an install webhook is delivered twice.
 */
export const lifecycleEmails = sqliteTable(
	'lifecycle_emails',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => newId('lce')),
		installId: text('install_id')
			.notNull()
			.references(() => installs.id, { onDelete: 'cascade' }),
		appId: text('app_id')
			.notNull()
			.references(() => apps.id, { onDelete: 'cascade' }),
		merchantId: text('merchant_id')
			.notNull()
			.references(() => merchants.id, { onDelete: 'cascade' }),
		kind: text('kind', { enum: ['welcome', 'offboard'] }).notNull(),
		toEmail: text('to_email').notNull(),
		status: text('status', { enum: ['pending', 'sent', 'failed', 'skipped'] })
			.notNull()
			.default('pending'),
		/** Held until this time so welcome mail doesn't land mid-install. */
		sendAfter: integer('send_after', { mode: 'timestamp' }).notNull().default(now),
		attempts: integer('attempts').notNull().default(0),
		sentAt: integer('sent_at', { mode: 'timestamp' }),
		error: text('error'),
		...timestamps
	},
	(t) => [
		uniqueIndex('lifecycle_emails_install_kind_idx').on(t.installId, t.kind),
		index('lifecycle_emails_status_idx').on(t.status, t.sendAfter)
	]
);

/* -------------------------------------------------------------- affiliates */

export const affiliates = sqliteTable(
	'affiliates',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => newId('aff')),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		/** Short public code that appears in every affiliate link. */
		refCode: text('ref_code').notNull(),
		company: text('company'),
		website: text('website'),
		promotionMethod: text('promotion_method'),
		status: text('status', { enum: ['pending', 'approved', 'rejected', 'suspended'] })
			.notNull()
			.default('pending'),
		/** Overrides every app's default rate when set. */
		commissionBpsOverride: integer('commission_bps_override'),
		payoutMethod: text('payout_method', { enum: ['paypal', 'wise', 'bank'] }),
		payoutEmail: text('payout_email'),
		payoutDetails: text('payout_details', { mode: 'json' }).$type<Record<string, string>>(),
		minPayoutCents: integer('min_payout_cents').notNull().default(5000),
		taxCountry: text('tax_country'),
		taxId: text('tax_id'),
		reviewedAt: integer('reviewed_at', { mode: 'timestamp' }),
		reviewedBy: text('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
		reviewNote: text('review_note'),
		...timestamps
	},
	(t) => [
		uniqueIndex('affiliates_user_idx').on(t.userId),
		uniqueIndex('affiliates_ref_code_idx').on(t.refCode),
		index('affiliates_status_idx').on(t.status)
	]
);

/** Per-app rate override or opt-out. Absent row = app default, enrolled. */
export const affiliateApps = sqliteTable(
	'affiliate_apps',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => newId('afa')),
		affiliateId: text('affiliate_id')
			.notNull()
			.references(() => affiliates.id, { onDelete: 'cascade' }),
		appId: text('app_id')
			.notNull()
			.references(() => apps.id, { onDelete: 'cascade' }),
		commissionBpsOverride: integer('commission_bps_override'),
		enrolled: integer('enrolled', { mode: 'boolean' }).notNull().default(true),
		...timestamps
	},
	(t) => [uniqueIndex('affiliate_apps_pair_idx').on(t.affiliateId, t.appId)]
);

/* ------------------------------------------------------------- attribution */

export const referralClicks = sqliteTable(
	'referral_clicks',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => newId('clk')),
		affiliateId: text('affiliate_id')
			.notNull()
			.references(() => affiliates.id, { onDelete: 'cascade' }),
		appId: text('app_id')
			.notNull()
			.references(() => apps.id, { onDelete: 'cascade' }),
		refCode: text('ref_code').notNull(),
		landingUrl: text('landing_url'),
		referer: text('referer'),
		userAgent: text('user_agent'),
		country: text('country'),
		/** Hashed, never the raw address. */
		ipHash: text('ip_hash'),
		/** Set once this click gets matched to an install. */
		referralId: text('referral_id'),
		expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
		createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now)
	},
	(t) => [
		index('clicks_affiliate_idx').on(t.affiliateId),
		index('clicks_app_idx').on(t.appId),
		index('clicks_created_idx').on(t.createdAt)
	]
);

/** A merchant shop credited to an affiliate for one app. */
export const referrals = sqliteTable(
	'referrals',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => newId('ref')),
		affiliateId: text('affiliate_id')
			.notNull()
			.references(() => affiliates.id, { onDelete: 'cascade' }),
		appId: text('app_id')
			.notNull()
			.references(() => apps.id, { onDelete: 'cascade' }),
		shopDomain: text('shop_domain').notNull(),
		shopName: text('shop_name'),
		source: text('source', { enum: ['click', 'claim', 'manual', 'partner_api'] }).notNull(),
		clickId: text('click_id'),
		claimId: text('claim_id'),
		status: text('status', { enum: ['pending', 'active', 'churned', 'rejected'] })
			.notNull()
			.default('pending'),
		/** Rate locked in at attribution so later app changes don't rewrite history. */
		commissionBps: integer('commission_bps').notNull(),
		commissionEndsAt: integer('commission_ends_at', { mode: 'timestamp' }),
		installedAt: integer('installed_at', { mode: 'timestamp' }),
		firstChargeAt: integer('first_charge_at', { mode: 'timestamp' }),
		churnedAt: integer('churned_at', { mode: 'timestamp' }),
		lifetimeRevenueCents: integer('lifetime_revenue_cents').notNull().default(0),
		lifetimeCommissionCents: integer('lifetime_commission_cents').notNull().default(0),
		...timestamps
	},
	(t) => [
		uniqueIndex('referrals_app_shop_idx').on(t.appId, t.shopDomain),
		index('referrals_affiliate_idx').on(t.affiliateId),
		index('referrals_status_idx').on(t.status)
	]
);

/** "I referred this shop but it wasn't tracked" — reviewed by an admin. */
export const referralClaims = sqliteTable(
	'referral_claims',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => newId('clm')),
		affiliateId: text('affiliate_id')
			.notNull()
			.references(() => affiliates.id, { onDelete: 'cascade' }),
		appId: text('app_id')
			.notNull()
			.references(() => apps.id, { onDelete: 'cascade' }),
		shopDomain: text('shop_domain').notNull(),
		referralDate: integer('referral_date', { mode: 'timestamp' }).notNull(),
		note: text('note'),
		status: text('status', { enum: ['pending', 'approved', 'rejected'] })
			.notNull()
			.default('pending'),
		reviewedAt: integer('reviewed_at', { mode: 'timestamp' }),
		reviewedBy: text('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
		reviewNote: text('review_note'),
		referralId: text('referral_id'),
		...timestamps
	},
	(t) => [
		index('claims_affiliate_idx').on(t.affiliateId),
		index('claims_status_idx').on(t.status)
	]
);

/* ------------------------------------------------------- money in and out */

/** One line per billed Shopify Partner transaction. */
export const commissions = sqliteTable(
	'commissions',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => newId('cmm')),
		referralId: text('referral_id')
			.notNull()
			.references(() => referrals.id, { onDelete: 'cascade' }),
		affiliateId: text('affiliate_id')
			.notNull()
			.references(() => affiliates.id, { onDelete: 'cascade' }),
		appId: text('app_id')
			.notNull()
			.references(() => apps.id, { onDelete: 'cascade' }),
		/** Shopify Partner transaction id — keeps the sync idempotent. */
		partnerTransactionId: text('partner_transaction_id'),
		/** The raw revenue row this commission was derived from. */
		transactionId: text('transaction_id').references(() => transactions.id, {
			onDelete: 'set null'
		}),
		chargeType: text('charge_type', {
			enum: ['recurring', 'one_time', 'usage', 'adjustment', 'refund']
		}).notNull(),
		currency: text('currency').notNull().default('USD'),
		/** What the merchant paid. */
		grossAmountCents: integer('gross_amount_cents').notNull().default(0),
		/** What the developer received after Shopify's cut. */
		netAmountCents: integer('net_amount_cents').notNull().default(0),
		commissionBps: integer('commission_bps').notNull(),
		/** The affiliate's share. Negative on a refund. */
		amountCents: integer('amount_cents').notNull(),
		status: text('status', { enum: ['pending', 'approved', 'paid', 'void'] })
			.notNull()
			.default('pending'),
		occurredAt: integer('occurred_at', { mode: 'timestamp' }).notNull(),
		/** Clears the refund window; only then can it join a payout. */
		availableAt: integer('available_at', { mode: 'timestamp' }).notNull(),
		payoutId: text('payout_id'),
		note: text('note'),
		...timestamps
	},
	(t) => [
		uniqueIndex('commissions_partner_txn_idx').on(t.partnerTransactionId),
		index('commissions_affiliate_idx').on(t.affiliateId),
		index('commissions_referral_idx').on(t.referralId),
		index('commissions_status_idx').on(t.status),
		index('commissions_payout_idx').on(t.payoutId)
	]
);

export const payouts = sqliteTable(
	'payouts',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => newId('pay')),
		affiliateId: text('affiliate_id')
			.notNull()
			.references(() => affiliates.id, { onDelete: 'cascade' }),
		amountCents: integer('amount_cents').notNull(),
		currency: text('currency').notNull().default('USD'),
		method: text('method', { enum: ['paypal', 'wise', 'bank'] }),
		reference: text('reference'),
		status: text('status', { enum: ['draft', 'processing', 'paid', 'failed'] })
			.notNull()
			.default('draft'),
		periodStart: integer('period_start', { mode: 'timestamp' }),
		periodEnd: integer('period_end', { mode: 'timestamp' }),
		processedAt: integer('processed_at', { mode: 'timestamp' }),
		paidAt: integer('paid_at', { mode: 'timestamp' }),
		createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
		note: text('note'),
		...timestamps
	},
	(t) => [index('payouts_affiliate_idx').on(t.affiliateId), index('payouts_status_idx').on(t.status)]
);

/* -------------------------------------------------------- sync and audit */

export const partnerSyncRuns = sqliteTable(
	'partner_sync_runs',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => newId('syn')),
		partnerAccountId: text('partner_account_id').references(() => partnerAccounts.id, {
			onDelete: 'cascade'
		}),
		kind: text('kind', { enum: ['transactions', 'installs'] }).notNull(),
		trigger: text('trigger', { enum: ['cron', 'manual'] })
			.notNull()
			.default('cron'),
		status: text('status', { enum: ['running', 'success', 'failed'] })
			.notNull()
			.default('running'),
		cursor: text('cursor'),
		recordsSeen: integer('records_seen').notNull().default(0),
		recordsMatched: integer('records_matched').notNull().default(0),
		commissionsCreated: integer('commissions_created').notNull().default(0),
		error: text('error'),
		startedAt: integer('started_at', { mode: 'timestamp' }).notNull().default(now),
		finishedAt: integer('finished_at', { mode: 'timestamp' })
	},
	(t) => [index('sync_runs_started_idx').on(t.startedAt)]
);

/**
 * What a staff user is allowed to see. A row either names one app, or names a
 * partner account and covers every app under it. No rows means no access.
 * Full admins have no rows and are not filtered.
 */
export const adminScopes = sqliteTable(
	'admin_scopes',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => newId('scp')),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		partnerAccountId: text('partner_account_id').references(() => partnerAccounts.id, {
			onDelete: 'cascade'
		}),
		appId: text('app_id').references(() => apps.id, { onDelete: 'cascade' }),
		createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now)
	},
	(t) => [
		index('admin_scopes_user_idx').on(t.userId),
		uniqueIndex('admin_scopes_unique_idx').on(t.userId, t.partnerAccountId, t.appId)
	]
);

export const auditLog = sqliteTable(
	'audit_log',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => newId('aud')),
		actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
		action: text('action').notNull(),
		entityType: text('entity_type').notNull(),
		entityId: text('entity_id').notNull(),
		metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
		createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now)
	},
	(t) => [index('audit_entity_idx').on(t.entityType, t.entityId)]
);

/* ---------------------------------------------------------------- relations */

export const usersRelations = relations(users, ({ one }) => ({
	affiliate: one(affiliates, { fields: [users.id], references: [affiliates.userId] })
}));

export const affiliatesRelations = relations(affiliates, ({ one, many }) => ({
	user: one(users, { fields: [affiliates.userId], references: [users.id] }),
	referrals: many(referrals),
	claims: many(referralClaims),
	commissions: many(commissions),
	payouts: many(payouts)
}));

export const partnerAccountsRelations = relations(partnerAccounts, ({ many }) => ({
	apps: many(apps),
	syncRuns: many(partnerSyncRuns)
}));

export const adminScopesRelations = relations(adminScopes, ({ one }) => ({
	user: one(users, { fields: [adminScopes.userId], references: [users.id] }),
	partnerAccount: one(partnerAccounts, {
		fields: [adminScopes.partnerAccountId],
		references: [partnerAccounts.id]
	}),
	app: one(apps, { fields: [adminScopes.appId], references: [apps.id] })
}));

export const appsRelations = relations(apps, ({ one, many }) => ({
	partnerAccount: one(partnerAccounts, {
		fields: [apps.partnerAccountId],
		references: [partnerAccounts.id]
	}),
	referrals: many(referrals),
	commissions: many(commissions),
	installs: many(installs),
	transactions: many(transactions)
}));

export const merchantsRelations = relations(merchants, ({ many }) => ({
	installs: many(installs),
	transactions: many(transactions),
	events: many(installEvents)
}));

export const installsRelations = relations(installs, ({ one, many }) => ({
	app: one(apps, { fields: [installs.appId], references: [apps.id] }),
	merchant: one(merchants, { fields: [installs.merchantId], references: [merchants.id] }),
	events: many(installEvents),
	lifecycleEmails: many(lifecycleEmails)
}));

export const installEventsRelations = relations(installEvents, ({ one }) => ({
	install: one(installs, { fields: [installEvents.installId], references: [installs.id] }),
	app: one(apps, { fields: [installEvents.appId], references: [apps.id] }),
	merchant: one(merchants, { fields: [installEvents.merchantId], references: [merchants.id] })
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
	app: one(apps, { fields: [transactions.appId], references: [apps.id] }),
	merchant: one(merchants, { fields: [transactions.merchantId], references: [merchants.id] })
}));

export const lifecycleEmailsRelations = relations(lifecycleEmails, ({ one }) => ({
	install: one(installs, { fields: [lifecycleEmails.installId], references: [installs.id] }),
	app: one(apps, { fields: [lifecycleEmails.appId], references: [apps.id] }),
	merchant: one(merchants, { fields: [lifecycleEmails.merchantId], references: [merchants.id] })
}));

export const referralsRelations = relations(referrals, ({ one, many }) => ({
	affiliate: one(affiliates, { fields: [referrals.affiliateId], references: [affiliates.id] }),
	app: one(apps, { fields: [referrals.appId], references: [apps.id] }),
	commissions: many(commissions)
}));

export const referralClaimsRelations = relations(referralClaims, ({ one }) => ({
	affiliate: one(affiliates, { fields: [referralClaims.affiliateId], references: [affiliates.id] }),
	app: one(apps, { fields: [referralClaims.appId], references: [apps.id] })
}));

export const commissionsRelations = relations(commissions, ({ one }) => ({
	referral: one(referrals, { fields: [commissions.referralId], references: [referrals.id] }),
	affiliate: one(affiliates, { fields: [commissions.affiliateId], references: [affiliates.id] }),
	app: one(apps, { fields: [commissions.appId], references: [apps.id] }),
	payout: one(payouts, { fields: [commissions.payoutId], references: [payouts.id] })
}));

export const payoutsRelations = relations(payouts, ({ one, many }) => ({
	affiliate: one(affiliates, { fields: [payouts.affiliateId], references: [affiliates.id] }),
	commissions: many(commissions)
}));

/* -------------------------------------------------------------------- types */

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type App = typeof apps.$inferSelect;
export type Affiliate = typeof affiliates.$inferSelect;
export type AffiliateApp = typeof affiliateApps.$inferSelect;
export type ReferralClick = typeof referralClicks.$inferSelect;
export type Referral = typeof referrals.$inferSelect;
export type ReferralClaim = typeof referralClaims.$inferSelect;
export type Commission = typeof commissions.$inferSelect;
export type Merchant = typeof merchants.$inferSelect;
export type Install = typeof installs.$inferSelect;
export type InstallEvent = typeof installEvents.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type LifecycleEmail = typeof lifecycleEmails.$inferSelect;
export type PartnerAccount = typeof partnerAccounts.$inferSelect;
export type AdminScope = typeof adminScopes.$inferSelect;
export type Payout = typeof payouts.$inferSelect;
export type PartnerSyncRun = typeof partnerSyncRuns.$inferSelect;
