/**
 * Minimal Shopify Partner API client: billing transactions, and each app's
 * install and charge events.
 *
 * Credentials come from a partner account row rather than the environment, so
 * several Partner organizations can be connected at once.
 */
export type PartnerCredentials = {
	organizationId: string;
	apiToken: string;
	apiVersion: string;
};
export class PartnerApiError extends Error {
	constructor(
		message: string,
		readonly status?: number
	) {
		super(message);
		this.name = 'PartnerApiError';
	}
}

export type PartnerTransaction = {
	id: string;
	type: 'AppSubscriptionSale' | 'AppSaleAdjustment' | 'AppOneTimeSale' | 'AppUsageSale' | string;
	createdAt: string;
	shopDomain: string | null;
	shopName: string | null;
	appId: string | null;
	appName: string | null;
	grossAmount: { amount: string; currencyCode: string } | null;
	netAmount: { amount: string; currencyCode: string } | null;
	/** The charge this sale billed. Null before September 2020. */
	chargeId: string | null;
	/** Subscription sales only. */
	billingInterval: 'monthly' | 'annual' | null;
};

export type PartnerApp = {
	id: string;
	name: string;
	/** OAuth client id. Stable across renames, unlike the App Store handle. */
	apiKey?: string | null;
};

/** An install, uninstall, deactivation or reactivation on one app. */
export type PartnerRelationshipEvent = {
	kind: 'installed' | 'uninstalled' | 'deactivated' | 'reactivated';
	occurredAt: string;
	shopDomain: string | null;
	shopName: string | null;
	/** Only present on uninstalls — Shopify's own churn reason. */
	reason: string | null;
	appId: string;
};

/** A charge moving through its lifecycle on one app. */
export type PartnerChargeEvent = {
	kind: 'recurring' | 'one_time' | 'usage' | 'credit';
	/** What the event did to the charge. */
	action: 'accepted' | 'activated' | 'frozen' | 'unfrozen' | 'cancelled' | 'expired' | 'declined';
	occurredAt: string;
	shopDomain: string | null;
	shopName: string | null;
	chargeId: string;
	name: string | null;
	amount: { amount: string; currencyCode: string } | null;
	/** Subscriptions only — when Shopify next bills it. */
	billingOn: string | null;
	test: boolean;
};

const TRANSACTIONS_QUERY = `
query AffiliateTransactions($after: String, $createdAtMin: DateTime) {
  transactions(first: 100, after: $after, createdAtMin: $createdAtMin) {
    pageInfo { hasNextPage }
    edges {
      cursor
      node {
        id
        createdAt
        __typename
        ... on AppSubscriptionSale {
          shop { myshopifyDomain name }
          app { id name }
          chargeId
          billingInterval
          grossAmount { amount currencyCode }
          netAmount { amount currencyCode }
        }
        ... on AppOneTimeSale {
          shop { myshopifyDomain name }
          app { id name }
          chargeId
          grossAmount { amount currencyCode }
          netAmount { amount currencyCode }
        }
        ... on AppUsageSale {
          shop { myshopifyDomain name }
          app { id name }
          chargeId
          grossAmount { amount currencyCode }
          netAmount { amount currencyCode }
        }
        ... on AppSaleAdjustment {
          shop { myshopifyDomain name }
          app { id name }
          chargeId
          grossAmount { amount currencyCode }
          netAmount { amount currencyCode }
        }
        ... on AppSaleCredit {
          shop { myshopifyDomain name }
          app { id name }
          chargeId
          grossAmount { amount currencyCode }
          netAmount { amount currencyCode }
        }
      }
    }
  }
}`;

