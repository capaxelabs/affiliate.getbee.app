# CLAUDE.md

Guidance for Claude Code working in this repository.

## Project

Bee Affiliates — the affiliate program and developer tooling behind the Bee family of
Shopify apps. Partners get a portal with links, referrals, commissions and payouts;
staff get an admin that manages several apps at once.

Three roles, one login. Everyone signs in with an emailed 6-digit code at `/login`.
`users.role` decides where they land:

- `affiliate` → `/app`. Created automatically on first sign-in, `pending` until approved.
- `staff` → `/admin`, **read-only**, limited to granted apps. `users.viewAffiliateData`
  decides whether they see the affiliate program at all; off means partner/app
  analytics only.
- `admin` → `/admin`, everything, the only role that can write.

## Commands

```bash
npm run dev              # vite dev (needs wrangler bindings — see below)
npm run build            # production build
npm run check            # svelte-check
npm run db:generate      # generate a Drizzle migration from schema.ts
npm run db:migrate:local # apply migrations to local D1
npm run db:migrate:remote
npm run deploy           # build + wrangler deploy
```

`vite dev` gets its D1/KV bindings through adapter-cloudflare's platform proxy, which
reads `wrangler.jsonc`. The D1 and KV ids are placeholders until you create them:

```bash
wrangler d1 create bee-affiliates
wrangler kv namespace create KV
```

## Stack

SvelteKit 5 (runes) · shadcn-svelte · Tailwind v4 · Cloudflare Workers ·
D1 + Drizzle ORM · KV.

## Layout

```
src/lib/server/
  auth.ts              magic-code login, sessions
  scope.ts             admin/staff access resolution and app scoping
  crypto.ts            AES-GCM for Partner Access Tokens stored in D1
  email.ts             transactional email via tools.capaxe.com/email
  guards.ts            requireUser / requireAdmin / requireAffiliate
  db/schema.ts         every table
  services/
    commission.ts      rate resolution, commission lines, hold window
    referral.ts        shop normalisation, attribution
    merchant.ts        merchant upsert, install/uninstall lifecycle
    lifecycle.ts       welcome / offboarding email outbox
    partner-api.ts     Shopify Partner API GraphQL client
    sync.ts            transaction + install sync, matcher
    stats.ts           dashboard, revenue and report queries
src/routes/
  login, logout        the only auth surface
  r/[code]/[app]       affiliate link → click record → App Store listing
  api/track/install    HMAC-signed install ingest from each Bee app
  api/track/uninstall  HMAC-signed uninstall + churn feedback ingest
  api/cron/sync        bearer-guarded Partner API sync + lifecycle outbox
  app/                 affiliate portal
  admin/               staff console (see access rules below)
```

## Rules that matter here

- **Money is integer cents. Rates are basis points** (2000 = 20%). Never store floats.
- **Attribution is never guessed.** A referral is created only from an explicit ref
  code (install ingest), an approved claim, or an admin acting deliberately. The
  Partner sync creates commissions for shops that are *already* attributed; it never
  invents an attribution.
- **First attribution wins.** `referrals` has a unique index on `(app_id, shop_domain)`.
- **`referrals.commissionBps` is locked at attribution time** so changing an app's
  default rate never rewrites history.
- **Commissions hold for `HOLD_DAYS`** before they can be paid, so refunds can claw back.
- Partner transaction ids are unique on `commissions`, which makes the sync idempotent.
- Every admin action that moves money or status writes to `audit_log`.
- **`transactions` is the source of truth for app revenue**, not `commissions`.
  Every Partner transaction lands there whether or not an affiliate referred the
  shop; commissions are derived from it. Dashboard revenue reads `transactions`.
- **`merchants` is every shop, referred or not.** `installs` is one row per
  (app, merchant) and survives uninstall so churn stays visible.
- Lifecycle email is an **outbox**, not a direct send. Queue on install/uninstall,
  drain on cron. The toggle and the install state are re-checked at send time, so
  a merchant who uninstalls before the welcome goes out never receives it.

