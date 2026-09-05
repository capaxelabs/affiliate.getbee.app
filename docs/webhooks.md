# App webhooks

How each Shopify app reports to Bee Affiliates.

The Shopify Partner API supplies revenue, and install history for apps that have
billed someone. It cannot supply merchant email addresses, affiliate attribution,
or any app that has never had a paid customer. Those come from your apps posting
to the two endpoints below.

Base URL: `https://affiliates.getbee.app`

---

## Signing

Every request is signed with HMAC-SHA256 over the **exact raw body**, hex
encoded, in an `X-Bee-Signature` header. The key is the `CRON_SECRET` worker
secret — the same value on both sides.

Sign the string you actually send. Re-serialising the object before hashing will
produce a different signature and a `401`.

```js
import { createHmac } from 'node:crypto';

const body = JSON.stringify(payload);           // serialise once
const signature = createHmac('sha256', process.env.CRON_SECRET)
	.update(body)
	.digest('hex');
```

---

## POST /api/track/install

Call after OAuth completes, once you have an admin token for the shop.

### Fields

| Field | Required | Notes |
| --- | --- | --- |
| `app` | yes | Your app's handle. Becomes the slug on first registration and appears in affiliate links |
| `shopDomain` | yes | `acme.myshopify.com`. A full URL or mixed case is accepted and normalised |
| `appName` | to register | Display name. **Required the first time an app reports**, otherwise an unknown handle is rejected so a typo cannot create a junk record |
| `apiKey` | recommended | Your `SHOPIFY_API_KEY`. The most stable identifier — handles and slugs can be renamed, this cannot |
| `partnerId` | recommended | Shopify Partner organization id, the number in your Partner dashboard URL. Links the app to the right account |
| `partnerAppId` | optional | `gid://partners/App/…`. Lets revenue match immediately instead of waiting to be matched by name |
| `listingUrl` | optional | App Store URL. Fetched automatically from the handle if omitted |
| `ref` | optional | The affiliate code captured from the install request. **Without it there is no automatic attribution** |
| `installedAt` | optional | ISO 8601. Defaults to now |
| `plan` | optional | Your own plan name for this shop |
| `shop` | optional | Merchant profile, below. Everything optional, but `email` is the one thing the Partner API cannot give you |

`shop`: `name`, `email`, `ownerName`, `phone`, `primaryDomain`, `country`,
`currency`, `timezone`, `plan`.

### curl

```bash
BODY='{
  "app": "rankflo",
  "appName": "RankFlo",
  "apiKey": "a40fc46ea77b7ea8b077203b53272f30",
  "partnerId": "3975838",
  "shopDomain": "acme.myshopify.com",
  "ref": "K7QP2M4X",
  "shop": {
    "name": "Acme Supply",
    "email": "owner@acme.com",
    "ownerName": "Ada Lovelace",
    "country": "US",
    "currency": "USD",
    "timezone": "America/New_York",
    "plan": "Shopify Plus"
  }
}'

curl -sS -X POST https://affiliates.getbee.app/api/track/install \
  -H 'content-type: application/json' \
  -H "x-bee-signature: $(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$CRON_SECRET" -hex | sed 's/.*= //')" \
  -d "$BODY"
```

### Response

```json
{
  "appRegistered": false,
  "appId": "app_…",
  "appSlug": "rankflo",
  "recorded": true,
  "merchantId": "mer_…",
  "installId": "ins_…",
  "reinstall": false,
  "attributed": true,
  "referralId": "ref_…"
}
```

`attributed` is `false` with a `reason` when no referral was created:

| reason | Meaning |
| --- | --- |
| `no_ref` | No `ref` was sent. Normal for organic installs |
| `unknown_ref` | The code does not match an approved affiliate |
| `conflict` | The shop already belongs to a different affiliate for this app |

---

## POST /api/track/uninstall

Call from your `app/uninstalled` webhook handler.

| Field | Required | Notes |
| --- | --- | --- |
| `app` | yes | Same handle as the install |
| `shopDomain` | yes | |
| `uninstalledAt` | optional | ISO 8601. Defaults to now |
| `reason` | optional | Your own churn reason. **Takes precedence over Shopify's**, whichever arrives first |
| `feedback` | optional | Free text, up to 4000 characters |

```bash
BODY='{
  "app": "rankflo",
  "shopDomain": "acme.myshopify.com",
  "reason": "missing_feature",
  "feedback": "Needed per-variant boosting"
}'

curl -sS -X POST https://affiliates.getbee.app/api/track/uninstall \
  -H 'content-type: application/json' \
  -H "x-bee-signature: $(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$CRON_SECRET" -hex | sed 's/.*= //')" \
  -d "$BODY"
```

```json
{ "recorded": true, "installId": "ins_…", "merchantId": "mer_…", "alreadyUninstalled": false }
```

`{ "recorded": false, "reason": "no_install_on_record" }` means the shop was
never reported as installed. It is a `200`, not an error — nothing to retry.

