import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import * as auth from '$lib/server/auth';
import { sendLoginCodeEmail } from '$lib/server/email';
import type { Actions, PageServerLoad } from './$types';

const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address.');
const nameSchema = z.string().trim().max(80).optional();

/** Only ever redirect to a path on this site. */
function safeNext(next: FormDataEntryValue | null) {
	const value = typeof next === 'string' ? next : '';
	return value.startsWith('/') && !value.startsWith('//') ? value : null;
}

export const load: PageServerLoad = async ({ url }) => ({
	next: safeNext(url.searchParams.get('next'))
});

export const actions: Actions = {
	requestCode: async (event) => {
		const data = await event.request.formData();
		const parsed = emailSchema.safeParse(data.get('email'));

		if (!parsed.success) {
			return fail(400, { step: 'email', error: parsed.error.issues[0].message });
		}

		const email = parsed.data;
		const code = await auth.createLoginCode(event.locals.db, email);
		const sent = await sendLoginCodeEmail(event.platform!.env, email, code);

		if (!sent) {
			return fail(502, { step: 'email', email, error: "We couldn't send that email. Try again." });
		}

		return { step: 'code', email };
	},

	verifyCode: async (event) => {
		const data = await event.request.formData();
		const parsedEmail = emailSchema.safeParse(data.get('email'));
		const code = String(data.get('code') ?? '').trim();

		if (!parsedEmail.success) {
			return fail(400, { step: 'email', error: 'Start again with your email address.' });
		}
		const email = parsedEmail.data;

		if (code.length < 6) {
			return fail(400, { step: 'code', email, error: 'Enter the 6-digit code.' });
		}

		const result = await auth.verifyLoginCode(event.locals.db, email, code);
		if (!result.ok) {
			return fail(400, { step: 'code', email, error: result.error });
		}

		const name = nameSchema.safeParse(data.get('name'));
		const user = await auth.findOrCreateUser(
			event.locals.db,
			result.email,
			name.success ? name.data : undefined
		);

		const token = auth.generateSessionToken();
		const session = await auth.createSession(event.locals.db, token, user.id);
		auth.setSessionCookie(event, token, session.expiresAt);

		const next = safeNext(data.get('next'));
		const staffOrAdmin = user.role === 'admin' || user.role === 'staff';
		redirect(303, next ?? (staffOrAdmin ? '/admin' : '/app'));
	},

	resendCode: async (event) => {
		const data = await event.request.formData();
		const parsed = emailSchema.safeParse(data.get('email'));
		if (!parsed.success) {
			return fail(400, { step: 'email', error: 'Start again with your email address.' });
		}

		const code = await auth.createLoginCode(event.locals.db, parsed.data);
		await sendLoginCodeEmail(event.platform!.env, parsed.data, code);

		return { step: 'code', email: parsed.data, resent: true };
	}
};
