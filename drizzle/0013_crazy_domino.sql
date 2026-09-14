CREATE TABLE `internal_shops` (
	`id` text PRIMARY KEY NOT NULL,
	`shop_domain` text NOT NULL,
	`reason` text DEFAULT 'app_review' NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `internal_shops_domain_idx` ON `internal_shops` (`shop_domain`);--> statement-breakpoint
-- Seed from what is already in the database. Three signals, in the order they
-- are trustworthy: the review-store domain pattern, the redact placeholder,
-- and a @shopify.com owner email — the last of which is the only way to catch
-- a reviewer using an ordinary-looking domain, and only ever arrives on the
-- app's own install webhook.
INSERT OR IGNORE INTO internal_shops (id, shop_domain, reason, note)
SELECT 'int_seed_' || substr(hex(randomblob(8)), 1, 16), shop_domain, 'app_review', 'seeded: domain pattern'
FROM merchants WHERE shop_domain LIKE 'app-review-%';
--> statement-breakpoint
INSERT OR IGNORE INTO internal_shops (id, shop_domain, reason, note)
SELECT 'int_seed_' || substr(hex(randomblob(8)), 1, 16), shop_domain, 'redacted', 'seeded: GDPR redact placeholder'
FROM merchants WHERE shop_domain LIKE 'redacted.%';
--> statement-breakpoint
INSERT OR IGNORE INTO internal_shops (id, shop_domain, reason, note)
SELECT 'int_seed_' || substr(hex(randomblob(8)), 1, 16), shop_domain, 'app_review', 'seeded: ' || email
FROM merchants WHERE email LIKE '%@shopify.com';
--> statement-breakpoint
-- Cascades to installs and install_events. Nothing else references these rows:
-- they have no transactions, no referrals and no lifecycle email.
DELETE FROM merchants WHERE shop_domain IN (SELECT shop_domain FROM internal_shops);
