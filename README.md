# Bee Affiliates

Affiliate program and merchant analytics for a portfolio of Shopify apps, running
on Cloudflare Workers.

- **Affiliates** get a tracked link per app, referral and commission tracking,
  payouts and reports.
- **Admins** manage several apps across several Shopify Partner organizations:
  revenue per app, every merchant who installed, approvals, claims and payouts.
- **Staff** are read-only accounts scoped to specific apps, for someone who should
  see app analytics but not the whole program.

Everyone signs in the same way: a six-digit code emailed to them. The role on the
account decides where they land.

**Stack:** SvelteKit 5 · shadcn-svelte · Tailwind v4 · Cloudflare Workers ·
D1 + Drizzle ORM

---

## Deploy your own

### Prerequisites

- Node 20+
- A Cloudflare account (the free plan is enough to start)
- A domain on Cloudflare, if you want a custom hostname
- A Shopify Partner account and a Partner Access Token, to sync revenue

### 1. Clone and install

```bash
git clone https://github.com/capaxelabs/affiliate.getbee.app.git
cd affiliate.getbee.app
npm install
npx wrangler login
```

### 2. Make it yours

`wrangler.jsonc` is checked in with this deployment's values. Change every row
below before deploying, or you will be pushing at someone else's account:

| Key | Change it to |
| --- | --- |
| `name` | Your worker name — becomes `<name>.<your-subdomain>.workers.dev` |
| `account_id` | Your Cloudflare account id (Workers dashboard → right sidebar) |
| `d1_databases[0].database_id` | Filled in by step 3 |
| `d1_databases[0].database_name` | Any name you like; keep it in step 3 and the `db:migrate:*` scripts |
| `routes` | Your hostname, or delete the block to use the `workers.dev` URL |
| `vars.APP_URL` | The URL the app is served from. Affiliate links and every link in outgoing email are built from this — get it wrong and affiliates hand out broken links |
| `vars.APP_NAME` | Shown in the UI and email |
| `vars.EMAIL_API_URL` | Your email endpoint — see [Email](#email) |
| `vars.EMAIL_FROM` | The from address on outgoing email |

If you renamed the database, update `db:migrate:local` and `db:migrate:remote` in
`package.json` to match.

### 3. Create the database

```bash
npx wrangler d1 create bee-affiliates
```

Copy the printed `database_id` into `wrangler.jsonc`, then apply the schema:

```bash
npm run db:migrate:remote
```

### 4. Generate and set the secrets

```bash
openssl rand -base64 32   # value for ENCRYPTION_KEY
openssl rand -hex 32      # value for CRON_SECRET
```

Run each command below and paste the matching value when prompted:

```bash
npx wrangler secret put ENCRYPTION_KEY
npx wrangler secret put CRON_SECRET
npx wrangler secret put EMAIL_API_KEY
```

| Secret | What it does | Required? |
| --- | --- | --- |
| `ENCRYPTION_KEY` | Encrypts the Partner Access Tokens stored in D1 | Before you can connect a Partner account |
| `CRON_SECRET` | Signs install/uninstall calls from your apps and guards `/api/cron/sync` | Before ingest or scheduled sync work |
| `EMAIL_API_KEY` | Key for your email endpoint | Optional — without it, email is logged to the worker console instead of sent |

> **`ENCRYPTION_KEY` cannot be rotated casually.** Changing it makes every stored
> Partner Access Token undecryptable and they all have to be re-entered. Set it once
> and keep a copy somewhere safe.

### 5. Deploy

```bash
npm run deploy
```

A `routes` entry only takes effect on deploy, and the first deploy with a
`custom_domain` also provisions the hostname and certificate — allow a minute
before the hostname stops returning 404.

If you connect the repo to **Cloudflare Workers Builds**, every push to `main`
deploys on its own and you never run this by hand. See
[Shipping changes](#shipping-changes) for the one ordering rule that matters.

```bash
curl -o /dev/null -w '%{http_code}\n' https://your-domain.example/login   # expect 200
```

### 6. Create the first admin

Everyone who signs in becomes a pending affiliate, including you. Sign in once at
`/login`, then promote yourself:

```bash
npx wrangler d1 execute bee-affiliates --remote \
  --command "update users set role = 'admin' where email = 'you@example.com'"
```

Sign out and back in. You will land on `/admin`.

---

## Shipping changes

With Workers Builds connected, pushing to `main` deploys. **Migrations are not
part of that build** — only the worker is.

That makes the order matter whenever a change touches `schema.ts`:

```bash
npm run db:generate        # write the migration
npm run db:migrate:remote  # apply it to production FIRST
git push                   # then ship the code that depends on it
```

Push code that expects a new column before the migration has run and every
request touching that table 500s until you catch up. Adding a column is safe in
that order because the old code simply ignores it.

Check what production is actually running:

```bash
npx wrangler d1 migrations list bee-affiliates --remote
```

---

## Local development

```bash
cp .dev.vars.example .dev.vars   # fill in ENCRYPTION_KEY and CRON_SECRET
npm run db:migrate:local
npm run dev
```

`.dev.vars` is gitignored. Leave `EMAIL_API_KEY` empty and sign-in codes are
printed to the terminal instead of emailed, which is what you want locally.

Promote yourself against the local database:

```bash
npx wrangler d1 execute bee-affiliates --local \
  --command "update users set role = 'admin' where email = 'you@example.com'"
```

| Command | |
| --- | --- |
| `npm run dev` | Dev server with local D1 |
| `npm run check` | Type-check |
| `npm run db:generate` | Generate a migration after editing `schema.ts` |
| `npm run db:migrate:local` / `:remote` | Apply migrations |
| `npm run deploy` | Build and deploy |

---

## Connect a Shopify Partner account

In the admin: **Partner accounts → Connect account**.

- **Partner Id** — the number in your Partner dashboard URL,
  `partners.shopify.com/<id>`
- **Partner Access Token** — Partner dashboard → Settings → Partner API clients.
  It needs read access to app events and transactions.

The **API version** must be one Shopify currently serves — a retired or invented
version fails with a 404 and the misleading message "Invalid API version". Ask the
API which ones are live:

```bash
curl -s "https://partners.shopify.com/<partner-id>/api/unstable/graphql.json" \
  -H "X-Shopify-Access-Token: <token>" -H 'Content-Type: application/json' \
  -d '{"query":"{ publicApiVersions { handle supported } }"}'
```

Connecting an account discovers your apps automatically. Use **Sync apps from
Shopify** on the Apps page to pick up new ones; the hourly sync does it too.

> The Partner API has no field that lists an organization's apps, so discovery
> derives them from billing transactions — an app that has never billed anyone is
> invisible to it. Those apps register themselves the first time they post an
> install webhook (see below), so in practice you rarely add one by hand.

Add several accounts if your apps live under different organizations.

Tokens are encrypted before storage and never sent back to a browser — the UI
shows a masked hint and lets you replace them.

### Choosing which apps affiliates promote

Revenue, installs and merchants are tracked for **every** discovered app. The
affiliate program is opt-in per app: flip **Affiliate** to On in the Apps table
for the ones you want promoted. If you run ten apps and only want three in the
program, leave the other seven off.

An app needs an App Store listing URL before it can be switched on, since that is
where its affiliate links point. Turning an app off stops new referrals; referrals
already attributed to it keep earning.

---

## Wire up your apps

Revenue syncs from the Partner API on its own. **Attribution and merchant data do
not** — each app has to report installs. Until you do this, no merchant list, no
lifecycle email, and every referral has to go through a manual claim.

Both endpoints take a JSON body signed with HMAC-SHA256 (hex) over the exact raw
body, keyed with `CRON_SECRET`, in an `X-Bee-Signature` header.

```js
import { createHmac } from 'node:crypto';

async function report(path, payload) {
  const body = JSON.stringify(payload);
  await fetch(`https://your-domain.example${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-bee-signature': createHmac('sha256', process.env.CRON_SECRET).update(body).digest('hex')
    },
    body
  });
}

