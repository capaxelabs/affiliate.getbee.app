CREATE TABLE `app_charges` (
	`id` text PRIMARY KEY NOT NULL,
	`partner_charge_id` text NOT NULL,
	`app_id` text NOT NULL,
	`merchant_id` text,
	`shop_domain` text NOT NULL,
	`kind` text NOT NULL,
	`name` text,
	`amount_cents` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`activated_at` integer,
	`billing_on` integer,
	`ended_at` integer,
	`occurred_at` integer DEFAULT (unixepoch()) NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_charges_partner_idx` ON `app_charges` (`partner_charge_id`);--> statement-breakpoint
CREATE INDEX `app_charges_app_idx` ON `app_charges` (`app_id`);--> statement-breakpoint
CREATE INDEX `app_charges_status_idx` ON `app_charges` (`status`);--> statement-breakpoint
CREATE INDEX `app_charges_shop_idx` ON `app_charges` (`shop_domain`);