import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(303, '/login');
	const staffOrAdmin = locals.user.role === 'admin' || locals.user.role === 'staff';
	redirect(303, staffOrAdmin ? '/admin' : '/app');
};
