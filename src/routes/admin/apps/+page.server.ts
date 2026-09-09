import { fail } from '@sveltejs/kit';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { requireAdminAccess, requireOwner, appScopeFilter } from '$lib/server/scope';
import { apps, auditLog, partnerAccounts } from '$lib/server/db/schema';
import { revenueByApp } from '$lib/server/services/stats';
import { syncApps, syncableAccounts } from '$lib/server/services/sync';
import { getIngestKey, ingestKeyHint, rotateIngestKey } from '$lib/server/services/ingest-key';
import { fetchListing, findListing } from '$lib/server/services/listing';
import { lifecycleEmailStats } from '$lib/server/services/lifecycle';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const scope = await requireAdminAccess(event);
	const appFilter = appScopeFilter(scope, apps.id);

	const [rows, revenue, emailStats, accounts] = await Promise.all([
		event.locals.db
			.select({
				app: apps,
				referralCount: sql<number>`(select count(*) from referrals r where r.app_id = apps.id)`
			})
			.from(apps)
			.where(appFilter)
			.orderBy(apps.name),
		revenueByApp(event.locals.db, scope.appIds),
		lifecycleEmailStats(event.locals.db),
		event.locals.db
			.select({ id: partnerAccounts.id, name: partnerAccounts.name })
			.from(partnerAccounts)
			.orderBy(partnerAccounts.name)
	]);

	const revenueById = new Map(revenue.map((r) => [r.appId, r]));

	const connectedAccounts = await syncableAccounts(event.locals.db);

	return {
		canDiscover: connectedAccounts.length > 0,
		ingestKeyHint: scope.canWrite ? await ingestKeyHint(event.locals.db) : null,
		apps: rows.map((r) => {
			const stats = revenueById.get(r.app.id);
			return {
				...r.app,
				referralCount: Number(r.referralCount ?? 0),
				commissionCents: stats?.commissionCents ?? 0,
				grossCents: stats?.grossCents ?? 0,
				netCents: stats?.netCents ?? 0,
				thisMonthGrossCents: stats?.thisMonthGrossCents ?? 0,
				activeInstalls: stats?.activeInstalls ?? 0,
				churnedInstalls: stats?.churnedInstalls ?? 0
			};
		}),
		emailStats,
		accounts,
		canWrite: scope.canWrite
	};
};

const appSchema = z.object({
	name: z.string().trim().min(2, 'Name is required.').max(120),
	slug: z
		.string()
		.trim()
		.toLowerCase()
		.min(2, 'Slug is required.')
		.max(60)
		.regex(/^[a-z0-9-]+$/, 'Slug can only use lowercase letters, numbers and dashes.'),
	listingUrl: z
		.string()
		.trim()
		.url('Listing URL must be a full URL.')
		.optional()
		.or(z.literal('')),
	iconUrl: z.string().trim().url('Icon URL must be a full URL.').optional().or(z.literal('')),
	partnerAccountId: z.string().trim().max(60).optional(),
	partnerAppId: z.string().trim().max(120).optional(),
	commissionPercent: z.coerce.number().min(0, 'Rate cannot be negative.').max(100, 'Rate cannot exceed 100%.'),
	commissionMonths: z.coerce.number().int().min(0).max(120).optional(),
	cookieDays: z.coerce.number().int().min(1).max(365),
	status: z.enum(['active', 'paused']),
	supportEmail: z.string().trim().email('Support email must be a valid address.').optional().or(z.literal('')),
	// The form posts 'true' or an empty string.
	welcomeEmailEnabled: z.string().optional(),
	offboardEmailEnabled: z.string().optional()
});

function toValues(input: z.infer<typeof appSchema>) {
	return {
		name: input.name,
		slug: input.slug,
		listingUrl: input.listingUrl || null,
		iconUrl: input.iconUrl || null,
		partnerAccountId: input.partnerAccountId || null,
		partnerAppId: input.partnerAppId || null,
		commissionBps: Math.round(input.commissionPercent * 100),
		commissionMonths: input.commissionMonths ? input.commissionMonths : null,
		cookieDays: input.cookieDays,
		status: input.status,
		supportEmail: input.supportEmail || null,
		welcomeEmailEnabled: input.welcomeEmailEnabled === 'true',
		offboardEmailEnabled: input.offboardEmailEnabled === 'true'
	};
}

