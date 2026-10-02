import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { requireOwner } from '$lib/server/scope';
import { apps, auditLog } from '$lib/server/db/schema';
import {
	TOPICS,
	isSlackWebhook,
	postToSlack,
	saveSlackTopics,
	saveSlackWebhook,
	slackSettings,
	type Topic
} from '$lib/server/services/notifications';
import {
	bigQueryConfig,
	bigQueryStatus,
	parseServiceAccount,
	saveBigQueryConfig,
	syncListingTraffic,
	testConnection,
	testDataset
} from '$lib/server/services/bigquery';
import { listingHandle, syncAllReviews } from '$lib/server/services/reviews';
import {
	addCompetitor,
	addKeyword,
	snapshotListings,
	trackKeywords
} from '$lib/server/services/appstore';
import { competitorListings, settings, storeKeywords, usageEvents } from '$lib/server/db/schema';
import { count, desc } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	await requireOwner(event);
	const db = event.locals.db;

	const [slack, bigquery, keywords, competitors, eventNames, appRows] = await Promise.all([
		slackSettings(db),
		bigQueryStatus(db),
		db.select().from(storeKeywords).orderBy(storeKeywords.keyword),
		db.select().from(competitorListings).orderBy(competitorListings.handle),
		db
			.select({ appId: usageEvents.appId, name: usageEvents.name, value: count() })
			.from(usageEvents)
			.groupBy(usageEvents.appId, usageEvents.name)
			.orderBy(desc(count()))
			.limit(200),
		db
			.select({
				id: apps.id,
				name: apps.name,
				listingUrl: apps.listingUrl,
				ga4Dataset: apps.ga4Dataset,
				ratingHundredths: apps.ratingHundredths,
				reviewCount: apps.reviewCount,
				reviewsSyncedAt: apps.reviewsSyncedAt,
				activationEvent: apps.activationEvent
			})
			.from(apps)
			.orderBy(apps.name)
	]);

	return {
		slack,
		topics: Object.entries(TOPICS).map(([key, label]) => ({ key, label })),
		bigquery,
		keywords,
		competitors,
		origin: event.url.origin,
		apps: appRows.map((a) => ({
			...a,
			handle: listingHandle(a.listingUrl),
			events: eventNames.filter((e) => e.appId === a.id).map((e) => e.name)
		}))
	};
};

async function audit(
	event: Parameters<Actions[string]>[0],
	userId: string,
	action: string,
	metadata: Record<string, unknown> = {}
) {
	await event.locals.db.insert(auditLog).values({
		actorUserId: userId,
		action,
		entityType: 'integration',
		entityId: action.split('.')[0],
		metadata
	});
}

