# Bee Affiliates

Affiliate program and developer tooling for the Bee family of Shopify apps.

- **Affiliates** get links per app, referral tracking, commissions, payouts and reports.
- **Admins** manage several apps, approve affiliates, review claims, and run payouts.

One login for both: an emailed 6-digit code. Role decides the destination.

## Setup

```bash
npm install
npx wrangler login                     # once per machine
npx wrangler d1 create bee-affiliates  # paste database_id into wrangler.jsonc
```

### Local

```bash
cp .dev.vars.example .dev.vars         # fill in ENCRYPTION_KEY and CRON_SECRET
npm run db:migrate:local
npm run dev
```

Sign in at http://localhost:5173/login — with no `EMAIL_API_KEY` the six-digit
code is printed to the terminal. Then make yourself a full admin:

```bash
npx wrangler d1 execute bee-affiliates --local \
  --command "update users set role = 'admin' where email = 'you@example.com'"
```

### Production

```bash
npm run db:migrate:remote

# generate strong values, then paste each when prompted
openssl rand -base64 32                # use for ENCRYPTION_KEY
openssl rand -hex 32                   # use for CRON_SECRET

npx wrangler secret put ENCRYPTION_KEY # required before connecting a Partner account
npx wrangler secret put CRON_SECRET    # signs app ingest + guards /api/cron/sync
npx wrangler secret put EMAIL_API_KEY  # tools.capaxe.com/email key

npm run deploy
```

Then promote yourself on the deployed database:

```bash
npx wrangler d1 execute bee-affiliates --remote \
  --command "update users set role = 'admin' where email = 'you@example.com'"
```

`ENCRYPTION_KEY` encrypts the Shopify Partner API tokens stored in D1. **Changing
it makes every stored token undecryptable** and they all have to be re-entered, so
set it once and keep it safe.

## Stack

SvelteKit 5 · shadcn-svelte · Tailwind v4 · Cloudflare Workers · D1 + Drizzle · KV

See [CLAUDE.md](CLAUDE.md) for architecture and the rules the code relies on.