// In your OAuth callback. `ref` is the code you captured from the install
// request (the affiliate link adds it as ?ref=). Everything but app and
// shopDomain is optional, but without shop.email you cannot email the merchant.
await report('/api/track/install', {
  app: 'your-app-slug',
  shopDomain: 'acme.myshopify.com',
  ref: 'K7QP2M4X',
  shop: { name: 'Acme', email: 'owner@acme.com', ownerName: 'Ada Lovelace', country: 'US' }
});

// In your app/uninstalled webhook. Call again later with reason/feedback if the
// merchant replies to the offboarding email.
await report('/api/track/uninstall', {
  app: 'your-app-slug',
  shopDomain: 'acme.myshopify.com',
  reason: 'missing_feature',
  feedback: 'Needed volume tiers per variant'
});
```

`app` is the slug shown in the Apps table.

### Send the same fields every time

Have each app post the identity fields on **every** install. Then an app that is
not on the books yet adds itself, and one that is simply confirms what we know —
no per-app setup, no ordering to remember.

If the `partnerId` belongs to a Partner organization that is not connected yet, a
**placeholder account appears** under Partner accounts, paused and tokenless, so
you can see exactly which org needs a Partner Access Token. It is skipped by the
sync until you add one, so nothing breaks in the meantime.

Dropped into a SvelteKit Shopify app whose `StoreService` already fetches the
shop (as `shopify-app-bee-ai-seo` does), the reporter is:

```ts
// src/lib/server/affiliates.ts
import { createHmac } from 'node:crypto';

