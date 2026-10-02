import { eq, isNotNull, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { DrizzleClient } from '$lib/server/db';
import { apps, listingTraffic, settings, trafficSources } from '$lib/server/db/schema';
import { listingHandle } from './reviews';
import { runBatch } from '$lib/server/db/batch';

/**
 * Listing traffic from the GA4 BigQuery export.
 *
 * Shopify sends two events into the GA4 property whose measurement id is on a
 * listing: `page_view` when a merchant opens it, and `Add App button` — spaces
 * and capitals exactly so — when they click install. Nothing before the install
 * exists in the Partner API, so this is the only way to see the top of the
 * funnel. Installs and everything after come from the Partner API, where they
 * are complete.
 *
 * Credentials are a service-account key stored in `settings`. It is sent to
 * Google to mint a token and never back to a browser.
 */

const KEY = 'bigquery';
const SCOPE = 'https://www.googleapis.com/auth/bigquery';
const VIEW_EVENT = 'page_view';
const CLICK_EVENT = 'Add App button';

export type BigQueryConfig = {
	projectId: string;
	location: string;
	clientEmail: string;
	privateKey: string;
};

export async function bigQueryConfig(db: DrizzleClient): Promise<BigQueryConfig | null> {
	const [row] = await db.select().from(settings).where(eq(settings.key, KEY)).limit(1);
	return row ? (JSON.parse(row.value) as BigQueryConfig) : null;
}

/** What the admin may see: never the key. */
export async function bigQueryStatus(db: DrizzleClient) {
	const config = await bigQueryConfig(db);
	return config
		? { connected: true, projectId: config.projectId, location: config.location, clientEmail: config.clientEmail }
		: { connected: false, projectId: null, location: null, clientEmail: null };
}

/**
 * Parses a pasted service-account key. Returns an error a person can act on
 * rather than throwing, because a mangled paste is the usual failure.
 */
export function parseServiceAccount(json: string):
	| { ok: true; clientEmail: string; privateKey: string; projectId: string | null }
	| { ok: false; error: string } {
	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(json);
	} catch {
		return { ok: false, error: 'Paste the whole key file, braces included. It is not valid JSON.' };
	}
	if (parsed.type !== 'service_account') {
		return { ok: false, error: 'That is not a service-account key. Create a JSON key for a service account.' };
	}
	if (typeof parsed.client_email !== 'string' || typeof parsed.private_key !== 'string') {
		return { ok: false, error: 'The key is missing client_email or private_key.' };
	}
	if (!parsed.private_key.includes('BEGIN PRIVATE KEY')) {
		return { ok: false, error: 'The private key looks damaged. Paste the file without editing it.' };
	}
	return {
		ok: true,
		clientEmail: parsed.client_email,
		privateKey: parsed.private_key,
		projectId: typeof parsed.project_id === 'string' ? parsed.project_id : null
	};
}

export async function saveBigQueryConfig(db: DrizzleClient, config: BigQueryConfig | null) {
	if (!config) {
		await db.delete(settings).where(eq(settings.key, KEY));
		return;
	}
	const value = JSON.stringify(config);
	await db
		.insert(settings)
		.values({ key: KEY, value, hint: config.clientEmail })
		.onConflictDoUpdate({
			target: settings.key,
			set: { value, hint: config.clientEmail, updatedAt: new Date() }
		});
}

const b64url = (bytes: Uint8Array) =>
	btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');

const b64urlJson = (value: unknown) => b64url(new TextEncoder().encode(JSON.stringify(value)));

async function accessToken(config: BigQueryConfig) {
	const pem = config.privateKey
		.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '')
		.replace(/\s+/g, '');
	const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
	const key = await crypto.subtle.importKey(
		'pkcs8',
		der,
		{ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
		false,
		['sign']
	);

	const now = Math.floor(Date.now() / 1000);
	const unsigned = `${b64urlJson({ alg: 'RS256', typ: 'JWT' })}.${b64urlJson({
		iss: config.clientEmail,
		scope: SCOPE,
		aud: 'https://oauth2.googleapis.com/token',
		iat: now,
		exp: now + 3600
	})}`;
	const signature = new Uint8Array(
		await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned))
	);

	const res = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
			assertion: `${unsigned}.${b64url(signature)}`
		})
	});
	const body = (await res.json()) as { access_token?: string; error_description?: string };
	if (!res.ok || !body.access_token) {
		throw new Error(`Google refused the key: ${body.error_description ?? res.status}`);
	}
	return body.access_token;
}

type QueryParam = { name: string; type: 'STRING'; value: string };