const APP_EVENTS_QUERY = `
query AppEvents($appId: ID!, $after: String, $occurredAtMin: DateTime) {
  app(id: $appId) {
    events(
      first: 100
      after: $after
      occurredAtMin: $occurredAtMin
      types: [
        RELATIONSHIP_INSTALLED
        RELATIONSHIP_UNINSTALLED
        RELATIONSHIP_DEACTIVATED
        RELATIONSHIP_REACTIVATED
        SUBSCRIPTION_CHARGE_ACCEPTED
        SUBSCRIPTION_CHARGE_ACTIVATED
        SUBSCRIPTION_CHARGE_CANCELED
        SUBSCRIPTION_CHARGE_DECLINED
        SUBSCRIPTION_CHARGE_EXPIRED
        SUBSCRIPTION_CHARGE_FROZEN
        SUBSCRIPTION_CHARGE_UNFROZEN
        ONE_TIME_CHARGE_ACCEPTED
        ONE_TIME_CHARGE_ACTIVATED
        ONE_TIME_CHARGE_DECLINED
        ONE_TIME_CHARGE_EXPIRED
        USAGE_CHARGE_APPLIED
        SUBSCRIPTION_APPROACHING_CAPPED_AMOUNT
        SUBSCRIPTION_CAPPED_AMOUNT_UPDATED
        CREDIT_APPLIED
      ]
    ) {
      pageInfo { hasNextPage }
      edges {
        cursor
        node {
          occurredAt
          __typename
          ... on RelationshipInstalled { shop { myshopifyDomain name } }
          ... on RelationshipReactivated { shop { myshopifyDomain name } }
          ... on RelationshipDeactivated { shop { myshopifyDomain name } }
          ... on RelationshipUninstalled { reason shop { myshopifyDomain name } }
          ... on SubscriptionChargeAccepted { shop { myshopifyDomain name } charge { ...subscription } }
          ... on SubscriptionChargeActivated { shop { myshopifyDomain name } charge { ...subscription } }
          ... on SubscriptionChargeCanceled { shop { myshopifyDomain name } charge { ...subscription } }
          ... on SubscriptionChargeDeclined { shop { myshopifyDomain name } charge { ...subscription } }
          ... on SubscriptionChargeExpired { shop { myshopifyDomain name } charge { ...subscription } }
          ... on SubscriptionChargeFrozen { shop { myshopifyDomain name } charge { ...subscription } }
          ... on SubscriptionChargeUnfrozen { shop { myshopifyDomain name } charge { ...subscription } }
          ... on OneTimeChargeAccepted { shop { myshopifyDomain name } charge { ...oneTime } }
          ... on OneTimeChargeActivated { shop { myshopifyDomain name } charge { ...oneTime } }
          ... on OneTimeChargeDeclined { shop { myshopifyDomain name } charge { ...oneTime } }
          ... on OneTimeChargeExpired { shop { myshopifyDomain name } charge { ...oneTime } }
          ... on UsageChargeApplied { shop { myshopifyDomain name } charge { id name test amount { amount currencyCode } } }
          ... on SubscriptionApproachingCappedAmount { shop { myshopifyDomain name } charge { ...subscription } }
          ... on SubscriptionCappedAmountUpdated { shop { myshopifyDomain name } charge { ...subscription } }
          ... on CreditApplied { shop { myshopifyDomain name } appCredit { id name test amount { amount currencyCode } } }
        }
      }
    }
  }
}

fragment subscription on AppSubscription { id name test billingOn amount { amount currencyCode } }
fragment oneTime on AppPurchaseOneTime { id name test amount { amount currencyCode } }
`;

const APP_QUERY = `
query PartnerApp($id: ID!) {
  app(id: $id) { id name apiKey }
}`;

async function request<T>(
	credentials: PartnerCredentials,
	query: string,
	variables: Record<string, unknown>
): Promise<T> {
	if (!credentials.organizationId || !credentials.apiToken) {
		throw new PartnerApiError('Partner API credentials are missing for this account.');
	}

	const url = `https://partners.shopify.com/${credentials.organizationId}/api/${credentials.apiVersion}/graphql.json`;
	const res = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Shopify-Access-Token': credentials.apiToken
		},
		body: JSON.stringify({ query, variables })
	});

	if (!res.ok) {
		throw new PartnerApiError(`Partner API returned ${res.status}`, res.status);
	}

	const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
	if (body.errors?.length) {
		throw new PartnerApiError(body.errors.map((e) => e.message).join('; '));
	}
	if (!body.data) throw new PartnerApiError('Partner API returned no data.');
	return body.data;
}

type TransactionsResponse = {
	transactions: {
		pageInfo: { hasNextPage: boolean };
		edges: {
			cursor: string;
			node: {
				id: string;
				createdAt: string;
				__typename: string;
				shop?: { myshopifyDomain: string; name: string } | null;
				app?: { id: string; name: string } | null;
				grossAmount?: { amount: string; currencyCode: string } | null;
				netAmount?: { amount: string; currencyCode: string } | null;
				chargeId?: string | null;
				billingInterval?: 'EVERY_30_DAYS' | 'ANNUAL' | null;
			};
		}[];
	};
};

