DROP INDEX `apps_partner_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `apps_partner_idx` ON `apps` (`partner_app_id`);