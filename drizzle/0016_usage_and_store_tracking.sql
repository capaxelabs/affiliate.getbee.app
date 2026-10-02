CREATE TABLE `app_credits` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`merchant_id` text,
	`shop_domain` text NOT NULL,
	`partner_credit_id` text NOT NULL,
	`name` text,
	`amount_cents` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_credits_partner_idx` ON `app_credits` (`partner_credit_id`);--> statement-breakpoint
CREATE INDEX `app_credits_app_idx` ON `app_credits` (`app_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `competitor_listings` (
	`id` text PRIMARY KEY NOT NULL,
	`handle` text NOT NULL,
	`name` text,
	`rating_hundredths` integer,
	`review_count` integer,
	`checked_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `competitor_listings_handle_idx` ON `competitor_listings` (`handle`);--> statement-breakpoint
CREATE TABLE `keyword_positions` (
	`id` text PRIMARY KEY NOT NULL,
	`keyword_id` text NOT NULL,
	`handle` text NOT NULL,
	`day` text NOT NULL,
	`position` integer,
	FOREIGN KEY (`keyword_id`) REFERENCES `store_keywords`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `keyword_positions_unique_idx` ON `keyword_positions` (`keyword_id`,`handle`,`day`);--> statement-breakpoint
CREATE TABLE `listing_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`handle` text NOT NULL,
	`day` text NOT NULL,
	`rating_hundredths` integer,
	`review_count` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `listing_snapshots_unique_idx` ON `listing_snapshots` (`handle`,`day`);--> statement-breakpoint
CREATE TABLE `store_keywords` (
	`id` text PRIMARY KEY NOT NULL,
	`keyword` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `store_keywords_keyword_idx` ON `store_keywords` (`keyword`);--> statement-breakpoint
CREATE TABLE `traffic_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`period` text NOT NULL,
	`surface` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`listing_views` integer DEFAULT 0 NOT NULL,
	`add_app_clicks` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `traffic_sources_unique_idx` ON `traffic_sources` (`app_id`,`period`,`surface`,`detail`);--> statement-breakpoint
CREATE TABLE `usage_charges` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`merchant_id` text,
	`shop_domain` text NOT NULL,
	`partner_record_id` text NOT NULL,
	`name` text,
	`amount_cents` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `usage_charges_record_idx` ON `usage_charges` (`partner_record_id`);--> statement-breakpoint
CREATE INDEX `usage_charges_app_idx` ON `usage_charges` (`app_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `usage_events` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`merchant_id` text,
	`shop_domain` text NOT NULL,
	`name` text NOT NULL,
	`properties` text,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `usage_events_app_idx` ON `usage_events` (`app_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `usage_events_shop_idx` ON `usage_events` (`app_id`,`shop_domain`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `usage_events_name_idx` ON `usage_events` (`app_id`,`name`);--> statement-breakpoint
ALTER TABLE `apps` ADD `activation_event` text;--> statement-breakpoint
ALTER TABLE `installs` ADD `last_active_at` integer;