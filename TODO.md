# TODO

Affiliate program + developer tooling for Bee Shopify apps.
Stack: SvelteKit 5 (runes) · shadcn-svelte · Tailwind v4 · Cloudflare Workers · D1 + Drizzle · KV.

Three roles, one login (email magic-code):
- `affiliate` — partner promoting Bee apps, sees own referrals/commissions/payouts
- `staff` — read-only, scoped to granted apps, affiliate visibility optional
- `admin` — full access, the only role that can write

## Cleanup

- [x] Delete InternKitty routes, services, queries, posts and components
- [x] Delete InternKitty server lib (auth, oauth, r2, rbac, notifications, ...)
- [x] Delete Bee SEO docs, drizzle migrations and stale static assets
- [x] Rewrite CLAUDE.md / AGENTS.md / README.md for the affiliate app
- [x] Retarget package.json, wrangler.jsonc, vite.config.ts, drizzle.config.ts
- [x] Strip InternKitty role themes out of app.css
- [x] Run `npm install` and `npm run check` (0 errors)

## Foundation

- [x] Drizzle schema: users, sessions, loginCodes, apps, affiliates, affiliateApps,
      referralClicks, referrals, referralClaims, commissions, payouts,
      partnerSyncRuns, auditLog
- [x] D1 client + `initDb` singleton per request
- [x] Magic-code auth (request code → verify → session cookie)
- [x] `hooks.server.ts` session load + role guards for `/app` and `/admin`
- [x] Email sender (tools.capaxe.com/email) with login-code + lifecycle templates
- [x] Generate migration `0000` and apply it to local D1
- [x] Create the D1 database and paste `database_id` into wrangler.jsonc
      (`npx wrangler d1 create bee-affiliates`) — the only placeholder left
- [x] Set the secrets: `CRON_SECRET`, `EMAIL_API_KEY`

## Affiliate portal (`/app`)

- [x] Sidebar shell: Home, Referrals, Payouts, Reports, Settings
- [x] Home — commission/payout stat cards + affiliated apps table with copy link
- [x] Pending-approval banner while affiliate status is `pending`
- [x] Referrals — searchable table + "Claim referral" dialog
- [x] Payouts — payout history with line items
- [x] Reports — commissions, revenue, referrals, payouts, funnel over a date range
- [x] Settings — profile, payout details, tax info
- [x] `/r/[code]` click tracker → App Store listing with ref cookie

## Admin (`/admin`)

- [x] Overview — program-wide stats and queues needing action
- [x] Apps — CRUD Shopify apps, commission rate, listing URL, icon
- [x] Affiliates — approve / reject / suspend, per-affiliate override rates
- [x] Claims — review queue, approve → creates referral, reject with reason
- [x] Referrals — all referrals, source (auto vs claim), manual attribution
- [x] Commissions — generated lines, adjust / void
- [x] Payouts — build a payout batch from approved commissions, mark paid
- [x] Partner sync — run history, trigger a manual sync

## Attribution

- [x] Click tracking with ref cookie (90-day window) + landing capture
- [x] Signed install ingest (`POST /api/track/install`) — the only automatic path
- [x] Manual claim flow with admin review
- [x] Shopify Partner API client (transactions + app installs, GraphQL)
- [x] Matcher: shop domain → click / claim → referral → commission lines
- [x] `POST /api/cron/sync` entry point for a scheduler (bearer-guarded)
- [x] Connect the Partner account (credentials live in the database now, encrypted,
      not as worker secrets)

## Merchants & revenue

- [x] `merchants`, `installs`, `install_events` — every shop, referred or not
- [x] `transactions` — all Partner revenue, the source of truth for dashboards
- [x] Sync records revenue + merchants for every transaction, commissions only
      for attributed shops
- [x] Admin → Merchants: list, filter by app/status, contact details, per-app
      revenue, uninstall reasons and feedback
- [x] Admin overview: gross / net / this month / MoM, revenue-by-app table
- [x] Apps page: installs, churn, this month and gross per app

## Merchant lifecycle email

- [x] `lifecycle_emails` outbox, unique per (install, kind)
- [x] Welcome on install (+15m) and offboarding/churn-survey on uninstall (+1h)
- [x] Per-app toggles + reply-to address, off by default
- [x] Re-checks toggle and install state at send time (no welcome to someone who
      already left; no offboarding to someone who reinstalled)
