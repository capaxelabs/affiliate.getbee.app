import { error, redirect, type Handle, type HandleServerError } from '@sveltejs/kit';
import { initDb } from '$lib/server/db';
import * as auth from '$lib/server/auth';

export const handle: Handle = async ({ event, resolve }) => {
	const binding = event.platform?.env?.DB;
	if (!binding) {
		throw new Error('D1 binding DB is missing. Run through `wrangler dev` or `npm run dev`.');
	}

	event.locals.db = initDb(binding);
	event.locals.user = null;
	event.locals.session = null;

	const token = event.cookies.get(auth.sessionCookieName);
	if (token) {
		const { session, user } = await auth.validateSessionToken(event.locals.db, token);
		if (session) {
			auth.setSessionCookie(event, token, session.expiresAt);
			event.locals.session = session;
			event.locals.user = user;
		} else {
			auth.deleteSessionCookie(event);
		}
	}

	const { pathname } = event.url;
	const user = event.locals.user;
	const isStaffOrAdmin = user?.role === 'admin' || user?.role === 'staff';

	if (pathname.startsWith('/app') || pathname.startsWith('/admin')) {
		if (!user) redirect(303, `/login?next=${encodeURIComponent(pathname + event.url.search)}`);
		if (pathname.startsWith('/admin') && !isStaffOrAdmin) redirect(303, '/app');
		if (pathname.startsWith('/app') && isStaffOrAdmin) redirect(303, '/admin');
	}

	// Staff are read-only. Blocking writes at the edge means an individual form
	// action can never accidentally become writable for them.
	if (pathname.startsWith('/admin') && user?.role === 'staff' && event.request.method !== 'GET') {
		error(403, 'Your account has read-only access.');
	}

	if (pathname === '/login' && user) {
		redirect(303, isStaffOrAdmin ? '/admin' : '/app');
	}

	return resolve(event);
};

export const handleError: HandleServerError = ({ error, status }) => {
	if (status !== 404) console.error(error);
	return {
		message: status === 404 ? 'Page not found' : 'Something went wrong on our end.',
		code: status === 404 ? 'not_found' : 'internal'
	};
};
