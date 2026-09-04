import { fail } from '@sveltejs/kit';
import { count, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { requireOwner } from '$lib/server/scope';
import { apps, auditLog, partnerAccounts, partnerSyncRuns } from '$lib/server/db/schema';
import { encryptSecret, encryptionConfigured, tokenHint, EncryptionError } from '$lib/server/crypto';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	await requireOwner(event);
	const db = event.locals.db;
	const env = event.platform!.env;

	const [accounts, unassigned] = await Promise.all([
		db
			.select({
				account: partnerAccounts,
				appCount: sql<number>`(
					select count(*) from apps a where a.partner_account_id = partner_accounts.id
				)`,
				lastRun: sql<string | null>`(
					select max(started_at) from partner_sync_runs r
					where r.partner_account_id = partner_accounts.id
				)`
			})
			.from(partnerAccounts)
			.orderBy(partnerAccounts.name),
		db.select({ value: count() }).from(apps).where(sql`${apps.partnerAccountId} is null`)
	]);

	// Offer a one-click import while the old single-account secrets are still set.
	const canImportFromEnv =
		accounts.length === 0 && Boolean(env?.PARTNER_ORG_ID && env?.PARTNER_API_TOKEN);

	return {
		accounts: accounts.map((row) => ({
			...row.account,
			// Never send the ciphertext to a browser.
			apiTokenEncrypted: undefined,
			hasToken: Boolean(row.account.apiTokenEncrypted),
			appCount: Number(row.appCount ?? 0),
			lastRun: row.lastRun ? new Date(Number(row.lastRun) * 1000) : null
		})),
		unassignedApps: Number(unassigned[0]?.value ?? 0),
		encryptionReady: encryptionConfigured(env),
		canImportFromEnv,
		defaultApiVersion: env?.PARTNER_API_VERSION ?? '2025-01'
	};
};

const accountSchema = z.object({
	name: z.string().trim().min(2, 'Give the account a name.').max(120),
	organizationId: z
		.string()
		.trim()
		.min(1, 'Organization id is required.')
		.regex(/^\d+$/, 'Organization id is the number from your Partner dashboard URL.'),
	apiVersion: z
		.string()
		.trim()
		.regex(/^\d{4}-\d{2}$/, 'API version looks like 2025-01.')
		.optional()
		.or(z.literal('')),
	apiToken: z.string().trim().max(400).optional(),
	status: z.enum(['active', 'paused'])
});

