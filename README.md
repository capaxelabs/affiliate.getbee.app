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

> The Partner API has no field that lists an organization's apps, so apps are
> derived from billing transactions. **An app with no transactions yet cannot be
> discovered** — add those with **Add manually**, giving the app's
> `gid://partners/App/...` id so the sync can match it later.

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

`app` is the slug you gave the app in the admin.

---

## Scheduled sync

`adapter-cloudflare` only exports a fetch handler, so there is no `scheduled()`
hook and no cron trigger in `wrangler.jsonc`. Point any scheduler at:

```bash
curl -X POST https://your-domain.example/api/cron/sync \
  -H "Authorization: Bearer $CRON_SECRET"
```

Hourly is a sensible default. Each run pulls installs and transactions for every
connected Partner account, clears commissions past their hold window, and sends
any queued lifecycle email. GitHub Actions, cron-job.org, or a small companion
Worker with a cron trigger all work.

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
