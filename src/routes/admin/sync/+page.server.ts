import { fail } from '@sveltejs/kit';
import { desc, eq } from 'drizzle-orm';
import { requireOwner } from '$lib/server/scope';
import { apps, partnerAccounts, partnerSyncRuns } from '$lib/server/db/schema';
import { runFullSync, syncableAccounts, syncInstalls, syncTransactions } from '$lib/server/services/sync';
import { lifecycleEmailStats, processLifecycleEmails } from '$lib/server/services/lifecycle';
import { encryptionConfigured } from '$lib/server/crypto';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	await requireOwner(event);
	const db = event.locals.db;

	const [runs, accounts, allApps, emailStats] = await Promise.all([
		db
			.select({
				run: partnerSyncRuns,
				accountName: partnerAccounts.name
			})
			.from(partnerSyncRuns)
			.leftJoin(partnerAccounts, eq(partnerAccounts.id, partnerSyncRuns.partnerAccountId))
			.orderBy(desc(partnerSyncRuns.startedAt))
			.limit(30),
		db.select().from(partnerAccounts).orderBy(partnerAccounts.name),
		db
			.select({ id: apps.id, name: apps.name, partnerAppId: apps.partnerAppId, partnerAccountId: apps.partnerAccountId })
			.from(apps)
			.orderBy(apps.name),
		lifecycleEmailStats(db)
	]);

	const syncable = await syncableAccounts(db);

	return {
		runs: runs.map((r) => ({ ...r.run, accountName: r.accountName })),
		accounts: accounts.map((a) => ({
			id: a.id,
			name: a.name,
			organizationId: a.organizationId,
			status: a.status,
			hasToken: Boolean(a.apiTokenEncrypted),
			lastSyncedAt: a.lastSyncedAt,
			lastSyncError: a.lastSyncError,
			appCount: allApps.filter((app) => app.partnerAccountId === a.id).length
		})),
		emailStats,
		syncableCount: syncable.length,
		encryptionReady: encryptionConfigured(event.platform!.env),
		untracked: allApps.filter((a) => !a.partnerAppId || !a.partnerAccountId).length
	};
};

async function accountFrom(event: Parameters<Actions[string]>[0]) {
	const id = String((await event.request.formData()).get('partnerAccountId') ?? '');
	if (!id) return null;
	const [account] = await event.locals.db
		.select()
		.from(partnerAccounts)
		.where(eq(partnerAccounts.id, id))
		.limit(1);
	return account ?? null;
}

export const actions: Actions = {
	transactions: async (event) => {
		await requireOwner(event);
		const account = await accountFrom(event);
		if (!account) return fail(400, { error: 'Pick a partner account.' });

		const result = await syncTransactions(event.locals.db, event.platform!.env, account, 'manual');
		return {
			success: result.status === 'success',
			message:
				result.status === 'success'
					? `${account.name}: saw ${result.recordsSeen}, matched ${result.recordsMatched}, created ${result.commissionsCreated} commissions.`
					: (result.error ?? 'Sync failed.')
		};
	},

	installs: async (event) => {
		await requireOwner(event);
		const account = await accountFrom(event);
		if (!account) return fail(400, { error: 'Pick a partner account.' });

		const result = await syncInstalls(event.locals.db, event.platform!.env, account, 'manual');
		return {
			success: result.status === 'success',
			message:
				result.status === 'success'
					? `${account.name}: saw ${result.recordsSeen} installs, updated ${result.recordsMatched} referrals.`
					: (result.error ?? 'Sync failed.')
		};
	},

	syncAll: async (event) => {
		await requireOwner(event);
		const result = await runFullSync(event.locals.db, event.platform!.env, 'manual');

		if (!result.accounts) {
			return { success: false, message: 'No connected accounts with a stored API token.' };
		}

		const failed = [...result.installs, ...result.transactions].filter((r) => r.status === 'failed');
		const created = result.transactions.reduce((a, r) => a + r.commissionsCreated, 0);

		return {
			success: failed.length === 0,
			message: failed.length
				? `${failed.length} of ${result.accounts * 2} runs failed. Check the history below.`
				: `Synced ${result.accounts} account(s), created ${created} commissions, cleared ${result.released}.`
		};
	},

	lifecycle: async (event) => {
		await requireOwner(event);
		const result = await processLifecycleEmails(event.locals.db, event.platform!.env);
		return {
			success: true,
			message: result.considered
				? `${result.sent} sent, ${result.skipped} skipped, ${result.failed} failed.`
				: 'Nothing was due to send.'
		};
	}
};
