-- Secrets are no longer encrypted at rest. The ENCRYPTION_KEY that sealed these
-- values is gone, so every stored ciphertext is unreadable and worth nothing —
-- clear it rather than let it masquerade as a usable credential.
--
-- SQLite renames a column in place, so this needs no table rebuild. A rebuild of
-- partner_accounts would fail on D1 anyway: apps and partner_sync_runs reference
-- it, and D1 does not honour PRAGMA foreign_keys=OFF across statements.
ALTER TABLE `partner_accounts` RENAME COLUMN `api_token_encrypted` TO `api_token`;--> statement-breakpoint

-- Dead ciphertext. Re-enter the Partner Access Token from the admin.
UPDATE `partner_accounts` SET `api_token` = NULL, `last_sync_error` = NULL;--> statement-breakpoint

-- Same for the ingest key. Regenerate it, or restore the plaintext an app holds.
DELETE FROM `settings` WHERE `key` = 'ingest_key';
