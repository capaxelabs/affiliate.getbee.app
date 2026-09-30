DROP TABLE `lifecycle_emails`;--> statement-breakpoint
ALTER TABLE `apps` DROP COLUMN `support_email`;--> statement-breakpoint
ALTER TABLE `apps` DROP COLUMN `welcome_email_enabled`;--> statement-breakpoint
ALTER TABLE `apps` DROP COLUMN `offboard_email_enabled`;