const BASE = 'https://affiliate.getbee.app';

// Identity of this app. The only per-app edit.
const APP = {
	app: 'bee-ai-seo',
	appName: 'Bee AI SEO',
	partnerId: '3975838',
	partnerAppId: 'gid://partners/App/…'
};

async function report(path: string, payload: Record<string, unknown>, secret: string) {
	const body = JSON.stringify({ ...APP, ...payload });
	try {
		await fetch(`${BASE}${path}`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'x-bee-signature': createHmac('sha256', secret).update(body).digest('hex')
			},
			body
		});
	} catch (error) {
		// Never let reporting fail an install or a webhook.
		console.error('affiliates report failed', error);
	}
}

/** Call from initializeStore, with the store row you just upserted. */
export function reportInstall(store: {
	shopDomain: string;
	shopName: string | null;
	shopOwnerEmail: string | null;
	shopOwnerName: string | null;
	shopPlan: string | null;
	shopCountry: string | null;
	shopCurrency: string | null;
	shopTimezone: string | null;
}, secret: string, ref?: string | null) {
	return report('/api/track/install', {
		shopDomain: store.shopDomain,
		ref: ref ?? null,
		shop: {
			name: store.shopName,
			email: store.shopOwnerEmail,
			ownerName: store.shopOwnerName,
			country: store.shopCountry,
			currency: store.shopCurrency,
			timezone: store.shopTimezone,
			plan: store.shopPlan
		}
	}, secret);
}

