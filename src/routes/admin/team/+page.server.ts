import { fail } from '@sveltejs/kit';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { z } from 'zod';
import { requireOwner } from '$lib/server/scope';
import { adminScopes, apps, auditLog, partnerAccounts, users } from '$lib/server/db/schema';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	await requireOwner(event);
	const db = event.locals.db;

	const [team, scopes, allApps, accounts] = await Promise.all([
		db
			.select({
				id: users.id,
				name: users.name,
				email: users.email,
				role: users.role,
				viewAffiliateData: users.viewAffiliateData,
				lastLoginAt: users.lastLoginAt,
				createdAt: users.createdAt
			})
			.from(users)
			.where(inArray(users.role, ['admin', 'staff']))
			.orderBy(users.email),
		db
			.select({
				id: adminScopes.id,
				userId: adminScopes.userId,
				partnerAccountId: adminScopes.partnerAccountId,
				appId: adminScopes.appId,
				appName: apps.name,
				accountName: partnerAccounts.name
			})
			.from(adminScopes)
			.leftJoin(apps, eq(apps.id, adminScopes.appId))
			.leftJoin(partnerAccounts, eq(partnerAccounts.id, adminScopes.partnerAccountId)),
		db
			.select({ id: apps.id, name: apps.name, partnerAccountId: apps.partnerAccountId })
			.from(apps)
			.orderBy(apps.name),
		db
			.select({ id: partnerAccounts.id, name: partnerAccounts.name })
			.from(partnerAccounts)
			.orderBy(partnerAccounts.name)
	]);

	return {
		team: team.map((member) => ({
			...member,
			scopes: scopes.filter((s) => s.userId === member.id)
		})),
		apps: allApps,
		accounts
	};
};

const inviteSchema = z.object({
	email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
	name: z.string().trim().max(80).optional(),
	viewAffiliateData: z.string().optional()
});

