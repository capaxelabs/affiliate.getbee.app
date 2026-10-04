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

## Merchant lifecycle email (moved to Raechly, 2026-09-29)

Removed from this app: outbox, templates, per-app toggles, reply-to column, hourly
cron. Migration `0014` drops them. Journeys in Raechly send these now.

- [ ] Run the one-time import before applying `0014` remotely (it reads
      `apps.support_email`): `node scripts/migrate-bee-merchants.mjs` in the
      raechly.com repo, dry run first.
- [ ] `npm run db:migrate:remote`, then `npm run deploy`.
- [ ] Decide how install and uninstall events reach Raechly from now on: each Bee
      app posts to Raechly directly, or this app forwards them.

History of the removed feature:

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
- [x] On `shop/update`, POST to `/api/track/shop` so a transferred store picks
      up its new owner's email. Done in Bee Subscriptions; the other apps still
      need the webhook subscription and the call.
- [ ] POST again later with `reason` / `feedback` when a merchant replies to the
      offboarding survey — nothing sends that survey yet, see below.

## Ingest key

- [x] One key for every app and every track endpoint, stored encrypted in
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
- [x] App names in the Overview's Revenue by app table link to the app detail page

## Blocking real use

- [x] Ingest key generated in Admin → Apps and set as `AFFILIATES_SECRET` in each
      Bee app
- [x] Affiliate turned on for RankFlo and Shootflo Studio
- [x] Reporter live in all 8 apps — 124 install records, 116 with a contactable
      merchant
- [x] ~~Turn welcome / offboarding email on per app~~ Moved to Raechly journeys;
      no merchant was ever mailed from here.
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
- [x] "Backfill all" on Admin → Sync: one click re-reads every app's full
      install and charge history. One app per request, so the Workers
      subrequest budget always belongs to a single app however deep its
      history; the form resubmits itself until the server reports nothing
      left. (Replaced the date field — a locale-dependent date input
      silently refused to submit.)
- [x] Transaction watermark widened to a 14-day floor. Shopify publishes a
      transaction days after the `createdAt` it stamps on it, so a one-day overlap
      let AppOneTimeSale/788271547 (2026-09-07, $24.27 net) fall behind the
      watermark permanently.
- [x] Ignore `app-review-*.myshopify.com` and `redacted.myshopify.com` at
      `upsertMerchant`, so neither ingest nor sync can create them.
- [x] `internal_shops` remembers every shop that must never become a merchant.
      A pattern alone cannot work: the Partner API reports a shop as a domain
      and a name and never an email, so a reviewer using an ordinary-looking
      domain (`zddnse-by`, `dphutk-fs`, `uvszh1-m5`, `g8db1y-pk`, `5zfdxw-r8`,
      `92yeg1-ts`) is only identifiable from the `@shopify.com` address on the
      app's own install webhook. Remembering the domain there means the nightly
      Partner sync recognises it too. Shopify re-reviews on every submission,
      so the list grows by itself.
- [x] Manual backfill is bounded at two apps per request and reports what is
      left. Running all eight at the full window in one request got the Worker
      killed three apps in, stranding the run row on `running`.
- [ ] Click "Backfill all" once for Bee Apps: six apps pending (RankFlo and
      Shootflo re-queued so the charges lane sees their history — the first
      backfill ran code that read only relationship events). Then verify the
      eight install counts and MRR $209 against the Partner dashboard.
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
- [x] MRR stat card on the overview top row, MRR column in the per-app table,
      Charges card on app detail. Free tiers are
      recurring charges too, so the subscription count only includes paid ones,
      and a `billingOn` only renders while it is still in the future — Shopify
      stamps it at activation and never refreshes it.
- [ ] First sync after deploy should record committed MRR of $209: Shootflo
      $200 (t4m9kj-bx, Elite Plan, bills 2026-10-12) and RankFlo $9 (di4820-s0,
      Starter). Verify against the dashboard.

## History import

- [x] Per-app CSV import on the app detail page for the Partner dashboard's
      app-history export. The API sync reaches back two years; the export
      carries the app's whole life, so a ten-year-old app backfills from a
      file. Charge ids and timestamps in the CSV are identical to the API's,
      so both sources dedupe against each other. The export also carries the
      shop email — the only signal that identifies a Shopify reviewer store —
      so imports feed `internal_shops` too. Applied 50 shops per request; the
      page re-sends the file with a growing offset until done.

## Subscription analytics (2026-10-02, ideas from PartnerDex)

- [x] Fix MRR: annual plans count 1/12, trials count nothing until the first
      bill is due, frozen charges count nothing. Transactions now store the
      Partner charge id and billing interval.
- [x] `charge_events` raw trail; `app_charges` derived columns (interval,
      monthly amount, paid_at, trial status, churn reason, replaced charge)
- [x] Plan changes (cancel + activation within 60s) are upgrades or downgrades,
      not churn; a plan change inside a trial continues the same trial