async function query(
	config: BigQueryConfig,
	token: string,
	sql: string,
	params: QueryParam[] = []
): Promise<string[][]> {
	const res = await fetch(
		`https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(config.projectId)}/queries`,
		{
			method: 'POST',
			headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				query: sql,
				useLegacySql: false,
				location: config.location,
				timeoutMs: 30000,
				parameterMode: 'NAMED',
				queryParameters: params.map((p) => ({
					name: p.name,
					parameterType: { type: p.type },
					parameterValue: { value: p.value }
				}))
			})
		}
	);
	const body = (await res.json()) as {
		rows?: { f: { v: string | null }[] }[];
		jobComplete?: boolean;
		error?: { message: string };
	};
	if (!res.ok) throw new Error(body.error?.message ?? `BigQuery returned ${res.status}`);
	if (body.jobComplete === false) throw new Error('BigQuery did not finish the query in 30 seconds.');
	return (body.rows ?? []).map((r) => r.f.map((c) => c.v ?? ''));
}

/** A dataset name BigQuery would accept, so it can sit in a table path safely. */
const DATASET = /^[A-Za-z0-9_]{1,1024}$/;
const PROJECT = /^[a-z][a-z0-9-]{4,29}$/;

/** Proves the key, the project and the API, and lists the datasets visible. */
export async function testConnection(config: BigQueryConfig) {
	const token = await accessToken(config);
	const res = await fetch(
		`https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(config.projectId)}/datasets?all=false`,
		{ headers: { Authorization: `Bearer ${token}` } }
	);
	const body = (await res.json()) as {
		datasets?: { datasetReference: { datasetId: string } }[];
		error?: { message: string };
	};
	if (!res.ok) throw new Error(body.error?.message ?? `BigQuery returned ${res.status}`);
	return (body.datasets ?? []).map((d) => d.datasetReference.datasetId);
}

/** Proves a dataset is a GA4 export and says what dates it covers. */
export async function testDataset(config: BigQueryConfig, dataset: string) {
	if (!DATASET.test(dataset)) throw new Error('Dataset names use only letters, numbers and _.');
	const token = await accessToken(config);
	const rows = await query(
		config,
		token,
		`SELECT COUNT(*), MIN(table_name), MAX(table_name)
		 FROM \`${config.projectId}.${dataset}.INFORMATION_SCHEMA.TABLES\`
		 WHERE STARTS_WITH(table_name, 'events_2')`
	);
	const [tables, first, last] = rows[0] ?? ['0', '', ''];
	if (!Number(tables)) throw new Error('No daily export tables in that dataset yet. GA4 writes the first one about a day after linking.');
	const day = (t: string) => `${t.slice(7, 11)}-${t.slice(11, 13)}-${t.slice(13, 15)}`;
	return { tables: Number(tables), from: day(first), to: day(last) };
}

