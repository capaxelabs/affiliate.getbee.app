import { and, asc, eq, lte, sql } from 'drizzle-orm';
import type { DrizzleClient } from '$lib/server/db';
import { apps, installs, lifecycleEmails, merchants } from '$lib/server/db/schema';
import { sendMerchantOffboardEmail, sendMerchantWelcomeEmail } from '$lib/server/email';

type Env = App.Platform['env'];

const MAX_ATTEMPTS = 3;

export type QueueInput = {
	installId: string;
	appId: string;
	merchantId: string;
	kind: 'welcome' | 'offboard';
	toEmail: string;
	sendAfter?: Date;
};

/**
 * Adds one lifecycle email to the outbox. The unique (install, kind) index
 * means a duplicate webhook can never queue a second copy.
 */
export async function queueLifecycleEmail(db: DrizzleClient, input: QueueInput) {
	const [queued] = await db
		.insert(lifecycleEmails)
		.values({
			installId: input.installId,
			appId: input.appId,
			merchantId: input.merchantId,
			kind: input.kind,
			toEmail: input.toEmail.toLowerCase(),
			sendAfter: input.sendAfter ?? new Date()
		})
		.onConflictDoNothing({ target: [lifecycleEmails.installId, lifecycleEmails.kind] })
		.returning();

	return queued ?? null;
}

export type LifecycleRunSummary = {
	considered: number;
	sent: number;
	skipped: number;
	failed: number;
};

/**
 * Drains the outbox. Called from the cron endpoint and from the admin page.
 * Re-checks the app toggle and the install state at send time so a message
 * queued minutes ago can still be called off.
 */
export async function processLifecycleEmails(
	db: DrizzleClient,
	env: Env,
	limit = 50
): Promise<LifecycleRunSummary> {
	const due = await db
		.select({
			email: lifecycleEmails,
			app: apps,
			merchant: merchants,
			install: installs
		})
		.from(lifecycleEmails)
		.innerJoin(apps, eq(apps.id, lifecycleEmails.appId))
		.innerJoin(merchants, eq(merchants.id, lifecycleEmails.merchantId))
		.innerJoin(installs, eq(installs.id, lifecycleEmails.installId))
		.where(
			and(eq(lifecycleEmails.status, 'pending'), lte(lifecycleEmails.sendAfter, new Date()))
		)
		.orderBy(asc(lifecycleEmails.sendAfter))
		.limit(limit);

	const summary: LifecycleRunSummary = {
		considered: due.length,
		sent: 0,
		skipped: 0,
		failed: 0
	};

	for (const row of due) {
		const { email, app, merchant, install } = row;

		const skipReason = reasonToSkip(email.kind, app, install);
		if (skipReason) {
			await db
				.update(lifecycleEmails)
				.set({ status: 'skipped', error: skipReason, updatedAt: new Date() })
				.where(eq(lifecycleEmails.id, email.id));
			summary.skipped++;
			continue;
		}

		const ok =
			email.kind === 'welcome'
				? await sendMerchantWelcomeEmail(env, email.toEmail, merchant, app)
				: await sendMerchantOffboardEmail(env, email.toEmail, merchant, app);

		if (ok) {
			await db
				.update(lifecycleEmails)
				.set({
					status: 'sent',
					sentAt: new Date(),
					attempts: email.attempts + 1,
					error: null,
					updatedAt: new Date()
				})
				.where(eq(lifecycleEmails.id, email.id));
			summary.sent++;
			continue;
		}

		const attempts = email.attempts + 1;
		await db
			.update(lifecycleEmails)
			.set({
				status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
				attempts,
				error: 'Send failed',
				// Back off before the next try.
				sendAfter: new Date(Date.now() + attempts * 60 * 60 * 1000),
				updatedAt: new Date()
			})
			.where(eq(lifecycleEmails.id, email.id));

		if (attempts >= MAX_ATTEMPTS) summary.failed++;
	}

	return summary;
}

function reasonToSkip(
	kind: 'welcome' | 'offboard',
	app: typeof apps.$inferSelect,
	install: typeof installs.$inferSelect
): string | null {
	if (kind === 'welcome') {
		if (!app.welcomeEmailEnabled) return 'Welcome email turned off for this app.';
		// They already left; a welcome would be worse than nothing.
		if (install.status === 'uninstalled') return 'Merchant uninstalled before the send window.';
		return null;
	}

	if (!app.offboardEmailEnabled) return 'Offboarding email turned off for this app.';
	// They came back before we sent it.
	if (install.status === 'installed') return 'Merchant reinstalled before the send window.';
	return null;
}

/** Counts for the admin lifecycle panel. */
export async function lifecycleEmailStats(db: DrizzleClient) {
	const rows = await db
		.select({
			kind: lifecycleEmails.kind,
			status: lifecycleEmails.status,
			value: sql<number>`count(*)`
		})
		.from(lifecycleEmails)
		.groupBy(lifecycleEmails.kind, lifecycleEmails.status);

	const byKind = { welcome: { pending: 0, sent: 0, failed: 0, skipped: 0 }, offboard: { pending: 0, sent: 0, failed: 0, skipped: 0 } };
	for (const row of rows) {
		byKind[row.kind][row.status] = Number(row.value ?? 0);
	}
	return byKind;
}