export const actions: Actions = {
	create: async (event) => {
		const admin = await requireOwner(event);
		const parsed = appSchema.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0].message });

		const [clash] = await event.locals.db
			.select({ id: apps.id })
			.from(apps)
			.where(eq(apps.slug, parsed.data.slug))
			.limit(1);
		if (clash) return fail(409, { error: `An app already uses the slug "${parsed.data.slug}".` });

		if (!parsed.data.listingUrl) {
			return fail(400, { error: 'An App Store listing URL is required.' });
		}

		const [created] = await event.locals.db
			.insert(apps)
			.values({ ...toValues(parsed.data), affiliateEnabled: true, source: 'manual' })
			.returning();

		await event.locals.db.insert(auditLog).values({
			actorUserId: admin.userId,
			action: 'app.create',
			entityType: 'app',
			entityId: created.id,
			metadata: { name: created.name }
		});

		return { success: true, message: `${created.name} added.` };
	},

	update: async (event) => {
		const admin = await requireOwner(event);
		const data = Object.fromEntries(await event.request.formData());
		const id = String(data.id ?? '');
		if (!id) return fail(400, { error: 'Missing app id.' });

		const parsed = appSchema.safeParse(data);
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0].message });

		const [clash] = await event.locals.db
			.select({ id: apps.id })
			.from(apps)
			.where(eq(apps.slug, parsed.data.slug))
			.limit(1);
		if (clash && clash.id !== id) {
			return fail(409, { error: `An app already uses the slug "${parsed.data.slug}".` });
		}

		await event.locals.db
			.update(apps)
			.set({ ...toValues(parsed.data), updatedAt: new Date() })
			.where(eq(apps.id, id));

		await event.locals.db.insert(auditLog).values({
			actorUserId: admin.userId,
			action: 'app.update',
			entityType: 'app',
			entityId: id,
			metadata: { name: parsed.data.name }
		});

		return { success: true, message: `${parsed.data.name} saved.` };
	},

	/** Pulls every app from each connected Partner account. */
	discover: async (event) => {
		const admin = await requireOwner(event);
		const accounts = await syncableAccounts(event.locals.db);

		if (!accounts.length) {
			return fail(400, {
				error: 'Connect a Partner account with an access token first.'
			});
		}

		let created = 0;
		let updated = 0;
		const failures: string[] = [];

		for (const account of accounts) {
			const result = await syncApps(event.locals.db, event.platform!.env, account);
			if (result.status === 'failed') failures.push(`${account.name}: ${result.error}`);
			created += result.created;
			updated += result.updated;
		}

		await event.locals.db.insert(auditLog).values({
			actorUserId: admin.userId,
			action: 'app.discover',
			entityType: 'partner_account',
			entityId: accounts.map((a) => a.id).join(','),
			metadata: { created, updated }
		});

		if (failures.length) return fail(502, { error: failures.join(' · ') });

		return {
			success: true,
			message: created
				? `Found ${created} new app${created === 1 ? '' : 's'}. Turn on the ones you want affiliates to promote.`
				: updated
					? `No new apps. Refreshed ${updated}.`
					: 'No new apps found.'
		};
	},

	/**
	 * Opts an app into or out of the affiliate program. Opting in needs a listing
	 * URL, because that is where affiliate links point.
	 */
	toggleAffiliate: async (event) => {
		const admin = await requireOwner(event);
		const data = await event.request.formData();
		const id = String(data.get('id') ?? '');

		const [app] = await event.locals.db.select().from(apps).where(eq(apps.id, id)).limit(1);
		if (!app) return fail(404, { error: 'App not found.' });

		const enable = !app.affiliateEnabled;

		if (enable && !app.listingUrl) {
			return fail(400, {
				error: `Add an App Store listing URL to ${app.name} before offering it to affiliates.`
			});
		}

		await event.locals.db
			.update(apps)
			.set({ affiliateEnabled: enable, updatedAt: new Date() })
			.where(eq(apps.id, id));

		await event.locals.db.insert(auditLog).values({
			actorUserId: admin.userId,
			action: enable ? 'app.affiliate_on' : 'app.affiliate_off',
			entityType: 'app',
			entityId: id,
			metadata: { name: app.name }
		});

		return {
			success: true,
			message: enable
				? `${app.name} is now offered to affiliates.`
				: `${app.name} is no longer offered to affiliates. Existing referrals keep earning.`
		};
	},

	/** Re-reads the App Store page for an app's icon, listing URL and name. */
	refreshListing: async (event) => {
		const admin = await requireOwner(event);
		const id = String((await event.request.formData()).get('id') ?? '');

		const [app] = await event.locals.db.select().from(apps).where(eq(apps.id, id)).limit(1);
		if (!app) return fail(404, { error: 'App not found.' });

		const listing = app.listingUrl
			? await fetchListing(app.listingUrl)
			: await findListing(app.slug, app.name);

		if (!listing) {
			return fail(404, {
				error: app.listingUrl
					? `Could not read ${app.listingUrl}.`
					: `No App Store listing found for "${app.slug}". Add the URL by hand.`
			});
		}

		await event.locals.db
			.update(apps)
			.set({
				listingUrl: listing.url,
				iconUrl: listing.iconUrl ?? app.iconUrl,
				updatedAt: new Date()
			})
			.where(eq(apps.id, id));

		await event.locals.db.insert(auditLog).values({
			actorUserId: admin.userId,
			action: 'app.refresh_listing',
			entityType: 'app',
			entityId: id,
			metadata: { listingUrl: listing.url }
		});

		return { success: true, message: `Listing refreshed for ${app.name}.` };
	},

	/**
	 * Reveals the ingest key. Deliberately an action rather than part of the page
	 * load: the key should not sit in the HTML of a page anyone leaves open, and
	 * this way each reveal is an audited, owner-only step.
	 */
	revealIngestKey: async (event) => {
		const admin = await requireOwner(event);

		const key = await getIngestKey(event.locals.db);
		if (!key) return fail(404, { error: 'No ingest key yet. Generate one.' });

		await event.locals.db.insert(auditLog).values({
			actorUserId: admin.userId,
			action: 'ingest_key.reveal',
			entityType: 'setting',
			entityId: 'ingest_key'
		});

		return { ingestKey: key };
	},

	/** Issues a new key. Every app has to be updated before the old one is dropped. */
	regenerateIngestKey: async (event) => {
		const admin = await requireOwner(event);

		const key = await rotateIngestKey(event.locals.db);

		await event.locals.db.insert(auditLog).values({
			actorUserId: admin.userId,
			action: 'ingest_key.regenerate',
			entityType: 'setting',
			entityId: 'ingest_key'
		});

		return {
			ingestKey: key,
			message: 'New key. Update every app — the previous one no longer works.'
		};
	},

	toggleStatus: async (event) => {
		const admin = await requireOwner(event);
		const data = await event.request.formData();
		const id = String(data.get('id') ?? '');

		const [app] = await event.locals.db.select().from(apps).where(eq(apps.id, id)).limit(1);
		if (!app) return fail(404, { error: 'App not found.' });

		const status = app.status === 'active' ? 'paused' : 'active';
		await event.locals.db.update(apps).set({ status, updatedAt: new Date() }).where(eq(apps.id, id));

		await event.locals.db.insert(auditLog).values({
			actorUserId: admin.userId,
			action: `app.${status}`,
			entityType: 'app',
			entityId: id,
			metadata: { name: app.name }
		});

		return { success: true, message: `${app.name} is now ${status}.` };
	}
};
