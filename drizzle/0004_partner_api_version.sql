-- 2025-01 was never a valid Shopify Partner API version and returns
-- {"errors":[{"message":"Invalid API version"}]} with a 404. Move any account
-- still on it to a version Shopify currently serves.
UPDATE `partner_accounts` SET `api_version` = '2026-07' WHERE `api_version` = '2025-01';
