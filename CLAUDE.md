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

Apps are resolved by `apiKey` → `partnerAppId` → `slug`, most stable first.
`apps.apiKey` is the OAuth client id: the app knows it as `SHOPIFY_API_KEY` and
Shopify returns the same value as `App.apiKey`, so both sides join on it without
configuration. Matching on slug first would register a duplicate the moment an
App Store handle or our slug is renamed — do not reorder these. Empty identifier
strings are normalised to NULL, or two of them collide on the unique indexes.

Apps also register themselves: `/api/track/install` with an `appName` creates the
record via `findOrRegisterApp`. That covers apps with no billing history, which
discovery cannot see. Such a row has no `partnerAppId`, so `syncApps` first tries
`findAdoptableApp` — a name match with a null Partner app id — and adopts it
rather than inserting a duplicate. Do not remove that step.

**The Partner API cannot list an organization's apps.** `QueryRoot` exposes only
`app(id:)`, `transactions`, `events`, `transaction` and `activeSubscription`, and
the org-wide `Relationship` event carries no app reference. `discoverApps`
therefore pages `transactions` and collects the distinct `app { id name }` it
finds, which means an app with no transactions is invisible and has to be added
manually. Do not "fix" this by reaching for an `apps` query — it does not exist.

Partner API versions are dated and retire. An invalid one 404s with "Invalid API
version". `publicApiVersions` on the `unstable` endpoint lists what is live.

`apps.affiliateEnabled` decides participation in the affiliate program, and it is
off for a discovered app. Analytics — revenue, installs, merchants — cover every
app regardless. Anything affiliate-facing must filter on it: the affiliate home,
the claim dialog, `/r/{code}/{app}`, admin manual attribution, and
`attributeReferral`, which refuses a non-participating app outright.

Switching an app on requires a `listingUrl`. Switching it off stops new referrals
but leaves existing ones earning.

## Partner accounts

Several Shopify Partner organizations can be connected at once. `partner_accounts`
holds the Partner Id and the Partner Access Token; `apps.partnerAccountId` says
which org an app lives under, and the sync runs once per account with that
account's own credentials. Tokens are never sent to a browser — the UI shows only
a masked hint and lets you replace them.

**Stored credentials are plaintext.** They were AES-GCM encrypted under an
`ENCRYPTION_KEY` worker secret until that key was lost, which orphaned every
stored secret at once and killed the sync for three days. The key lived in the
same Cloudflare account as the database, so it protected only against a dump
leaking on its own, and on a single-operator install that was not worth the
failure mode. Treat any D1 export as credential material.

## Attribution paths

1. **Tracked link** — `/r/{refCode}/{appSlug}` records a click and forwards to the
   listing with `?ref=`. The Bee app captures that on install and posts it to
   `/api/track/install`, signed with the ingest key. This is the only automatic path.
2. **Claim** — the affiliate submits a shop domain, an admin approves it.
3. **Manual** — an admin attributes a shop directly from `/admin/referrals`.

## Workers limits shape the sync

Two caps bite here and neither shows up locally, where D1 is a file rather than a
service:

- **Subrequests per request.** Every D1 call counts. The original loop cost about
  eight per lifecycle event, so a two-year backfill was killed mid-run at roughly
  a hundred events. `syncInstalls` therefore groups events by shop and calls
  `recordLifecycleHistory` once per shop — cost scales with shops, not events.
- **100 bound parameters per D1 query.** An eight-column row binds eight, so a
  shop that has cycled dozens of times overflows a single multi-row insert. Events
  are inserted in chunks of ten.

A request that is cut off leaves its `partner_sync_runs` row on `running`
forever, which showed in the admin as a spinner that never resolved.
`failStaleRuns` closes anything older than fifteen minutes and runs at the start
of every full sync.

Keep per-record work out of per-event loops here.

## Two writers, one truth

Installs and uninstalls arrive from the Partner API **and** from each app's
webhook, in no guaranteed order, and the Partner sync deliberately re-reads an
overlapping window. Mutating the install row on arrival made the outcome depend
on who got there first — replaying a history the webhook had summarised inflated
`installCount`, and a re-read uninstall appended an event on every run.

