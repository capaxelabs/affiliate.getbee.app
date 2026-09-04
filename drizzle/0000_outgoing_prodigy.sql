CREATE TABLE `affiliate_apps` (
	`id` text PRIMARY KEY NOT NULL,
	`affiliate_id` text NOT NULL,
	`app_id` text NOT NULL,
	`commission_bps_override` integer,
	`enrolled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`affiliate_id`) REFERENCES `affiliates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `affiliate_apps_pair_idx` ON `affiliate_apps` (`affiliate_id`,`app_id`);--> statement-breakpoint
CREATE TABLE `affiliates` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`ref_code` text NOT NULL,
	`company` text,
	`website` text,
	`promotion_method` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`commission_bps_override` integer,
	`payout_method` text,
	`payout_email` text,
	`payout_details` text,
	`min_payout_cents` integer DEFAULT 5000 NOT NULL,
	`tax_country` text,
	`tax_id` text,
	`reviewed_at` integer,
	`reviewed_by` text,
	`review_note` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `affiliates_user_idx` ON `affiliates` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `affiliates_ref_code_idx` ON `affiliates` (`ref_code`);--> statement-breakpoint
CREATE INDEX `affiliates_status_idx` ON `affiliates` (`status`);--> statement-breakpoint
CREATE TABLE `apps` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`icon_url` text,
	`listing_url` text NOT NULL,
	`partner_app_id` text,
	`commission_bps` integer DEFAULT 2000 NOT NULL,
	`commission_months` integer,
	`cookie_days` integer DEFAULT 90 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `apps_slug_idx` ON `apps` (`slug`);--> statement-breakpoint
CREATE INDEX `apps_partner_idx` ON `apps` (`partner_app_id`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`metadata` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_entity_idx` ON `audit_log` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `commissions` (
	`id` text PRIMARY KEY NOT NULL,
	`referral_id` text NOT NULL,
	`affiliate_id` text NOT NULL,
	`app_id` text NOT NULL,
	`partner_transaction_id` text,
	`charge_type` text NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`gross_amount_cents` integer DEFAULT 0 NOT NULL,
	`net_amount_cents` integer DEFAULT 0 NOT NULL,
	`commission_bps` integer NOT NULL,
	`amount_cents` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`occurred_at` integer NOT NULL,
	`available_at` integer NOT NULL,
	`payout_id` text,
	`note` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`referral_id`) REFERENCES `referrals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`affiliate_id`) REFERENCES `affiliates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `commissions_partner_txn_idx` ON `commissions` (`partner_transaction_id`);--> statement-breakpoint
CREATE INDEX `commissions_affiliate_idx` ON `commissions` (`affiliate_id`);--> statement-breakpoint
CREATE INDEX `commissions_referral_idx` ON `commissions` (`referral_id`);--> statement-breakpoint
CREATE INDEX `commissions_status_idx` ON `commissions` (`status`);--> statement-breakpoint
CREATE INDEX `commissions_payout_idx` ON `commissions` (`payout_id`);--> statement-breakpoint
CREATE TABLE `login_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`code_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`used_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `login_codes_email_idx` ON `login_codes` (`email`);--> statement-breakpoint
CREATE TABLE `partner_sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`trigger` text DEFAULT 'cron' NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`cursor` text,
	`records_seen` integer DEFAULT 0 NOT NULL,
	`records_matched` integer DEFAULT 0 NOT NULL,
	`commissions_created` integer DEFAULT 0 NOT NULL,
	`error` text,
	`started_at` integer DEFAULT (unixepoch()) NOT NULL,
	`finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `sync_runs_started_idx` ON `partner_sync_runs` (`started_at`);--> statement-breakpoint
CREATE TABLE `payouts` (
	`id` text PRIMARY KEY NOT NULL,
	`affiliate_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`method` text,
	`reference` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`period_start` integer,
	`period_end` integer,
	`processed_at` integer,
	`paid_at` integer,
	`created_by` text,
	`note` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`affiliate_id`) REFERENCES `affiliates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `payouts_affiliate_idx` ON `payouts` (`affiliate_id`);--> statement-breakpoint
CREATE INDEX `payouts_status_idx` ON `payouts` (`status`);--> statement-breakpoint
CREATE TABLE `referral_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`affiliate_id` text NOT NULL,
	`app_id` text NOT NULL,
	`shop_domain` text NOT NULL,
	`referral_date` integer NOT NULL,
	`note` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`reviewed_at` integer,
	`reviewed_by` text,
	`review_note` text,
	`referral_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`affiliate_id`) REFERENCES `affiliates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `claims_affiliate_idx` ON `referral_claims` (`affiliate_id`);--> statement-breakpoint
CREATE INDEX `claims_status_idx` ON `referral_claims` (`status`);--> statement-breakpoint
CREATE TABLE `referral_clicks` (
	`id` text PRIMARY KEY NOT NULL,
	`affiliate_id` text NOT NULL,
	`app_id` text NOT NULL,
	`ref_code` text NOT NULL,
	`landing_url` text,
	`referer` text,
	`user_agent` text,
	`country` text,
	`ip_hash` text,
	`referral_id` text,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`affiliate_id`) REFERENCES `affiliates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `clicks_affiliate_idx` ON `referral_clicks` (`affiliate_id`);--> statement-breakpoint
CREATE INDEX `clicks_app_idx` ON `referral_clicks` (`app_id`);--> statement-breakpoint
CREATE INDEX `clicks_created_idx` ON `referral_clicks` (`created_at`);--> statement-breakpoint
CREATE TABLE `referrals` (
	`id` text PRIMARY KEY NOT NULL,
	`affiliate_id` text NOT NULL,
	`app_id` text NOT NULL,
	`shop_domain` text NOT NULL,
	`shop_name` text,
	`source` text NOT NULL,
	`click_id` text,
	`claim_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`commission_bps` integer NOT NULL,
	`commission_ends_at` integer,
	`installed_at` integer,
	`first_charge_at` integer,
	`churned_at` integer,
	`lifetime_revenue_cents` integer DEFAULT 0 NOT NULL,
	`lifetime_commission_cents` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`affiliate_id`) REFERENCES `affiliates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `referrals_app_shop_idx` ON `referrals` (`app_id`,`shop_domain`);--> statement-breakpoint
CREATE INDEX `referrals_affiliate_idx` ON `referrals` (`affiliate_id`);--> statement-breakpoint
CREATE INDEX `referrals_status_idx` ON `referrals` (`status`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`role` text DEFAULT 'affiliate' NOT NULL,
	`last_login_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_idx` ON `users` (`email`);