export const actions: Actions = {
	saveSlack: async (event) => {
		const owner = await requireOwner(event);
		const form = await event.request.formData();
		const url = String(form.get('webhook') ?? '').trim();
		const topics = form.getAll('topics').map(String) as Topic[];

		if (url) {
			if (!isSlackWebhook(url)) {
				return fail(400, { slackError: 'Use an incoming webhook URL from hooks.slack.com.' });
			}
			await saveSlackWebhook(event.locals.db, url);
			await audit(event, owner.userId, 'slack.connect');
		} else if (!(await slackSettings(event.locals.db)).connected) {
			return fail(400, { slackError: 'Paste the incoming webhook URL from Slack.' });
		}

		await saveSlackTopics(event.locals.db, topics);
		return { success: true, message: 'Slack alerts saved.' };
	},

	testSlack: async (event) => {
		await requireOwner(event);
		const [row] = await event.locals.db
			.select()
			.from(settings)
			.where(eq(settings.key, 'slack_webhook_url'))
			.limit(1);
		if (!row) return fail(400, { slackError: 'Connect Slack first.' });
		try {
			await postToSlack(row.value, ':white_check_mark: Bee Affiliates can post to this channel.');
			return { success: true, message: 'Test message sent. Check the channel.' };
		} catch (error) {
			return fail(502, {
				slackError: `Slack rejected the message: ${error instanceof Error ? error.message : error}`
			});
		}
	},

	disconnectSlack: async (event) => {
		const owner = await requireOwner(event);
		await saveSlackWebhook(event.locals.db, null);
		await audit(event, owner.userId, 'slack.disconnect');
		return { success: true, message: 'Slack disconnected.' };
	},

	saveBigQuery: async (event) => {
		const owner = await requireOwner(event);
		const form = await event.request.formData();
		const key = String(form.get('key') ?? '').trim();
		const location = String(form.get('location') ?? '').trim() || 'US';
		let projectId = String(form.get('projectId') ?? '').trim();

		const current = await bigQueryConfig(event.locals.db);
		let clientEmail = current?.clientEmail ?? '';
		let privateKey = current?.privateKey ?? '';

		if (key) {
			const parsed = parseServiceAccount(key);
			if (!parsed.ok) return fail(400, { bigqueryError: parsed.error });
			clientEmail = parsed.clientEmail;
			privateKey = parsed.privateKey;
			projectId ||= parsed.projectId ?? '';
		}
		if (!privateKey) return fail(400, { bigqueryError: 'Paste the service-account key.' });
		if (!/^[a-z][a-z0-9-]{4,29}$/.test(projectId)) {
			return fail(400, {
				bigqueryError: 'Enter the Google Cloud project ID, like acme-web-402118, not its display name.'
			});
		}

		await saveBigQueryConfig(event.locals.db, { projectId, location, clientEmail, privateKey });
		await audit(event, owner.userId, 'bigquery.connect', { projectId, clientEmail });
		return { success: true, message: 'BigQuery connection saved.' };
	},

	testBigQuery: async (event) => {
		await requireOwner(event);
		const config = await bigQueryConfig(event.locals.db);
		if (!config) return fail(400, { bigqueryError: 'Connect BigQuery first.' });
		try {
			const datasets = await testConnection(config);
			return {
				success: true,
				datasets,
				message: datasets.length
					? `Connected. ${datasets.length} dataset(s) visible.`
					: 'Connected, but this account cannot see any datasets. Grant it BigQuery Data Viewer on the export dataset.'
			};
		} catch (error) {
			return fail(502, { bigqueryError: error instanceof Error ? error.message : String(error) });
		}
	},

	disconnectBigQuery: async (event) => {
		const owner = await requireOwner(event);
		await saveBigQueryConfig(event.locals.db, null);
		await audit(event, owner.userId, 'bigquery.disconnect');
		return { success: true, message: 'BigQuery disconnected. Traffic already collected is kept.' };
	},

	saveDataset: async (event) => {
		const owner = await requireOwner(event);
		const form = await event.request.formData();
		const appId = String(form.get('appId') ?? '');
		const dataset = String(form.get('dataset') ?? '').trim();
		if (dataset && !/^[A-Za-z0-9_]+$/.test(dataset)) {
			return fail(400, { datasetError: 'Dataset names use only letters, numbers and _.', appId });
		}

		await event.locals.db
			.update(apps)
			.set({ ga4Dataset: dataset || null, updatedAt: new Date() })
			.where(eq(apps.id, appId));
		await audit(event, owner.userId, 'bigquery.dataset', { appId, dataset });

		if (!dataset) return { success: true, message: 'Dataset removed.' };
		const config = await bigQueryConfig(event.locals.db);
		if (!config) return { success: true, message: 'Dataset saved. Connect BigQuery to start reading it.' };
		try {
			const check = await testDataset(config, dataset);
			return {
				success: true,
				message: `Dataset saved. ${check.tables} daily tables, ${check.from} to ${check.to}.`
			};
		} catch (error) {
			return fail(400, {
				datasetError: `Saved, but ${error instanceof Error ? error.message : error}`,
				appId
			});
		}
	},

	syncTraffic: async (event) => {
		await requireOwner(event);
		const result = await syncListingTraffic(event.locals.db);
		if (result.errors.length) return fail(502, { bigqueryError: result.errors.join(' ') });
		return {
			success: true,
			message: result.apps
				? `Read traffic for ${result.apps} app(s).`
				: 'No app has a GA4 dataset yet.'
		};
	},

	addKeyword: async (event) => {
		await requireOwner(event);
		const keyword = String((await event.request.formData()).get('keyword') ?? '');
		const added = await addKeyword(event.locals.db, keyword);
		if (!added) return fail(400, { storeError: 'Enter a search term up to 80 characters.' });
		return { success: true, message: `Tracking "${added}". Ranks appear after the next check.` };
	},

	removeKeyword: async (event) => {
		await requireOwner(event);
		const id = String((await event.request.formData()).get('id') ?? '');
		await event.locals.db.delete(storeKeywords).where(eq(storeKeywords.id, id));
		return { success: true, message: 'Keyword removed.' };
	},

	addCompetitor: async (event) => {
		await requireOwner(event);
		const input = String((await event.request.formData()).get('competitor') ?? '');
		const handle = await addCompetitor(event.locals.db, input);
		if (!handle) {
			return fail(400, { storeError: 'Paste the competitor’s App Store URL, like apps.shopify.com/their-app.' });
		}
		return { success: true, message: `Following ${handle}.` };
	},

	removeCompetitor: async (event) => {
		await requireOwner(event);
		const id = String((await event.request.formData()).get('id') ?? '');
		await event.locals.db.delete(competitorListings).where(eq(competitorListings.id, id));
		return { success: true, message: 'Competitor removed.' };
	},

	checkStore: async (event) => {
		await requireOwner(event);
		const [ranks, listings] = await Promise.all([
			trackKeywords(event.locals.db),
			snapshotListings(event.locals.db)
		]);
		const errors = [...ranks.errors, ...listings.errors];
		if (errors.length) return fail(502, { storeError: errors.join(' ') });
		return { success: true, message: `Checked ${ranks.keywords} keyword(s) and every followed listing.` };
	},

	saveActivation: async (event) => {
		const owner = await requireOwner(event);
		const form = await event.request.formData();
		const appId = String(form.get('appId') ?? '');
		const name = String(form.get('activationEvent') ?? '').trim();
		if (name && !/^[a-z0-9_.:-]{1,80}$/i.test(name)) {
			return fail(400, { activationError: 'Use the exact event name the app sends.', appId });
		}
		await event.locals.db
			.update(apps)
			.set({ activationEvent: name || null, updatedAt: new Date() })
			.where(eq(apps.id, appId));
		await audit(event, owner.userId, 'engagement.activation', { appId, event: name || null });
		return { success: true, message: name ? 'Activation event saved.' : 'Activation event cleared.' };
	},

	syncReviews: async (event) => {
		await requireOwner(event);
		const results = await syncAllReviews(event.locals.db);
		const failed = results.filter((r) => r.error);
		const added = results.reduce((a, r) => a + r.added, 0);
		return {
			success: failed.length === 0,
			message: failed.length
				? failed.map((r) => `${r.name}: ${r.error}`).join(' ')
				: `Checked ${results.length} listing(s). ${added} new review(s).`
		};
	}
};