So `install_events` is the truth and `installs` is a projection of it:

- `applyLifecycleEvent` inserts with `onConflictDoNothing` on
  `(install_id, type, occurred_at)`, then `rebuildInstallState` derives status,
  timestamps and `installCount` from the whole trail.
- A reinstall is an `installed` after an `uninstalled`. There is deliberately no
  `reinstalled` type: two types for one moment defeated the dedup key.
- Uninstall reason precedence is explicit — a reason from `ingest` overwrites,
  one from `partner_api` only fills a blank. Your own exit survey beats
  Shopify's dropdown.

Never go back to mutating the install row directly from a webhook handler.

## Merchant lifecycle

Each Bee app posts to `/api/track/install` and `/api/track/uninstall`, both signed
with the ingest key. Install carries an optional `shop` object (name, email, owner,
country, currency, plan) — without an email we can record the merchant but cannot
mail them.

Welcome and offboarding email are **off per app** until switched on in
`/admin/apps`. Both are queued into `lifecycle_emails` with a delay (welcome +15m,
offboarding +1h) and sent when the cron endpoint drains the outbox.

## Shipping

Cloudflare Workers Builds deploys every push to `main`. Migrations are **not**
part of that build, so anything touching `schema.ts` must be applied to
production before the code that needs it is pushed:

```bash
npm run db:generate && npm run db:migrate:remote && git push
```

**Read what drizzle-kit generates before trusting it.** Two of its migrations for
this repo were wrong:

- `0003` copied columns from the old table that did not exist there yet, and
  would have failed on any database with rows in it.
- `0005` rebuilt `partner_accounts` just to change a column default. D1 does not
  honour `PRAGMA foreign_keys=OFF` across statements, so dropping a table other
  tables reference fails with "FOREIGN KEY constraint failed" (code 7500).

SQLite cannot alter a column in place, so drizzle reaches for a table rebuild for
things as small as a default change. On D1, a rebuild of a referenced table will
not apply. Prefer a hand-written `UPDATE`, and test any rebuild against a scratch
sqlite3 database seeded with production-shaped rows first.

Never hand someone a "run npm run deploy" instruction for this repo — pushing is
the deploy.

## Scheduling

Cron Triggers run `0 3 * * *` (full sync) and `0 * * * *` (lifecycle email only).

adapter-cloudflare emits only `fetch`, and its `index.js` sets
`worker_dest = wrangler_config.main` — it writes its bundle **to** `main`, so a
wrapper committed there is destroyed on every build. `scripts/wrap-worker.mjs`
therefore runs after it, renaming the bundle to `worker-core.js` and generating
`worker.js` with a `scheduled` handler. Keep the bundle at the repo root: its
imports are relative to `main`, so moving it into a subdirectory breaks the
build. Both files are gitignored build artifacts — edit the generator, not them.

The endpoint is also reachable directly:

```
POST /api/cron/sync[?task=lifecycle]   Authorization: Bearer $INGEST_KEY
```


## Secrets

`wrangler secret put NAME` for: `EMAIL_API_KEY`, `CRON_SECRET`.

**The ingest key is deliberately not a worker secret.** One key signs every app's
webhooks and authorises the cron endpoint, and it lives in `settings`
so the admin can read it back — `wrangler secret put` is write-only, and nobody
recovers a secret a week later to configure a new app. `src/lib/server/services/ingest-key.ts`
owns it; `CRON_SECRET` stays as a fallback so anything set up before it keeps working.

Without `EMAIL_API_KEY` the mailer logs codes to the console instead of sending, which
is what you want locally.

`PARTNER_ORG_ID` / `PARTNER_API_TOKEN` are legacy single-account vars. The partner
accounts page offers a one-click import while they are still set; after importing,
delete them.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **affiliate.getbee.app** (1053 symbols, 2144 relationships, 69 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/affiliate.getbee.app/context` | Codebase overview, check index freshness |
| `gitnexus://repo/affiliate.getbee.app/clusters` | All functional areas |
| `gitnexus://repo/affiliate.getbee.app/processes` | All execution flows |
| `gitnexus://repo/affiliate.getbee.app/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