/** One page of transactions, newest cursor last. */
export async function fetchTransactions(
	credentials: PartnerCredentials,
	options: { after?: string | null; createdAtMin?: string | null } = {}
): Promise<{ transactions: PartnerTransaction[]; cursor: string | null; hasNextPage: boolean }> {
	const data = await request<TransactionsResponse>(credentials, TRANSACTIONS_QUERY, {
		after: options.after ?? null,
		createdAtMin: options.createdAtMin ?? null
	});

	const edges = data.transactions.edges;
	return {
		transactions: edges.map(({ node }) => ({
			id: node.id,
			type: node.__typename,
			createdAt: node.createdAt,
			shopDomain: node.shop?.myshopifyDomain ?? null,
			shopName: node.shop?.name ?? null,
			appId: node.app?.id ?? null,
			appName: node.app?.name ?? null,
			grossAmount: node.grossAmount ?? null,
			netAmount: node.netAmount ?? null,
			chargeId: node.chargeId ?? null,
			billingInterval:
				node.billingInterval === 'ANNUAL'
					? 'annual'
					: node.billingInterval === 'EVERY_30_DAYS'
						? 'monthly'
						: null
		})),
		cursor: edges.at(-1)?.cursor ?? null,
		hasNextPage: data.transactions.pageInfo.hasNextPage
	};
}

/**
 * Distinct apps seen in the org's billing transactions.
 *
 * The Partner API has no field that lists an organization's apps — QueryRoot
 * exposes only `app(id:)`, `transactions`, `events` and `activeSubscription`,
 * and the org-wide `Relationship` event carries no app reference. Every
 * transaction does name its app, so that is the one place app identity leaks
 * out. An app with no transactions yet cannot be discovered and has to be added
 * by hand.
 */
export async function discoverApps(
	credentials: PartnerCredentials,
	options: { since?: Date; maxPages?: number } = {}
): Promise<PartnerApp[]> {
	const since = options.since ?? new Date(Date.now() - 730 * 24 * 60 * 60 * 1000);
	const maxPages = options.maxPages ?? 40;

	const found = new Map<string, string>();
	let after: string | null = null;

	for (let page = 0; page < maxPages; page++) {
		const result = await fetchTransactions(credentials, {
			after,
			createdAtMin: since.toISOString()
		});

		for (const txn of result.transactions) {
			if (txn.appId) found.set(txn.appId, txn.appName ?? txn.appId);
		}

		if (!result.hasNextPage || !result.cursor) break;
		after = result.cursor;
	}

	return [...found].map(([id, name]) => ({ id, name }));
}

type AppEventsResponse = {
	app: {
		events: {
			pageInfo: { hasNextPage: boolean };
			edges: {
				cursor: string;
				node: {
					occurredAt: string;
					__typename: string;
					reason?: string | null;
					shop?: { myshopifyDomain: string; name: string } | null;
					charge?: {
						id: string;
						name: string | null;
						test: boolean | null;
						billingOn?: string | null;
						amount?: { amount: string; currencyCode: string } | null;
					} | null;
					appCredit?: {
						id: string;
						name: string | null;
						test: boolean | null;
						amount?: { amount: string; currencyCode: string } | null;
					} | null;
				};
			}[];
		};
	} | null;
};

const RELATIONSHIP_KIND: Record<string, PartnerRelationshipEvent['kind']> = {
	RelationshipInstalled: 'installed',
	RelationshipUninstalled: 'uninstalled',
	// A closed or frozen shop. Shopify raises this instead of an uninstall, and
	// unlike RelationshipUninstalled the type carries no `reason` field — asking
	// for one is a schema error, not an empty value.
	RelationshipDeactivated: 'deactivated',
	RelationshipReactivated: 'reactivated'
};

const CHARGE_EVENT: Record<
	string,
	{ kind: PartnerChargeEvent['kind']; action: PartnerChargeEvent['action'] }
> = {
	SubscriptionChargeAccepted: { kind: 'recurring', action: 'accepted' },
	SubscriptionChargeActivated: { kind: 'recurring', action: 'activated' },
	SubscriptionChargeCanceled: { kind: 'recurring', action: 'cancelled' },
	SubscriptionChargeDeclined: { kind: 'recurring', action: 'declined' },
	SubscriptionChargeExpired: { kind: 'recurring', action: 'expired' },
	SubscriptionChargeFrozen: { kind: 'recurring', action: 'frozen' },
	SubscriptionChargeUnfrozen: { kind: 'recurring', action: 'unfrozen' },
	OneTimeChargeAccepted: { kind: 'one_time', action: 'accepted' },
	OneTimeChargeActivated: { kind: 'one_time', action: 'activated' },
	OneTimeChargeDeclined: { kind: 'one_time', action: 'declined' },
	OneTimeChargeExpired: { kind: 'one_time', action: 'expired' }
};

/**
 * Billing events that are not a charge changing state: usage applied inside a
 * cycle, a subscription nearing or raising its usage cap, a credit issued.
 */