function ymd(date: Date) {
	return date.toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * Pulls distinct visitors per day (35 days) and per month, plus where the
 * visitors came from, for every app with a dataset.
 *
 * A visitor is GA4's User-ID where set, else the browser. Today is never read:
 * GA4 rewrites its intraday table into the daily one afterwards, so the latest
 * day lands a day late. An app's first read reaches back six months; after
 * that only the current and previous month are re-read, because older months
 * no longer change and BigQuery bills every table a query touches.
 *
 * Apps that share one GA4 property share a dataset, and are told apart by the
 * listing URL. On its own dataset an app counts everything in it: a listing
 * also addresses some of its own pages by number, and a handle filter would
 * drop them.
 */
export async function syncListingTraffic(db: DrizzleClient) {
	const config = await bigQueryConfig(db);
	if (!config) return { apps: 0, rows: 0, errors: [] as string[] };
	if (!PROJECT.test(config.projectId)) {
		return { apps: 0, rows: 0, errors: ['The Google Cloud project id is not valid.'] };
	}

	const listed = await db
		.select({
			id: apps.id,
			name: apps.name,
			dataset: apps.ga4Dataset,
			listingUrl: apps.listingUrl,
			months: sql<number>`(
				select count(*) from listing_traffic t where t.app_id = apps.id and t.grain = 'month'
			)`
		})
		.from(apps)
		.where(isNotNull(apps.ga4Dataset));

	const datasetUse = new Map<string, number>();
	for (const app of listed) {
		const key = app.dataset?.trim() ?? '';
		datasetUse.set(key, (datasetUse.get(key) ?? 0) + 1);
	}

	const token = await accessToken(config);
	const now = new Date();
	const dayStart = new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000);
	const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

	const errors: string[] = [];
	let rows = 0;

	for (const app of listed) {
		const dataset = app.dataset?.trim() ?? '';
		if (!DATASET.test(dataset)) {
			errors.push(`${app.name}: dataset name is not valid.`);
			continue;
		}
		const handle = listingHandle(app.listingUrl);
		const shared = (datasetUse.get(dataset) ?? 0) > 1;
		if (shared && !handle) {
			errors.push(`${app.name}: shares a GA4 dataset, so it needs an App Store listing URL.`);
			continue;
		}

		const backMonths = Number(app.months) > 0 ? 1 : 5;
		const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - backMonths, 1));

		try {
			const table = `\`${config.projectId}.${dataset}.events_*\``;
			const visitor = `COALESCE(user_id, user_pseudo_id)`;
			const param = (key: string) =>
				`(SELECT value.string_value FROM UNNEST(event_params) WHERE key = '${key}')`;
			const scoped = shared ? `AND REGEXP_CONTAINS(${param('page_location')}, @listing)` : '';
			const where = `_TABLE_SUFFIX BETWEEN @from AND @to AND event_name IN (@view, @click) ${scoped}`;
			const counts = `
				COUNT(DISTINCT IF(event_name = @view, ${visitor}, NULL)),
				COUNT(DISTINCT IF(event_name = @click, ${visitor}, NULL))`;
			const month = `FORMAT_DATE('%Y-%m', PARSE_DATE('%Y%m%d', event_date))`;
			const grouped = (bucket: string) =>
				`SELECT ${bucket} AS period, ${counts} FROM ${table} WHERE ${where} GROUP BY period`;

			// Where a visitor came from: the App Store tags its own links with
			// surface_type and surface_detail; anything else is told apart by
			// the referrer.
			const sources = `
				WITH e AS (
					SELECT ${month} AS period, event_name, ${visitor} AS visitor,
						${param('page_location')} AS loc, ${param('page_referrer')} AS ref
					FROM ${table} WHERE ${where}
				)
				SELECT period,
					COALESCE(REGEXP_EXTRACT(loc, r'[?&]surface_type=([^&#]+)'),
						IF(ref IS NULL OR ref = '', 'direct',
							IF(REGEXP_CONTAINS(ref, r'apps\\.shopify\\.com'), 'app_store', 'external'))) AS surface,
					COALESCE(REGEXP_EXTRACT(loc, r'[?&]surface_detail=([^&#]+)'),
						IF(ref IS NULL OR ref = '' OR REGEXP_CONTAINS(ref, r'apps\\.shopify\\.com'), '', NET.HOST(ref))) AS detail,
					COUNT(DISTINCT IF(event_name = @view, visitor, NULL)),
					COUNT(DISTINCT IF(event_name = @click, visitor, NULL))
				FROM e GROUP BY period, surface, detail`;

			const params = (from: Date): QueryParam[] => [
				{ name: 'view', type: 'STRING', value: VIEW_EVENT },
				{ name: 'click', type: 'STRING', value: CLICK_EVENT },
				{ name: 'from', type: 'STRING', value: ymd(from) },
				{ name: 'to', type: 'STRING', value: ymd(yesterday) },
				...(shared
					? [{ name: 'listing', type: 'STRING' as const, value: `apps\\.shopify\\.com/${handle}([/?#]|$)` }]
					: [])
			];

			const [daily, monthly, bySource] = await Promise.all([
				query(config, token, grouped(`FORMAT_DATE('%Y-%m-%d', PARSE_DATE('%Y%m%d', event_date))`), params(dayStart)),
				query(config, token, grouped(month), params(monthStart)),
				query(config, token, sources, params(monthStart))
			]);

			const statements: BatchItem<'sqlite'>[] = [];
			for (const [grain, list] of [['day', daily], ['month', monthly]] as const) {
				for (const [period, views, clicks] of list) {
					statements.push(
						db
							.insert(listingTraffic)
							.values({
								appId: app.id,
								grain,
								period,
								listingViews: Number(views),
								addAppClicks: Number(clicks)
							})
							.onConflictDoUpdate({
								target: [listingTraffic.appId, listingTraffic.grain, listingTraffic.period],
								set: { listingViews: Number(views), addAppClicks: Number(clicks), updatedAt: new Date() }
							})
					);
				}
			}
			for (const [period, surface, detail, views, clicks] of bySource) {
				const values = {
					listingViews: Number(views),
					addAppClicks: Number(clicks),
					updatedAt: new Date()
				};
				statements.push(
					db
						.insert(trafficSources)
						.values({ appId: app.id, period, surface: decode(surface), detail: decode(detail), ...values })
						.onConflictDoUpdate({
							target: [trafficSources.appId, trafficSources.period, trafficSources.surface, trafficSources.detail],
							set: values
						})
				);
			}
			await runBatch(db, statements);
			rows += statements.length;
		} catch (error) {
			errors.push(`${app.name}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	return { apps: listed.length, rows, errors };
}

/** "sort+collections" → "sort collections", capped so a junk URL cannot bloat a row. */
function decode(value: string) {
	try {
		return decodeURIComponent(value.replace(/\+/g, ' ')).trim().toLowerCase().slice(0, 120);
	} catch {
		return value.slice(0, 120);
	}
}
