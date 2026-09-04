export const REFERRAL_COOKIE = 'bee_ref';

export const AFFILIATE_STATUS_LABEL = {
	pending: 'Awaiting approval',
	approved: 'Approved',
	rejected: 'Rejected',
	suspended: 'Suspended'
} as const;

export const REFERRAL_STATUS_LABEL = {
	pending: 'Pending install',
	active: 'Active',
	churned: 'Churned',
	rejected: 'Rejected'
} as const;

export const COMMISSION_STATUS_LABEL = {
	pending: 'Pending',
	approved: 'Approved',
	paid: 'Paid',
	void: 'Void'
} as const;

export const PAYOUT_STATUS_LABEL = {
	draft: 'Draft',
	processing: 'Processing',
	paid: 'Paid',
	failed: 'Failed'
} as const;

export const CHARGE_TYPE_LABEL = {
	recurring: 'Subscription',
	one_time: 'One-time',
	usage: 'Usage',
	adjustment: 'Adjustment',
	refund: 'Refund'
} as const;

export const SOURCE_LABEL = {
	click: 'Tracked link',
	claim: 'Approved claim',
	manual: 'Added by admin',
	partner_api: 'Partner API'
} as const;

/** Commissions are held this long so refunds can claw back before payout. */
export const HOLD_DAYS = 30;