export type PartnerBillingEvent = {
	kind: 'usage' | 'cap_approaching' | 'cap_updated' | 'credit';
	occurredAt: string;
	shopDomain: string | null;
	/** The usage record, the subscription, or the credit. */
	id: string;
	name: string | null;
	amount: { amount: string; currencyCode: string } | null;
	test: boolean;
};

const BILLING_EVENT: Record<string, PartnerBillingEvent['kind']> = {
	UsageChargeApplied: 'usage',
	SubscriptionApproachingCappedAmount: 'cap_approaching',
	SubscriptionCappedAmountUpdated: 'cap_updated',
	CreditApplied: 'credit'
};

/**
 * One page of an app's event feed: installs and charges together.
 *
 * They come from the same connection, so asking for both costs one request
 * rather than two — which matters on Workers, where every call out is a
 * subrequest against a hard per-request cap.
 */
export async function fetchAppEvents(
	credentials: PartnerCredentials,
	partnerAppId: string,
	options: { after?: string | null; occurredAtMin?: string | null } = {}
): Promise<{
	relationships: PartnerRelationshipEvent[];
	charges: PartnerChargeEvent[];
	billing: PartnerBillingEvent[];
	cursor: string | null;
	hasNextPage: boolean;
}> {
	const data = await request<AppEventsResponse>(credentials, APP_EVENTS_QUERY, {
		appId: partnerAppId,
		after: options.after ?? null,
		occurredAtMin: options.occurredAtMin ?? null
	});

	const edges = data.app?.events.edges ?? [];

	return {
		relationships: edges.flatMap(({ node }) => {
			const kind = RELATIONSHIP_KIND[node.__typename];
			if (!kind) return [];
			return [
				{
					kind,
					occurredAt: node.occurredAt,
					shopDomain: node.shop?.myshopifyDomain ?? null,
					shopName: node.shop?.name ?? null,
					reason: node.reason ?? null,
					appId: partnerAppId
				}
			];
		}),
		charges: edges.flatMap(({ node }) => {
			// The capped-amount events carry an AppSubscription too, but they are
			// not state changes and must not move the charge's status.
			const mapped = CHARGE_EVENT[node.__typename];
			if (!mapped || !node.charge) return [];
			return [
				{
					kind: mapped.kind,
					action: mapped.action,
					occurredAt: node.occurredAt,
					shopDomain: node.shop?.myshopifyDomain ?? null,
					shopName: node.shop?.name ?? null,
					chargeId: node.charge.id,
					name: node.charge.name ?? null,
					amount: node.charge.amount ?? null,
					billingOn: node.charge.billingOn ?? null,
					test: Boolean(node.charge.test)
				}
			];
		}),
		billing: edges.flatMap(({ node }) => {
			const kind = BILLING_EVENT[node.__typename];
			const subject = node.appCredit ?? node.charge;
			if (!kind || !subject) return [];
			return [
				{
					kind,
					occurredAt: node.occurredAt,
					shopDomain: node.shop?.myshopifyDomain ?? null,
					id: subject.id,
					name: subject.name ?? null,
					amount: subject.amount ?? null,
					test: Boolean(subject.test)
				}
			];
		}),
		cursor: edges.at(-1)?.cursor ?? null,
		hasNextPage: data.app?.events.pageInfo.hasNextPage ?? false
	};
}

/** One app by its Partner gid, including the OAuth client id. */
export async function fetchApp(
	credentials: PartnerCredentials,
	partnerAppId: string
): Promise<PartnerApp | null> {
	const data = await request<{ app: { id: string; name: string; apiKey: string | null } | null }>(
		credentials,
		APP_QUERY,
		{ id: partnerAppId }
	);
	return data.app ? { id: data.app.id, name: data.app.name, apiKey: data.app.apiKey } : null;
}

/** Partner amounts are decimal strings like "29.00". */
export function toCents(amount: string | null | undefined) {
	if (!amount) return 0;
	return Math.round(Number.parseFloat(amount) * 100);
}

export function chargeTypeFor(
	typename: string
): 'recurring' | 'one_time' | 'usage' | 'adjustment' | 'refund' | 'credit' {
	switch (typename) {
		case 'AppSubscriptionSale':
			return 'recurring';
		case 'AppOneTimeSale':
			return 'one_time';
		case 'AppUsageSale':
			return 'usage';
		case 'AppSaleAdjustment':
			return 'adjustment';
		case 'AppSaleCredit':
			return 'credit';
		default:
			return 'adjustment';
	}
}
