import { error, redirect } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';

export function requireUser(event: RequestEvent) {
	const user = event.locals.user;
	if (!user) redirect(303, `/login?next=${encodeURIComponent(event.url.pathname)}`);
	return user;
}

export function requireAdmin(event: RequestEvent) {
	const user = requireUser(event);
	if (user.role !== 'admin') error(403, 'Admins only');
	return user;
}

/** Any signed-in affiliate, including ones still awaiting approval. */
export function requireAffiliate(event: RequestEvent) {
	const user = requireUser(event);
	if (!user.affiliateId) error(403, 'No affiliate profile on this account');
	return { ...user, affiliateId: user.affiliateId };
}

/** An affiliate cleared to earn. Pending accounts can look but not act. */
export function requireApprovedAffiliate(event: RequestEvent) {
	const affiliate = requireAffiliate(event);
	if (affiliate.affiliateStatus !== 'approved') {
		error(403, 'Your account is not approved yet');
	}
	return affiliate;
}