Calling it again later with `reason` / `feedback` is supported and is how you
record a survey answer that arrives after the uninstall.

---

## Apps with no paid customers

App discovery reads the Partner API's billing transactions, because there is no
field that lists an organization's apps. **An app that has never charged anyone is
invisible to it.**

Posting an install webhook with `appName` is enough to fix that — the app
registers itself on its first install, and appears in the admin immediately with
its icon and App Store listing.

Send `apiKey` and `partnerId` alongside it and the record is complete: linked to
the right Partner account, and resolvable even if you later rename the handle.
When the app does eventually bill someone, the Partner sync recognises it and
fills in the Partner app id rather than creating a second record.

Registered apps arrive with **Affiliate off**. Turn it on per app in the admin.

---

## Backfilling history

Your app has probably been recording installs, uninstalls and merchant emails
since long before this service existed. Replaying that history is worth doing:
it is the only way the merchants already known from the Partner API gain a
contact address.

Post each old record to the same endpoints, using the stored dates:

```js
await report('/api/track/install', {
  shopDomain: store.shopDomain,
  installedAt: new Date(store.installedAt).toISOString(),  // must be ISO 8601
  shop: { email: store.shopOwnerEmail /* … */ }
});

if (!store.isActive) {
  await report('/api/track/uninstall', {
    shopDomain: store.shopDomain,
    uninstalledAt: new Date(store.uninstalledAt).toISOString()
  });
}
```

Three things to know:

- **Run it from a machine, not from a Worker.** One request per store will exceed
  a Worker's subrequest cap on any real catalogue.
- **Timestamps must be ISO 8601.** SQLite's `datetime()` produces
  `2026-03-23 11:57:02`, which is rejected. Convert first.
- **Overlapping with Partner API history is safe.** Shopify timestamps an install
  when it happened; your app timestamps it when OAuth finished, seconds later. An
  install or uninstall within ten minutes of one already recorded is treated as
  the same event, so the count is not doubled — while a genuine reinstall months
  later still counts.

Safe to run more than once.

## Guarantees

**Idempotent.** Retried webhooks are safe. Install and uninstall events are keyed
on `(install, type, timestamp)`, so the same event twice is a no-op.

**Order independent.** The install row is derived from the whole event trail, not
mutated on arrival, so a late-arriving or out-of-order webhook lands correctly.

**Never blocks your app.** Reporting failures should be swallowed — see the
reference implementation below. Nothing here is worth failing an install over.

---

## Reference implementation

For a SvelteKit Shopify app whose store service already fetches the shop:

```ts
// src/lib/server/affiliates.ts
import { createHmac } from 'node:crypto';

const BASE = 'https://affiliates.getbee.app';

// The only per-app edit.
const APP = {
	app: 'rankflo',
	appName: 'RankFlo',
	apiKey: process.env.SHOPIFY_API_KEY,
	partnerId: '3975838'
};

async function report(path: string, payload: Record<string, unknown>) {
	const secret = process.env.CRON_SECRET;
	if (!secret) return;

	const body = JSON.stringify({ ...APP, ...payload });

	try {
		const res = await fetch(`${BASE}${path}`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'x-bee-signature': createHmac('sha256', secret).update(body).digest('hex')
			},
			body
		});
		if (!res.ok) console.error('affiliates', path, res.status, await res.text());
	} catch (error) {
		// Never let reporting fail an install or a webhook.
		console.error('affiliates report failed', error);
	}
}

type Store = {
	shopDomain: string;
	shopName: string | null;
	shopOwnerEmail: string | null;
	shopOwnerName: string | null;
	shopPlan: string | null;
	shopCountry: string | null;
	shopCurrency: string | null;
	shopTimezone: string | null;
};

/** Call from your OAuth callback, with the store row you just upserted. */
export function reportInstall(store: Store, ref?: string | null) {
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
	});
}

/** Call from the app/uninstalled webhook. */
export function reportUninstall(shopDomain: string, reason?: string, feedback?: string) {
	return report('/api/track/uninstall', { shopDomain, reason, feedback });
}
```

### Capturing `ref`

The affiliate link is `/r/{code}/{app-slug}`, which forwards to your App Store
listing with `?ref=CODE` attached. Shopify passes that through to the install
request, so read it in your OAuth entry point and carry it to the callback —
typically through the OAuth `state` or a short-lived cookie.

Without `ref` an install is still recorded, it just earns nobody a commission
until an admin approves a manual claim.

---

## Errors

| Status | Meaning |
| --- | --- |
| `400` | Body is not JSON, a field failed validation, or the shop domain is not a valid `.myshopify.com` |
| `401` | Signature missing or wrong. Check you hashed the exact bytes you sent, and that both sides share `CRON_SECRET` |
| `404` | Unknown `app` handle. Include `appName` to register it |
| `503` | Ingest is not configured — `CRON_SECRET` is unset on the server |