## Access control

`src/lib/server/scope.ts` is the single place that answers "what may this person
see". `requireAdminAccess` returns an `AdminScope`; `appIds === null` means a full
admin, otherwise it is the explicit list of apps a staff member was granted.

- `requireOwner` — full admins only. Payouts, partner accounts, team, and **every
  write action** live behind it.
- `requireAffiliateVisibility` — the affiliate-program pages, which staff reach
  only when `viewAffiliateData` is on.
- `appScopeFilter(scope, column)` — the `where` fragment to add to any query with
  an app column. A staff member with no grants gets `1 = 0`, so an unscoped person
  sees nothing rather than everything.

**Staff are read-only, enforced in `hooks.server.ts`**: any non-GET request to
`/admin/*` from a staff session is rejected before it reaches a form action. Hiding
buttons in the UI is a convenience on top of that, never the guard itself.

Grants live in `admin_scopes`: a row names either one app, or a partner account
(covering every app under it, including ones added later).

## Apps and affiliate opt-in

Apps are **discovered from the Partner API**, not entered by hand — connecting an
account, hitting "Sync apps from Shopify", or the hourly cron all call `syncApps`.
Discovery only ever writes `name`, `partnerAppId` and `partnerAccountId`; the
fields an admin owns (`slug`, `listingUrl`, commission, `affiliateEnabled`) are
never overwritten.

`apps.affiliateEnabled` decides participation in the affiliate program, and it is
off for a discovered app. Analytics — revenue, installs, merchants — cover every
app regardless. Anything affiliate-facing must filter on it: the affiliate home,
the claim dialog, `/r/{code}/{app}`, admin manual attribution, and
`attributeReferral`, which refuses a non-participating app outright.

Switching an app on requires a `listingUrl`. Switching it off stops new referrals
but leaves existing ones earning.

## Partner accounts

Several Shopify Partner organizations can be connected at once. `partner_accounts`
holds the Partner Id and an AES-GCM encrypted Partner Access Token;
`apps.partnerAccountId` says
which org an app lives under, and the sync runs once per account with that
account's own credentials. Tokens are never sent to a browser — the UI shows only
a masked hint and lets you replace them.

`ENCRYPTION_KEY` must be set before tokens can be stored or read. Changing it makes
every stored token undecryptable, so they would all need re-entering.

## Attribution paths

1. **Tracked link** — `/r/{refCode}/{appSlug}` records a click and forwards to the
   listing with `?ref=`. The Bee app captures that on install and posts it to
   `/api/track/install`, signed with `CRON_SECRET`. This is the only automatic path.
2. **Claim** — the affiliate submits a shop domain, an admin approves it.
3. **Manual** — an admin attributes a shop directly from `/admin/referrals`.

## Merchant lifecycle

Each Bee app posts to `/api/track/install` and `/api/track/uninstall`, both signed
with `CRON_SECRET`. Install carries an optional `shop` object (name, email, owner,
country, currency, plan) — without an email we can record the merchant but cannot
mail them.

Welcome and offboarding email are **off per app** until switched on in
`/admin/apps`. Both are queued into `lifecycle_emails` with a delay (welcome +15m,
offboarding +1h) and sent when the cron endpoint drains the outbox.

## Scheduling

adapter-cloudflare exports only a `fetch` handler, so there is no `scheduled()` hook and
no cron trigger in `wrangler.jsonc`. Point any scheduler at:

```
POST /api/cron/sync   Authorization: Bearer $CRON_SECRET
```

## Secrets

`wrangler secret put NAME` for: `EMAIL_API_KEY`, `CRON_SECRET`, `ENCRYPTION_KEY`.

Without `EMAIL_API_KEY` the mailer logs codes to the console instead of sending, which
is what you want locally.

`PARTNER_ORG_ID` / `PARTNER_API_TOKEN` are legacy single-account vars. The partner
accounts page offers a one-click import while they are still set; after importing,
delete them.
