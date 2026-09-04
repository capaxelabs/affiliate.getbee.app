# Bee Affiliates

Affiliate program and developer tooling for the Bee family of Shopify apps.

- **Affiliates** get links per app, referral tracking, commissions, payouts and reports.
- **Admins** manage several apps, approve affiliates, review claims, and run payouts.

One login for both: an emailed 6-digit code. Role decides the destination.

## Setup

```bash
npm install
wrangler d1 create bee-affiliates      # paste the id into wrangler.jsonc
wrangler kv namespace create KV        # paste the id into wrangler.jsonc
npm run db:generate
npm run db:migrate:local
npm run dev
```

Then make yourself an admin:

```bash
wrangler d1 execute bee-affiliates --local \
  --command "update users set role = 'admin' where email = 'you@example.com'"
```

## Stack

SvelteKit 5 · shadcn-svelte · Tailwind v4 · Cloudflare Workers · D1 + Drizzle · KV

See [CLAUDE.md](CLAUDE.md) for architecture and the rules the code relies on.
