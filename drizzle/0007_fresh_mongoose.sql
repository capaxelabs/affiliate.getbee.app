-- The Partner API and each app's own webhook both report installs and uninstalls.
-- Without a dedup key the same moment is recorded twice, inflating install_count
-- and growing the event trail on every overlapping sync window.
--
-- 'reinstalled' is dropped as a distinct type: it is just an 'installed' after an
-- 'uninstalled', and keeping it separate meant the same install could be filed
-- under two types at the same timestamp.
UPDATE `install_events` SET `type` = 'installed' WHERE `type` = 'reinstalled';--> statement-breakpoint
-- Collapse anything already duplicated so the unique index can be created.
DELETE FROM `install_events` WHERE `id` NOT IN (
  SELECT MIN(`id`) FROM `install_events` GROUP BY `install_id`, `type`, `occurred_at`
);--> statement-breakpoint
CREATE UNIQUE INDEX `install_events_unique_idx` ON `install_events` (`install_id`,`type`,`occurred_at`);