export const actions: Actions = {
	/**
	 * Adds a read-only staff member. They sign in with the same emailed code as
	 * everyone else; no invite link needed.
	 */
	invite: async (event) => {
		const owner = await requireOwner(event);
		const parsed = inviteSchema.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0].message });

		const viewAffiliateData = parsed.data.viewAffiliateData === 'true';

		const [existing] = await event.locals.db
			.select()
			.from(users)
			.where(eq(users.email, parsed.data.email))
			.limit(1);

		if (existing) {
			if (existing.role === 'admin') {
				return fail(409, { error: 'That address is already a full admin.' });
			}
			// An affiliate who is also joining staff keeps their affiliate row; the
			// role decides which side of the app they land on.
			await event.locals.db
				.update(users)
				.set({
					role: 'staff',
					viewAffiliateData,
					name: existing.name ?? parsed.data.name ?? null,
					updatedAt: new Date()
				})
				.where(eq(users.id, existing.id));

			await event.locals.db.insert(auditLog).values({
				actorUserId: owner.userId,
				action: 'team.promote_staff',
				entityType: 'user',
				entityId: existing.id,
				metadata: { email: existing.email }
			});

			return { success: true, message: `${existing.email} is now staff. Grant them apps below.` };
		}

		const [created] = await event.locals.db
			.insert(users)
			.values({
				email: parsed.data.email,
				name: parsed.data.name || null,
				role: 'staff',
				viewAffiliateData
			})
			.returning();

		await event.locals.db.insert(auditLog).values({
			actorUserId: owner.userId,
			action: 'team.invite_staff',
			entityType: 'user',
			entityId: created.id,
			metadata: { email: created.email }
		});

		return {
			success: true,
			message: `${created.email} added. They can sign in now — grant them apps below.`
		};
	},

	setAffiliateVisibility: async (event) => {
		const owner = await requireOwner(event);
		const data = await event.request.formData();
		const userId = String(data.get('userId') ?? '');
		const value = String(data.get('value') ?? '') === 'true';

		const [member] = await event.locals.db
			.select()
			.from(users)
			.where(and(eq(users.id, userId), eq(users.role, 'staff')))
			.limit(1);
		if (!member) return fail(404, { error: 'Staff member not found.' });

		await event.locals.db
			.update(users)
			.set({ viewAffiliateData: value, updatedAt: new Date() })
			.where(eq(users.id, userId));

		await event.locals.db.insert(auditLog).values({
			actorUserId: owner.userId,
			action: 'team.set_affiliate_visibility',
			entityType: 'user',
			entityId: userId,
			metadata: { value }
		});

		return {
			success: true,
			message: value
				? `${member.email} can now see the affiliate program.`
				: `${member.email} no longer sees the affiliate program.`
		};
	},

	grant: async (event) => {
		const owner = await requireOwner(event);
		const data = await event.request.formData();
		const userId = String(data.get('userId') ?? '');
		const target = String(data.get('target') ?? '');

		const [member] = await event.locals.db
			.select()
			.from(users)
			.where(and(eq(users.id, userId), eq(users.role, 'staff')))
			.limit(1);
		if (!member) return fail(404, { error: 'Staff member not found.' });

		// target is "app:<id>" or "account:<id>".
		const [kind, id] = target.split(':');
		if (!id) return fail(400, { error: 'Pick an app or a partner account.' });

		if (kind === 'app') {
			const [app] = await event.locals.db
				.select({ id: apps.id, name: apps.name })
				.from(apps)
				.where(eq(apps.id, id))
				.limit(1);
			if (!app) return fail(404, { error: 'App not found.' });

			await event.locals.db
				.insert(adminScopes)
				.values({ userId, appId: app.id })
				.onConflictDoNothing();

			await event.locals.db.insert(auditLog).values({
				actorUserId: owner.userId,
				action: 'team.grant_app',
				entityType: 'user',
				entityId: userId,
				metadata: { appId: app.id, appName: app.name }
			});

			return { success: true, message: `Granted ${app.name}.` };
		}

		if (kind === 'account') {
			const [account] = await event.locals.db
				.select({ id: partnerAccounts.id, name: partnerAccounts.name })
				.from(partnerAccounts)
				.where(eq(partnerAccounts.id, id))
				.limit(1);
			if (!account) return fail(404, { error: 'Partner account not found.' });

			await event.locals.db
				.insert(adminScopes)
				.values({ userId, partnerAccountId: account.id })
				.onConflictDoNothing();

			await event.locals.db.insert(auditLog).values({
				actorUserId: owner.userId,
				action: 'team.grant_account',
				entityType: 'user',
				entityId: userId,
				metadata: { partnerAccountId: account.id, accountName: account.name }
			});

			return { success: true, message: `Granted every app under ${account.name}.` };
		}

		return fail(400, { error: 'Unknown grant type.' });
	},

	revoke: async (event) => {
		const owner = await requireOwner(event);
		const scopeId = String((await event.request.formData()).get('scopeId') ?? '');

		const [scope] = await event.locals.db
			.select()
			.from(adminScopes)
			.where(eq(adminScopes.id, scopeId))
			.limit(1);
		if (!scope) return fail(404, { error: 'Grant not found.' });

		await event.locals.db.delete(adminScopes).where(eq(adminScopes.id, scopeId));

		await event.locals.db.insert(auditLog).values({
			actorUserId: owner.userId,
			action: 'team.revoke',
			entityType: 'user',
			entityId: scope.userId,
			metadata: { appId: scope.appId, partnerAccountId: scope.partnerAccountId }
		});

		return { success: true, message: 'Access revoked.' };
	},

	/** Demotes a staff member back to a plain affiliate account. */
	removeStaff: async (event) => {
		const owner = await requireOwner(event);
		const userId = String((await event.request.formData()).get('userId') ?? '');

		const [member] = await event.locals.db
			.select()
			.from(users)
			.where(and(eq(users.id, userId), eq(users.role, 'staff')))
			.limit(1);
		if (!member) return fail(404, { error: 'Staff member not found.' });

		await event.locals.db.delete(adminScopes).where(eq(adminScopes.userId, userId));
		await event.locals.db
			.update(users)
			.set({ role: 'affiliate', viewAffiliateData: false, updatedAt: new Date() })
			.where(eq(users.id, userId));

		await event.locals.db.insert(auditLog).values({
			actorUserId: owner.userId,
			action: 'team.remove_staff',
			entityType: 'user',
			entityId: userId,
			metadata: { email: member.email }
		});

		return { success: true, message: `${member.email} no longer has admin access.` };
	},

	/** Promotes someone to a full admin. Guarded so you cannot demote yourself. */
	makeOwner: async (event) => {
		const owner = await requireOwner(event);
		const userId = String((await event.request.formData()).get('userId') ?? '');

		const [member] = await event.locals.db
			.select()
			.from(users)
			.where(and(eq(users.id, userId), ne(users.role, 'admin')))
			.limit(1);
		if (!member) return fail(404, { error: 'User not found or already an admin.' });

		await event.locals.db.delete(adminScopes).where(eq(adminScopes.userId, userId));
		await event.locals.db
			.update(users)
			.set({ role: 'admin', viewAffiliateData: true, updatedAt: new Date() })
			.where(eq(users.id, userId));

		await event.locals.db.insert(auditLog).values({
			actorUserId: owner.userId,
			action: 'team.make_owner',
			entityType: 'user',
			entityId: userId,
			metadata: { email: member.email }
		});

		return { success: true, message: `${member.email} is now a full admin.` };
	}
};