export const actions: Actions = {
	create: async (event) => {
		const owner = await requireOwner(event);
		const env = event.platform!.env;
		const parsed = accountSchema.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0].message });

		if (!parsed.data.apiToken) {
			return fail(400, { error: 'An API token is required to connect an account.' });
		}

		const [clash] = await event.locals.db
			.select({ id: partnerAccounts.id })
			.from(partnerAccounts)
			.where(eq(partnerAccounts.organizationId, parsed.data.organizationId))
			.limit(1);
		if (clash) return fail(409, { error: 'That organization is already connected.' });

		try {
			const [created] = await event.locals.db
				.insert(partnerAccounts)
				.values({
					name: parsed.data.name,
					organizationId: parsed.data.organizationId,
					apiVersion: parsed.data.apiVersion || env.PARTNER_API_VERSION || '2025-01',
					apiTokenEncrypted: await encryptSecret(env, parsed.data.apiToken),
					apiTokenHint: tokenHint(parsed.data.apiToken),
					status: parsed.data.status
				})
				.returning();

			await event.locals.db.insert(auditLog).values({
				actorUserId: owner.userId,
				action: 'partner_account.create',
				entityType: 'partner_account',
				entityId: created.id,
				metadata: { name: created.name, organizationId: created.organizationId }
			});

			return { success: true, message: `${created.name} connected.` };
		} catch (error) {
			if (error instanceof EncryptionError) return fail(503, { error: error.message });
			throw error;
		}
	},

	update: async (event) => {
		const owner = await requireOwner(event);
		const env = event.platform!.env;
		const data = Object.fromEntries(await event.request.formData());
		const id = String(data.id ?? '');
		if (!id) return fail(400, { error: 'Missing account id.' });

		const parsed = accountSchema.safeParse(data);
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0].message });

		const [existing] = await event.locals.db
			.select()
			.from(partnerAccounts)
			.where(eq(partnerAccounts.id, id))
			.limit(1);
		if (!existing) return fail(404, { error: 'Account not found.' });

		const patch: Record<string, unknown> = {
			name: parsed.data.name,
			organizationId: parsed.data.organizationId,
			apiVersion: parsed.data.apiVersion || existing.apiVersion,
			status: parsed.data.status,
			updatedAt: new Date()
		};

		// An empty token field leaves the stored one alone.
		if (parsed.data.apiToken) {
			try {
				patch.apiTokenEncrypted = await encryptSecret(env, parsed.data.apiToken);
				patch.apiTokenHint = tokenHint(parsed.data.apiToken);
				patch.lastSyncError = null;
			} catch (error) {
				if (error instanceof EncryptionError) return fail(503, { error: error.message });
				throw error;
			}
		}

		await event.locals.db.update(partnerAccounts).set(patch).where(eq(partnerAccounts.id, id));

		await event.locals.db.insert(auditLog).values({
			actorUserId: owner.userId,
			action: 'partner_account.update',
			entityType: 'partner_account',
			entityId: id,
			metadata: { name: parsed.data.name, tokenReplaced: Boolean(parsed.data.apiToken) }
		});

		return { success: true, message: `${parsed.data.name} saved.` };
	},

	importFromEnv: async (event) => {
		const owner = await requireOwner(event);
		const env = event.platform!.env;

		if (!env.PARTNER_ORG_ID || !env.PARTNER_API_TOKEN) {
			return fail(400, { error: 'No Partner credentials found in the environment.' });
		}

		const [existing] = await event.locals.db
			.select({ id: partnerAccounts.id })
			.from(partnerAccounts)
			.limit(1);
		if (existing) return fail(409, { error: 'Accounts already exist; add the next one manually.' });

		try {
			const [created] = await event.locals.db
				.insert(partnerAccounts)
				.values({
					name: 'Imported from environment',
					organizationId: env.PARTNER_ORG_ID,
					apiVersion: env.PARTNER_API_VERSION || '2025-01',
					apiTokenEncrypted: await encryptSecret(env, env.PARTNER_API_TOKEN),
					apiTokenHint: tokenHint(env.PARTNER_API_TOKEN)
				})
				.returning();

			// Adopt every app that has no account yet — before this there was only one.
			await event.locals.db
				.update(apps)
				.set({ partnerAccountId: created.id, updatedAt: new Date() })
				.where(sql`${apps.partnerAccountId} is null`);

			await event.locals.db.insert(auditLog).values({
				actorUserId: owner.userId,
				action: 'partner_account.import_env',
				entityType: 'partner_account',
				entityId: created.id
			});

			return {
				success: true,
				message: 'Imported. Rename it, then remove the PARTNER_* worker secrets.'
			};
		} catch (error) {
			if (error instanceof EncryptionError) return fail(503, { error: error.message });
			throw error;
		}
	},

	remove: async (event) => {
		const owner = await requireOwner(event);
		const id = String((await event.request.formData()).get('id') ?? '');

		const [account] = await event.locals.db
			.select()
			.from(partnerAccounts)
			.where(eq(partnerAccounts.id, id))
			.limit(1);
		if (!account) return fail(404, { error: 'Account not found.' });

		const [linked] = await event.locals.db
			.select({ value: count() })
			.from(apps)
			.where(eq(apps.partnerAccountId, id));

		if (Number(linked?.value ?? 0) > 0) {
			return fail(409, {
				error: `${linked.value} app(s) still point at this account. Move them first.`
			});
		}

		await event.locals.db.delete(partnerAccounts).where(eq(partnerAccounts.id, id));

		await event.locals.db.insert(auditLog).values({
			actorUserId: owner.userId,
			action: 'partner_account.delete',
			entityType: 'partner_account',
			entityId: id,
			metadata: { name: account.name }
		});

		return { success: true, message: `${account.name} disconnected.` };
	}
};