- [x] Drained by `POST /api/cron/sync` and by a button on Admin → Partner sync
- [x] Set `EMAIL_API_KEY` so these actually send

## Multiple partner accounts

- [x] `partner_accounts` table; `apps.partnerAccountId` links each app to one org
- [x] API tokens stored in D1, masked hint in the UI, never sent to a browser
- [x] Sync loops over every active account with its own credentials, per-account
      resume window and error recorded on the account
- [x] Admin → Partner accounts: connect, edit, rotate token, pause, disconnect
- [x] One-click import of the legacy `PARTNER_ORG_ID` / `PARTNER_API_TOKEN` env vars
- [x] Drop at-rest encryption for stored credentials (see CLAUDE.md → Partner accounts)
- [x] After importing, delete the `PARTNER_*` worker secrets

## App discovery and affiliate opt-in

- [x] Pull every app from the Partner API (`syncApps`) — on connect, on demand
      from the Apps page, and on every cron run
- [x] Discovery never overwrites admin-owned fields (slug, listing URL,
      commission, affiliate opt-in); only the name is refreshed
- [x] `apps.affiliateEnabled` — analytics cover every app, the affiliate program
      is opt-in per app
- [x] Opting in requires an App Store listing URL; opting out stops new referrals
      but leaves existing ones earning
- [x] Every affiliate surface filters on the flag, including `attributeReferral`
- [x] Verified against a live Partner account: discovery, transactions and
      installs all pull real data

## Restricted team access

- [x] `staff` role — read-only, enforced in `hooks.server.ts` (non-GET to `/admin/*` is 403)
- [x] `admin_scopes` — grant a single app or a whole partner account
- [x] `users.viewAffiliateData` — per-person toggle for the affiliate program
- [x] Every admin query filtered by scope; no grants means no data, not all data
- [x] Payouts, partner accounts, team and all writes stay owner-only
- [x] Admin → Team: add staff, grant/revoke, toggle affiliate visibility, promote/demote

## Wire up in each Bee app

- [x] On OAuth install, POST to `/api/track/install` with the captured `ref` plus
      a `shop` object (name, email, ownerName, country, currency, plan). Signed
      with `X-Bee-Signature` HMAC-SHA256 of the raw body using the ingest key
      from Admin → Apps, set in the app as `AFFILIATES_SECRET`.
- [x] On `app/uninstalled`, POST to `/api/track/uninstall`.
- [ ] POST again later with `reason` / `feedback` when a merchant replies to the
      offboarding survey — nothing sends that survey yet, see below.

## Ingest key

- [x] One key for every app and both track endpoints, stored encrypted in
      `settings` so the admin can read it back — a worker secret cannot be
- [x] Generate / reveal / regenerate from Admin → Apps, owner-only and audited
- [x] `/api/cron/sync` accepts it as a bearer token
- [x] `CRON_SECRET` still verifies, so anything already configured keeps working

## App detail page

- [x] `/admin/apps/[id]` — revenue, installs, churn, contactable and referral
      stats for one app
- [x] Four 12-month charts: gross, net, installs, uninstalls
- [x] Every merchant who installed it, newest first, paginated at 25
- [x] Installs/uninstalls come from `install_events`, so a shop that left and
      returned still counts in the month it first arrived
- [x] Merchant filters: search, status, country, plan and referred/organic,
      all combinable and reflected in the URL
- [x] Filter options come from the app's own merchants, so none returns nothing
- [x] Staff outside an app's scope get a 404, not a 403

## Blocking real use

- [x] Ingest key generated in Admin → Apps and set as `AFFILIATES_SECRET` in each
      Bee app
- [x] Affiliate turned on for RankFlo and Shootflo Studio
- [x] Reporter live in all 8 apps — 124 install records, 116 with a contactable
      merchant
- [ ] Turn welcome / offboarding email on per app in Admin → Apps. Both toggles
      are off for every app, so `lifecycle_emails` has never queued a row and no
      merchant has been mailed.
