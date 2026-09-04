/**
 * Minimal Shopify Partner API client. Only the two queries the affiliate
 * program needs: billing transactions and app installs.
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
};

export type PartnerInstallEvent = {
	occurredAt: string;
	shopDomain: string | null;
	appId: string | null;
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
          grossAmount { amount currencyCode }
          netAmount { amount currencyCode }
        }
        ... on AppOneTimeSale {
          shop { myshopifyDomain name }
          app { id name }
          grossAmount { amount currencyCode }
          netAmount { amount currencyCode }
        }
        ... on AppUsageSale {
          shop { myshopifyDomain name }
          app { id name }
          grossAmount { amount currencyCode }
          netAmount { amount currencyCode }
        }
        ... on AppSaleAdjustment {
          shop { myshopifyDomain name }
          app { id name }
          grossAmount { amount currencyCode }
          netAmount { amount currencyCode }
        }
      }
    }
  }
}`;

const INSTALLS_QUERY = `
query AffiliateInstalls($appId: ID!, $after: String, $occurredAtMin: DateTime) {
  app(id: $appId) {
    events(first: 100, after: $after, occurredAtMin: $occurredAtMin, types: [RELATIONSHIP_INSTALLED]) {
      pageInfo { hasNextPage }
      edges {
        cursor
        node {
          occurredAt
          ... on RelationshipInstalled { shop { myshopifyDomain } }
        }
      }
    }
  }
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
			netAmount: node.netAmount ?? null
		})),
		cursor: edges.at(-1)?.cursor ?? null,
		hasNextPage: data.transactions.pageInfo.hasNextPage
	};
}

type InstallsResponse = {
	app: {
		events: {
			pageInfo: { hasNextPage: boolean };
			edges: { cursor: string; node: { occurredAt: string; shop?: { myshopifyDomain: string } } }[];
		};
	} | null;
};

export async function fetchInstalls(
	credentials: PartnerCredentials,
	partnerAppId: string,
	options: { after?: string | null; occurredAtMin?: string | null } = {}
): Promise<{ installs: PartnerInstallEvent[]; cursor: string | null; hasNextPage: boolean }> {
	const data = await request<InstallsResponse>(credentials, INSTALLS_QUERY, {
		appId: partnerAppId,
		after: options.after ?? null,
		occurredAtMin: options.occurredAtMin ?? null
	});

	const edges = data.app?.events.edges ?? [];
	return {
		installs: edges.map(({ node }) => ({
			occurredAt: node.occurredAt,
			shopDomain: node.shop?.myshopifyDomain ?? null,
			appId: partnerAppId
		})),
		cursor: edges.at(-1)?.cursor ?? null,
		hasNextPage: data.app?.events.pageInfo.hasNextPage ?? false
	};
}

/** Partner amounts are decimal strings like "29.00". */
export function toCents(amount: string | null | undefined) {
	if (!amount) return 0;
	return Math.round(Number.parseFloat(amount) * 100);
}

export function chargeTypeFor(
	typename: string
): 'recurring' | 'one_time' | 'usage' | 'adjustment' | 'refund' {
	switch (typename) {
		case 'AppSubscriptionSale':
			return 'recurring';
		case 'AppOneTimeSale':
			return 'one_time';
		case 'AppUsageSale':
			return 'usage';
		case 'AppSaleAdjustment':
			return 'adjustment';
		default:
			return 'adjustment';
	}
}
