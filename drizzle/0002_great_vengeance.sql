CREATE TABLE `admin_scopes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`partner_account_id` text,
	`app_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`partner_account_id`) REFERENCES `partner_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `admin_scopes_user_idx` ON `admin_scopes` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `admin_scopes_unique_idx` ON `admin_scopes` (`user_id`,`partner_account_id`,`app_id`);--> statement-breakpoint
CREATE TABLE `partner_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`organization_id` text NOT NULL,
	`api_token_encrypted` text,
	`api_token_hint` text,
	`api_version` text DEFAULT '2025-01' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`last_synced_at` integer,
	`last_sync_error` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `partner_accounts_org_idx` ON `partner_accounts` (`organization_id`);--> statement-breakpoint
ALTER TABLE `apps` ADD `partner_account_id` text REFERENCES partner_accounts(id);--> statement-breakpoint
CREATE INDEX `apps_partner_account_idx` ON `apps` (`partner_account_id`);--> statement-breakpoint
ALTER TABLE `partner_sync_runs` ADD `partner_account_id` text REFERENCES partner_accounts(id);--> statement-breakpoint
ALTER TABLE `users` ADD `view_affiliate_data` integer DEFAULT false NOT NULL;