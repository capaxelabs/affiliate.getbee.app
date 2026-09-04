import { fail } from '@sveltejs/kit';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { requireAdminAccess, requireOwner, appScopeFilter } from '$lib/server/scope';
import { apps, auditLog, partnerAccounts } from '$lib/server/db/schema';
import { revenueByApp } from '$lib/server/services/stats';
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

	return {
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
	listingUrl: z.string().trim().url('Listing URL must be a full URL.'),
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
		listingUrl: input.listingUrl,
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

		const [created] = await event.locals.db.insert(apps).values(toValues(parsed.data)).returning();

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