- [x] `subscription_events` ledger with signed MRR deltas, rebuilt per shop on
      every sync, CSV import and uninstall webhook
- [x] Admin → Subscriptions: MRR, ARR, ARPU, LTV, revenue / subscription /
      install churn, trial conversion, 12-month MRR chart and movement table
- [x] App page: MRR chart, install funnel, trial and churn detail on charges
- [x] Slack alerts (Admin → Integrations): subscriptions, trials, reviews,
      affiliate sign-ups / claims / referrals, sync failures. Deduped per fact.
- [x] App Store reviews (Admin → Reviews): daily sweep, removed reviews kept,
      matched to merchants by store name, manual linking
- [x] GA4 BigQuery listing traffic feeds the funnel's first two steps
- [x] Data checks on Partner sync: ledger MRR vs charge MRR, sales with no
      charge, charges with no history; "Rebuild subscriptions" button
- [x] Sidebar no longer highlights Overview on every admin page
- [ ] Apply `0015` remotely before pushing: `npm run db:migrate:remote`
- [ ] After the first cron (or "Rebuild subscriptions"), check Data checks shows
      no gaps and MRR matches the Partner dashboard
- [ ] Click "Backfill all" so older charges get their exact event trail
      (the migration seeds an approximate one from the current rows)
- [ ] Add a Slack incoming webhook on Admin → Integrations
- [ ] Add App Store listing URLs for apps that have none (Bee AI SEO) so their
      reviews are read
- [ ] GA4: put a measurement ID on each listing, link GA4 to BigQuery (daily),
      then add the service account and each app's dataset on Integrations
- [x] Partner API: usage charges, credits (`AppSaleCredit` + `CREDIT_APPLIED`),
      capped-amount alerts
- [x] Admin → Insights: revenue by type, weekly cash, billing due in 30 days,
      MRR by plan, time to first payment and to cancel, install and revenue
      retention cohorts, breakdowns by country / Shopify plan / currency,
      uninstall reasons, traffic sources, search terms, keyword ranks,
      competitors, active shops, activation, at-risk shops
- [x] App Store keyword ranks and competitor ratings, daily
- [x] GA4: traffic sources and search terms, shared-property support, two-month
      refresh to keep BigQuery inside its free tier
- [x] `/api/track/event` ingest, activation event per app, Activated funnel step
- [ ] Add `trackUsage` (snippet on Integrations) to each Bee app and set
      `AFFILIATES_APP_SLUG`; pick each app's activation event
- [ ] Add search terms and competitors on Integrations
- [ ] Affiliate-facing funnel per referral link: clicks → installs → trial → paid

## Admin redesign (shadcn-svelte dashboard-01)

- [x] Inset sidebar with grouped navigation (main, Customers, Affiliate program,
      settings pinned to the bottom) and the account menu in the footer
- [x] Site header with sidebar toggle, page name and a read-only badge for staff
- [x] Stat cards in the dashboard-01 style with trend badges; overview shows MRR,
      revenue, live installs and merchants with month-on-month change
- [x] Interactive installs vs uninstalls area chart (3 months / 30 days / 7 days)
- [ ] Move the affiliate portal (`/app`) onto the same shell
- [ ] dashboard-01's drag-to-reorder data table was left out; adopt it if a
      table needs column toggles or row selection

## Abuse signals

- [ ] Three Shootflo shops share the disposable-mail domain `emailinbo.live`
      with 10-hex-character random local parts, all named "My Store", all
      Germany, all Regular plan, installed 2026-08-08 / 08-10 / 08-17, all still
      installed with zero transactions: `tfs0m1-rp`, `1ptb0y-xt`, `0qpkh0-by`.
      A fourth, `g122ss-j1`, uses `difav40942@afterdo.com`. Shootflo sells
      credit packs, so fresh stores on the free tier are worth something.
      `internal_shops` is the mechanism if these should stop counting.

## Next

- [x] Daily-installs line chart on the admin overview: one series per app,
      last 30 days, zero-filled so quiet days touch the baseline. Legend
      carries each app's 30-day total.
- [x] Live-installs chart under the daily one, sharing its legend: how many
      installs each app still has, walked back from today's `status = 'installed'`
      count so the last point always matches the tables. No cross-app total line
      on either chart — a sum of installs-ever was the wrong number and it
      flattened every app against it.

- [ ] Merchant detail page (timeline of install events, revenue, emails sent)
- [ ] Let staff export the app analytics they can see (CSV)
- [ ] Per-app staff notes / annotations on revenue dips
- [ ] Structured churn reasons instead of free-text, so they can be charted
- [ ] Affiliate marketing assets page (banners, copy blocks, UTM builder)
- [ ] Payout provider integration (PayPal / Wise) instead of manual "mark paid"
- [ ] Fraud checks: self-referral, duplicate shop domains, click stuffing
- [ ] More developer tooling beyond the affiliate program