/** Call from the app/uninstalled webhook, beside markAsUninstalled. */
export function reportUninstall(shopDomain: string, secret: string) {
	return report('/api/track/uninstall', { shopDomain }, secret);
}
```

`shopOwnerEmail` is the field that matters most — it is the one thing the Partner
API cannot give you, and lifecycle email depends on it.

### Apps can register themselves

Include `appName` and an app we have never seen is created on the spot, so a new
app does not need adding by hand and starts collecting merchants from its very
first install:

```js
await report('/api/track/install', {
  app: 'rankflo',                              // becomes the slug
  appName: 'RankFlo',                          // required only to register
  partnerId: '3975838',                        // optional, links it to an account
  partnerAppId: 'gid://partners/App/292818255873', // optional, matches revenue sooner
  shopDomain,
  shop: { /* ... */ }
});
```

Registered apps arrive with **Affiliate off**, same as discovered ones. Without
`appName` an unknown slug is rejected, so a typo cannot litter the app list.

If the app later bills someone, the Partner sync **adopts** the existing record
by name rather than creating a duplicate, filling in the Partner app id it now
knows. Passing `partnerAppId` up front skips the guesswork.

### What comes from where

| | Partner API (automatic) | Your app posting here |
| --- | --- | --- |
| Which shop installed / uninstalled | yes | yes |
| When | yes | yes |
| Shop name | yes | yes |
| Churn reason | yes, Shopify's own picker | yes, plus free-text feedback |
| **Merchant email** | **no** | yes |
| Registering an app that has never billed anyone | no | yes |
| Owner name, phone, country, currency, timezone, plan | no | yes |
| Affiliate attribution (`ref`) | no | yes |

`Shop` on the Partner API exposes only `id`, `name`, `myshopifyDomain` and
`avatarUrl`. There is no email anywhere in it, so **lifecycle email and affiliate
attribution both depend on your app posting to `/api/track/install`.** Everything
else backfills on its own.

### Shopify app side

```js
// After OAuth, with an admin access token for the shop:
const shop = await fetch(
  `https://${shopDomain}/admin/api/2026-07/shop.json`,
  { headers: { 'X-Shopify-Access-Token': accessToken } }
).then((r) => r.json()).then((d) => d.shop);

await report('/api/track/install', {
  app: 'rankflo',
  shopDomain,
  ref: refFromInstallRequest,          // null if there wasn't one
  shop: {
    name: shop.name,
    email: shop.email,
    ownerName: shop.shop_owner,
    phone: shop.phone,
    primaryDomain: shop.domain,
    country: shop.country_code,
    currency: shop.currency,
    timezone: shop.iana_timezone,
    plan: shop.plan_name
  }
});
```

Register `app/uninstalled` and post to `/api/track/uninstall` from its handler.
Both endpoints are idempotent, so a retried webhook is safe.

---

## Scheduled sync

Two [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
in `wrangler.jsonc`:

| Schedule | Does |
| --- | --- |
| `0 3 * * *` | Full sync — discover apps, pull installs and transactions for every connected Partner account, clear matured commissions, send queued email |
| `0 * * * *` | Lifecycle email outbox only, so a welcome is not a day late |

`adapter-cloudflare` emits only a `fetch` handler and writes it to whatever
`main` points at, so a hand-written wrapper there gets overwritten every build.
`scripts/wrap-worker.mjs` runs after the adapter, moves its bundle to
`worker-core.js` and generates a `worker.js` that re-exports `fetch` and adds
`scheduled`. Both are build artifacts and gitignored. The bundle has to stay at
the repo root — the adapter emits imports relative to `main`.

The same endpoint works from any external scheduler:

```bash
curl -X POST https://your-domain.example/api/cron/sync \
  -H "Authorization: Bearer $CRON_SECRET"          # add ?task=lifecycle to skip the Partner API
```

---

## Email

Outgoing email posts multipart form data to `EMAIL_API_URL`:

```
POST $EMAIL_API_URL
x-api-key: $EMAIL_API_KEY

to, from, subject, html      (form fields)
```

The default points at a private service. Swap `EMAIL_API_URL` for anything that
matches that shape — a small Worker in front of Resend, Postmark, SES or
[Cloudflare Email Sending](https://developers.cloudflare.com/email-service/) is
about twenty lines. Or edit `sendEmail` in `src/lib/server/email.ts` to call your
provider's SDK directly; it is the single place any mail goes out.

---

## How attribution works

1. **Tracked link** — `/r/{refCode}/{appSlug}` records the click and forwards to
   the App Store listing with `?ref=`. Your app captures that on install and posts
   it to `/api/track/install`. This is the only automatic path.
2. **Claim** — an affiliate submits a shop domain and an admin approves it.
3. **Manual** — an admin attributes a shop directly.

Attribution is never guessed. Shopify install events carry no ref code, so a
time-window match would credit whoever clicked last rather than whoever actually
referred the merchant. First attribution wins, and the commission rate is locked
in at that moment so changing an app's rate never rewrites history.

See [CLAUDE.md](CLAUDE.md) for architecture, access control and the invariants the
code relies on.
