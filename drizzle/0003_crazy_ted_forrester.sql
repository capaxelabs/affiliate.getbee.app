PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_apps` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`icon_url` text,
	`listing_url` text,
	`affiliate_enabled` integer DEFAULT false NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`partner_account_id` text,
	`partner_app_id` text,
	`commission_bps` integer DEFAULT 2000 NOT NULL,
	`commission_months` integer,
	`cookie_days` integer DEFAULT 90 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`support_email` text,
	`welcome_email_enabled` integer DEFAULT false NOT NULL,
	`offboard_email_enabled` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`partner_account_id`) REFERENCES `partner_accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_apps`("id", "slug", "name", "icon_url", "listing_url", "affiliate_enabled", "source", "partner_account_id", "partner_app_id", "commission_bps", "commission_months", "cookie_days", "status", "support_email", "welcome_email_enabled", "offboard_email_enabled", "created_at", "updated_at") SELECT "id", "slug", "name", "icon_url", "listing_url", 1, 'manual', "partner_account_id", "partner_app_id", "commission_bps", "commission_months", "cookie_days", "status", "support_email", "welcome_email_enabled", "offboard_email_enabled", "created_at", "updated_at" FROM `apps`;--> statement-breakpoint
DROP TABLE `apps`;--> statement-breakpoint
ALTER TABLE `__new_apps` RENAME TO `apps`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `apps_slug_idx` ON `apps` (`slug`);--> statement-breakpoint
CREATE INDEX `apps_partner_idx` ON `apps` (`partner_app_id`);--> statement-breakpoint
CREATE INDEX `apps_partner_account_idx` ON `apps` (`partner_account_id`);