ALTER TABLE `apps` ADD `api_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `apps_api_key_idx` ON `apps` (`api_key`);