- [ ] Recruit the first affiliate. The only account is the admin, whose own
      affiliate record still sits on `pending`; 0 referrals and 0 commissions, so
      the attribution path has never run end to end in production.
- [ ] Only 2 Partner transactions exist, so commission generation is effectively
      untested against real billing.
- [x] Re-entered the Partner Access Token; the first manual sync since 2026-09-06
      succeeded on 2026-09-09 and backfilled the gap.
- [x] Restored the ingest key from the plaintext an app still held, so the hint is
      `••••5efa` again and no app needed updating.
- [ ] Delete the `ENCRYPTION_KEY` worker secret once the above is done.
- [ ] Re-run `scripts/backfill-affiliates.mjs` per app to refill merchant contact
      details missed while ingest was failing.

## Sync accuracy (found 2026-09-14, comparing admin vs Partner dashboard)

- [x] Query `RELATIONSHIP_DEACTIVATED` alongside install/uninstall/reactivate.
      A closed or frozen store never fires `RelationshipUninstalled`, so it stayed
      `installed` forever — 27 stale rows, Shootflo reading 27 active against
      Shopify's 18. `install_events.type` gains `deactivated`, `installs.status`
      gains `closed`, and the dashboard has its own Closed column.
- [x] Per-app relationship-event window (`apps.events_synced_at`). The 730-day
      first-run window was per account, so the six apps linked after 2026-09-05
      02:55 inherited a 24-hour window and never saw their history. One backfill
      per run keeps the Workers subrequest cap out of it.
- [x] Backfill-from-date action on Admin → Sync, per partner account.
- [x] Transaction watermark widened to a 14-day floor. Shopify publishes a
      transaction days after the `createdAt` it stamps on it, so a one-day overlap
      let AppOneTimeSale/788271547 (2026-09-07, $24.27 net) fall behind the
      watermark permanently.
- [x] Ignore `app-review-*.myshopify.com` and `redacted.myshopify.com` at
      `upsertMerchant`, so neither ingest nor sync can create them.
- [ ] Delete the 15 existing internal merchant rows (19 installs, 51 events).
      Nothing references them: 0 transactions, 0 referrals, 0 lifecycle emails.
- [ ] Backfill production once the fix is deployed, then re-check the eight
      install counts against the Partner dashboard.
- [ ] App names never refresh for apps with no transactions, so the admin still
      shows "Bee GST Invoice", "Bee Gifting", "Bee Migration" where Shopify has
      "Bee Invoices", "Bee secret gift", "Bee Migrate".

## Committed vs collected revenue

- [x] `app_charges` — one row per Shopify charge id, status folded forward from
      the Partner event trail. `transactions` only carries money Shopify has
      billed, and a subscription bills at the *end* of its 30-day cycle: the
      $200/month Elite Plan approved on 2026-09-12 has `billingOn` 2026-10-12
      and no transaction until then, which is why Shopify's own Earnings column
      reads $48.54 too.
- [x] Charge events ride the existing `app.events` query rather than a second
      request — same connection, one round trip, which matters against the
      Workers subrequest cap.
- [x] Test charges are dropped at sync rather than stored. 281 of the 330 charge
      events across the eight apps are a developer clicking through plans on a
      dev store.
- [x] MRR column on the dashboard, Charges card on app detail. Free tiers are
      recurring charges too, so the subscription count only includes paid ones,
      and a `billingOn` only renders while it is still in the future — Shopify
      stamps it at activation and never refreshes it.
- [ ] First sync after deploy should record committed MRR of $209: Shootflo
      $200 (t4m9kj-bx, Elite Plan, bills 2026-10-12) and RankFlo $9 (di4820-s0,
      Starter). Verify against the dashboard.

## Next

- [ ] Merchant detail page (timeline of install events, revenue, emails sent)
- [ ] Let staff export the app analytics they can see (CSV)
- [ ] Per-app staff notes / annotations on revenue dips
- [ ] Structured churn reasons instead of free-text, so they can be charted
- [ ] Affiliate marketing assets page (banners, copy blocks, UTM builder)
- [ ] Payout provider integration (PayPal / Wise) instead of manual "mark paid"
- [ ] Fraud checks: self-referral, duplicate shop domains, click stuffing
- [ ] More developer tooling beyond the affiliate program
