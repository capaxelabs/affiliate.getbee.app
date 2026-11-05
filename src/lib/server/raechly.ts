import type { merchants } from '$lib/server/db/schema';

type Merchant = typeof merchants.$inferSelect;

/**
 * Merchant email lives in Raechly journeys: install and uninstall reach it as
 * events, scoped to the app's product, with the install's tags (app_status,
 * installed_at, uninstalled_at, install_count). In-app milestones and their
 * tags go from each app to Raechly directly. Best effort on purpose: a Raechly
 * outage must never fail an app's webhook. Without RAECHLY_API_KEY this does
 * nothing.
 */
export async function sendMerchantEvent(
	env: Env,
	options: {
		appSlug: string;
		name: 'app_installed' | 'app_uninstalled';
		merchant: Merchant;
		occurredAt: Date;
		properties?: Record<string, unknown>;
		/** Tags for this app's person in Raechly, kept per product. */
		attributes?: Record<string, unknown>;
	}
) {
	const { name, occurredAt, properties, attributes, ...rest } = options;
	await sendMerchantEvents(env, {
		...rest,
		events: [{ name, occurredAt, properties, attributes }]
	});
}

/** Up to 100 events for one merchant in one request, as Raechly's batch form allows. */
export async function sendMerchantEvents(
	env: Env,
	options: {
		appSlug: string;
		merchant: Merchant;
		events: {
			name: string;
			occurredAt: Date;
			properties?: Record<string, unknown> | null;
			attributes?: Record<string, unknown>;
		}[];
	}
) {
	const { RAECHLY_API_KEY: key, RAECHLY_URL: base } = env as Env & {
		RAECHLY_API_KEY?: string;
		RAECHLY_URL?: string;
	};
	const { merchant } = options;
	if (!key || !merchant.email || options.events.length === 0) return;

	const shopName = merchant.name || merchant.shopDomain;
	// Some shops put the store name in the owner field; "Hi The," is worse than "Hi there,".
	const owner = merchant.ownerName?.trim() ?? '';
	const firstName =
		owner && owner.toLowerCase() !== shopName.toLowerCase() ? owner.split(/\s+/)[0] : '';
	// Raechly holds emails to the person's timezone and needs an IANA name; shops also send "EDT".
	const timezone = merchant.timezone?.includes('/') ? merchant.timezone : undefined;
	// Raechly product keys are the app slug with _ for -, as the import used.
	const product = options.appSlug
		.toLowerCase()
		.replace(/[^a-z0-9_]+/g, '_')
		.replace(/^_+|_+$/g, '');

	const events = options.events.slice(0, 100).map((e) => ({
		name: e.name,
		product,
		email: merchant.email,
		// The shop is the stable identity; the merchant email can change.
		user_id: merchant.shopDomain,
		first_name: firstName || undefined,
		company: shopName,
		// Installing the app is the relationship these service emails rest on.
		consent: 'shopify_install',
		occurred_at: e.occurredAt.toISOString(),
		attributes: {
			shop_domain: merchant.shopDomain,
			shop_name: shopName,
			shopify_plan: merchant.shopifyPlan ?? '',
			country: merchant.country ?? '',
			...(timezone ? { timezone } : {}),
			...e.attributes
		},
		properties: e.properties ?? {}
	}));
	const label = `raechly ${events.map((e) => e.name).join(',')} ${product} ${merchant.shopDomain}`;

	try {
		const res = await fetch(
			`${(base || 'https://dash.raechly.com').replace(/\/$/, '')}/api/events`,
			{
				method: 'POST',
				headers: {
					Authorization: `Bearer ${key}`,
					'Content-Type': 'application/json',
					'X-Client': 'bee-affiliates'
				},
				body: JSON.stringify({ events })
			}
		);
		if (!res.ok) {
			console.error(`${label}: ${res.status} ${await res.text()}`);
			return;
		}
		// The batch form answers 201 even when an event is refused (an unknown product key), so read it.
		const out = (await res.json().catch(() => null)) as {
			failed?: number;
			results?: unknown[];
		} | null;
		if (out?.failed) console.error(`${label}: ${JSON.stringify(out.results)}`);
	} catch (err) {
		console.error(`${label}:`, err);
	}
}
