import { requireAffiliate } from '$lib/server/guards';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async (event) => {
	const user = requireAffiliate(event);
	return {
		user: {
			id: user.id,
			name: user.name,
			email: user.email,
			affiliateId: user.affiliateId,
			affiliateStatus: user.affiliateStatus
		}
	};
};
