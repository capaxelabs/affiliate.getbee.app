import type { merchants } from '$lib/server/db/schema';

type Merchant = typeof merchants.$inferSelect;

/**
 * Merchant email lives in Raechly journeys: install and uninstall reach it as
 * events, scoped to the app's product. Best effort on purpose: a Raechly outage
 * must never fail an app's install webhook. Without RAECHLY_API_KEY this does
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
	}
) {
	const { RAECHLY_API_KEY: key, RAECHLY_URL: base } = env as Env & {
		RAECHLY_API_KEY?: string;
		RAECHLY_URL?: string;
	};
	const { merchant } = options;
	if (!key || !merchant.email) return;

	const shopName = merchant.name || merchant.shopDomain;
	// Some shops put the store name in the owner field; "Hi The," is worse than "Hi there,".
	const owner = merchant.ownerName?.trim() ?? '';
	const firstName = owner && owner.toLowerCase() !== shopName.toLowerCase() ? owner.split(/\s+/)[0] : '';
	// Raechly holds emails to the person's timezone and needs an IANA name; shops also send "EDT".
	const timezone = merchant.timezone?.includes('/') ? merchant.timezone : undefined;

	const event = {
		name: options.name,
		// Raechly product keys are the app slug with _ for -, as the import used.
		product: options.appSlug.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, ''),
		email: merchant.email,
		// The shop is the stable identity; the merchant email can change.
		user_id: merchant.shopDomain,
		first_name: firstName || undefined,
		company: shopName,
		// Installing the app is the relationship these service emails rest on.
		consent: 'shopify_install',
		occurred_at: options.occurredAt.toISOString(),
		attributes: {
			shop_domain: merchant.shopDomain,
			shop_name: shopName,
			shopify_plan: merchant.shopifyPlan ?? '',
			country: merchant.country ?? '',
			...(timezone ? { timezone } : {})
		},
		properties: options.properties ?? {}
	};

	try {
		const res = await fetch(`${(base || 'https://dash.raechly.com').replace(/\/$/, '')}/api/events`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${key}`,
				'Content-Type': 'application/json',
				'X-Client': 'bee-affiliates'
			},
			body: JSON.stringify(event)
		});
		if (!res.ok) {
			console.error(`raechly ${event.name} ${event.product} ${merchant.shopDomain}: ${res.status} ${await res.text()}`);
		}
	} catch (err) {
		console.error(`raechly ${event.name} ${event.product} ${merchant.shopDomain}:`, err);
	}
}
