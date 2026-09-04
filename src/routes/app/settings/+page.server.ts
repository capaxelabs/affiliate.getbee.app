import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { requireAffiliate } from '$lib/server/guards';
import { affiliates, users } from '$lib/server/db/schema';
import { affiliateLink } from '$lib/server/services/referral';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const user = requireAffiliate(event);

	const [profile] = await event.locals.db
		.select()
		.from(affiliates)
		.where(eq(affiliates.id, user.affiliateId))
		.limit(1);

	const appUrl = event.platform!.env.APP_URL || event.url.origin;

	return {
		name: user.name,
		email: user.email,
		profile,
		baseLink: affiliateLink(appUrl, profile.refCode, '{app}')
	};
};

const profileSchema = z.object({
	name: z.string().trim().max(80).optional(),
	company: z.string().trim().max(120).optional(),
	website: z.string().trim().max(200).optional(),
	promotionMethod: z.string().trim().max(2000).optional()
});

const payoutSchema = z.object({
	payoutMethod: z.enum(['paypal', 'wise', 'bank']).optional(),
	payoutEmail: z.string().trim().max(200).optional(),
	accountName: z.string().trim().max(120).optional(),
	accountNumber: z.string().trim().max(64).optional(),
	routing: z.string().trim().max(64).optional(),
	minPayout: z.coerce.number().min(0).max(100000).optional()
});

const taxSchema = z.object({
	taxCountry: z.string().trim().max(60).optional(),
	taxId: z.string().trim().max(60).optional()
});

export const actions: Actions = {
	profile: async (event) => {
		const user = requireAffiliate(event);
		const parsed = profileSchema.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0].message });

		const { name, ...rest } = parsed.data;

		if (rest.website && !/^https?:\/\/\S+\.\S+/.test(rest.website)) {
			return fail(400, { error: 'Website must start with http:// or https://' });
		}

		await event.locals.db
			.update(users)
			.set({ name: name || null, updatedAt: new Date() })
			.where(eq(users.id, user.id));

		await event.locals.db
			.update(affiliates)
			.set({
				company: rest.company || null,
				website: rest.website || null,
				promotionMethod: rest.promotionMethod || null,
				updatedAt: new Date()
			})
			.where(eq(affiliates.id, user.affiliateId));

		return { success: true, message: 'Profile saved.' };
	},

	payout: async (event) => {
		const user = requireAffiliate(event);
		const parsed = payoutSchema.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0].message });

		const { payoutMethod, payoutEmail, minPayout, ...bank } = parsed.data;

		if (payoutMethod && payoutMethod !== 'bank' && !payoutEmail) {
			return fail(400, { error: 'Add the email address we should send payouts to.' });
		}

		await event.locals.db
			.update(affiliates)
			.set({
				payoutMethod: payoutMethod ?? null,
				payoutEmail: payoutEmail || null,
				payoutDetails:
					payoutMethod === 'bank'
						? {
								accountName: bank.accountName ?? '',
								accountNumber: bank.accountNumber ?? '',
								routing: bank.routing ?? ''
							}
						: null,
				minPayoutCents: Math.round((minPayout ?? 50) * 100),
				updatedAt: new Date()
			})
			.where(eq(affiliates.id, user.affiliateId));

		return { success: true, message: 'Payout details saved.' };
	},

	tax: async (event) => {
		const user = requireAffiliate(event);
		const parsed = taxSchema.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0].message });

		await event.locals.db
			.update(affiliates)
			.set({
				taxCountry: parsed.data.taxCountry || null,
				taxId: parsed.data.taxId || null,
				updatedAt: new Date()
			})
			.where(eq(affiliates.id, user.affiliateId));

		return { success: true, message: 'Tax info saved.' };
	}
};
