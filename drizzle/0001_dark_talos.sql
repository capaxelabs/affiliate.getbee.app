CREATE TABLE `install_events` (
	`id` text PRIMARY KEY NOT NULL,
	`install_id` text NOT NULL,
	`app_id` text NOT NULL,
	`merchant_id` text NOT NULL,
	`type` text NOT NULL,
	`source` text DEFAULT 'ingest' NOT NULL,
	`metadata` text,
	`occurred_at` integer DEFAULT (unixepoch()) NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`install_id`) REFERENCES `installs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `install_events_install_idx` ON `install_events` (`install_id`);--> statement-breakpoint
CREATE INDEX `install_events_occurred_idx` ON `install_events` (`occurred_at`);--> statement-breakpoint
CREATE TABLE `installs` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`merchant_id` text NOT NULL,
	`status` text DEFAULT 'installed' NOT NULL,
	`installed_at` integer DEFAULT (unixepoch()) NOT NULL,
	`uninstalled_at` integer,
	`install_count` integer DEFAULT 1 NOT NULL,
	`uninstall_reason` text,
	`uninstall_feedback` text,
	`plan` text,
	`referral_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `installs_app_merchant_idx` ON `installs` (`app_id`,`merchant_id`);--> statement-breakpoint
CREATE INDEX `installs_status_idx` ON `installs` (`status`);--> statement-breakpoint
CREATE INDEX `installs_installed_idx` ON `installs` (`installed_at`);--> statement-breakpoint
CREATE TABLE `lifecycle_emails` (
	`id` text PRIMARY KEY NOT NULL,
	`install_id` text NOT NULL,
	`app_id` text NOT NULL,
	`merchant_id` text NOT NULL,
	`kind` text NOT NULL,
	`to_email` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`send_after` integer DEFAULT (unixepoch()) NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`sent_at` integer,
	`error` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`install_id`) REFERENCES `installs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lifecycle_emails_install_kind_idx` ON `lifecycle_emails` (`install_id`,`kind`);--> statement-breakpoint
CREATE INDEX `lifecycle_emails_status_idx` ON `lifecycle_emails` (`status`,`send_after`);--> statement-breakpoint
CREATE TABLE `merchants` (
	`id` text PRIMARY KEY NOT NULL,
	`shop_domain` text NOT NULL,
	`name` text,
	`email` text,
	`owner_name` text,
	`phone` text,
	`primary_domain` text,
	`country` text,
	`currency` text,
	`timezone` text,
	`shopify_plan` text,
	`first_seen_at` integer DEFAULT (unixepoch()) NOT NULL,
	`last_seen_at` integer DEFAULT (unixepoch()) NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `merchants_shop_domain_idx` ON `merchants` (`shop_domain`);--> statement-breakpoint
CREATE INDEX `merchants_email_idx` ON `merchants` (`email`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`partner_transaction_id` text NOT NULL,
	`app_id` text NOT NULL,
	`merchant_id` text,
	`shop_domain` text,
	`charge_type` text NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`gross_amount_cents` integer DEFAULT 0 NOT NULL,
	`net_amount_cents` integer DEFAULT 0 NOT NULL,
	`occurred_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_partner_idx` ON `transactions` (`partner_transaction_id`);--> statement-breakpoint
CREATE INDEX `transactions_app_idx` ON `transactions` (`app_id`);--> statement-breakpoint
CREATE INDEX `transactions_merchant_idx` ON `transactions` (`merchant_id`);--> statement-breakpoint
CREATE INDEX `transactions_occurred_idx` ON `transactions` (`occurred_at`);--> statement-breakpoint
ALTER TABLE `apps` ADD `support_email` text;--> statement-breakpoint
ALTER TABLE `apps` ADD `welcome_email_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `apps` ADD `offboard_email_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `commissions` ADD `transaction_id` text REFERENCES transactions(id);