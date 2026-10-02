CREATE TABLE `app_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`review_key` text NOT NULL,
	`rating` integer NOT NULL,
	`body` text,
	`author` text,
	`country` text,
	`usage` text,
	`posted_at` integer,
	`replied` integer DEFAULT false NOT NULL,
	`merchant_id` text,
	`matched_by` text,
	`first_seen_at` integer DEFAULT (unixepoch()) NOT NULL,
	`last_seen_at` integer DEFAULT (unixepoch()) NOT NULL,
	`removed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_reviews_key_idx` ON `app_reviews` (`app_id`,`review_key`);--> statement-breakpoint
CREATE INDEX `app_reviews_posted_idx` ON `app_reviews` (`posted_at`);--> statement-breakpoint
CREATE TABLE `charge_events` (
	`id` text PRIMARY KEY NOT NULL,
	`charge_id` text NOT NULL,
	`app_id` text NOT NULL,
	`action` text NOT NULL,
	`amount_cents` integer,
	`billing_on` integer,
	`occurred_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`charge_id`) REFERENCES `app_charges`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `charge_events_app_idx` ON `charge_events` (`app_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `charge_events_unique_idx` ON `charge_events` (`charge_id`,`action`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `listing_traffic` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`grain` text NOT NULL,
	`period` text NOT NULL,
	`listing_views` integer DEFAULT 0 NOT NULL,
	`add_app_clicks` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `listing_traffic_unique_idx` ON `listing_traffic` (`app_id`,`grain`,`period`);--> statement-breakpoint
CREATE TABLE `notification_deliveries` (
	`key` text PRIMARY KEY NOT NULL,
	`topic` text NOT NULL,
	`status` text DEFAULT 'sent' NOT NULL,
	`error` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `subscription_events` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`charge_id` text NOT NULL,
	`merchant_id` text,
	`shop_domain` text NOT NULL,
	`type` text NOT NULL,
	`mrr_delta_cents` integer DEFAULT 0 NOT NULL,
	`monthly_amount_cents` integer DEFAULT 0 NOT NULL,
	`plan_name` text,
	`churn_reason` text,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`charge_id`) REFERENCES `app_charges`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `subscription_events_app_idx` ON `subscription_events` (`app_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `subscription_events_occurred_idx` ON `subscription_events` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `subscription_events_shop_idx` ON `subscription_events` (`app_id`,`shop_domain`);--> statement-breakpoint
CREATE UNIQUE INDEX `subscription_events_unique_idx` ON `subscription_events` (`charge_id`,`type`,`occurred_at`);--> statement-breakpoint
ALTER TABLE `app_charges` ADD `billing_interval` text DEFAULT 'monthly' NOT NULL;--> statement-breakpoint
ALTER TABLE `app_charges` ADD `monthly_amount_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `app_charges` ADD `paid_at` integer;--> statement-breakpoint
ALTER TABLE `app_charges` ADD `trial_status` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `app_charges` ADD `trial_ends_at` integer;--> statement-breakpoint
ALTER TABLE `app_charges` ADD `churned_at` integer;--> statement-breakpoint
ALTER TABLE `app_charges` ADD `churn_reason` text;--> statement-breakpoint
ALTER TABLE `app_charges` ADD `replaces_charge_id` text;--> statement-breakpoint
ALTER TABLE `apps` ADD `ga4_dataset` text;--> statement-breakpoint
ALTER TABLE `apps` ADD `rating_hundredths` integer;--> statement-breakpoint
ALTER TABLE `apps` ADD `review_count` integer;--> statement-breakpoint
ALTER TABLE `apps` ADD `reviews_synced_at` integer;--> statement-breakpoint
ALTER TABLE `transactions` ADD `partner_charge_id` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `billing_interval` text;--> statement-breakpoint
CREATE INDEX `transactions_charge_idx` ON `transactions` (`partner_charge_id`);--> statement-breakpoint
-- Seed the charge trail from what app_charges already folded: an activation,
-- and the latest status when it is not the activation itself. A Partner
-- backfill later adds the exact trail; the unique index dedupes the overlap,
-- because both carry the same timestamps.
INSERT OR IGNORE INTO `charge_events` (`id`, `charge_id`, `app_id`, `action`, `amount_cents`, `billing_on`, `occurred_at`)
SELECT 'che_' || lower(hex(randomblob(8))), `id`, `app_id`, 'activated', `amount_cents`, `billing_on`, `activated_at`
FROM `app_charges` WHERE `activated_at` IS NOT NULL;--> statement-breakpoint
INSERT OR IGNORE INTO `charge_events` (`id`, `charge_id`, `app_id`, `action`, `amount_cents`, `billing_on`, `occurred_at`)
SELECT 'che_' || lower(hex(randomblob(8))), `id`, `app_id`,
	CASE `status` WHEN 'pending' THEN 'accepted' ELSE `status` END,
	`amount_cents`, NULL, `occurred_at`
FROM `app_charges`
WHERE `status` <> 'active' AND (`activated_at` IS NULL OR `occurred_at` <> `activated_at`);--> statement-breakpoint
-- Until the first rebuild, keep MRR where it was: live charges count from
-- activation at face value. The rebuild then applies intervals and trials.
UPDATE `app_charges` SET
	`monthly_amount_cents` = `amount_cents`,
	`paid_at` = CASE WHEN `status` = 'active' THEN `activated_at` END,
	`churned_at` = `ended_at`,
	`churn_reason` = CASE WHEN `ended_at` IS NOT NULL THEN 'cancelled' END
WHERE `kind` = 'recurring';
