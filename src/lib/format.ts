export function money(cents: number, currency = 'USD') {
	return new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency,
		minimumFractionDigits: 2
	}).format((cents ?? 0) / 100);
}

export function percent(bps: number) {
	const value = bps / 100;
	return `${Number.isInteger(value) ? value : value.toFixed(2)}%`;
}

export function commissionLabel(bps: number, months: number | null) {
	return `${percent(bps)} ${months ? `for ${months} months` : 'lifetime'}`;
}

export function shortDate(value: Date | number | string | null | undefined) {
	if (!value) return '—';
	return new Date(value).toLocaleDateString('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric'
	});
}

export function longDate(value: Date | number | string | null | undefined) {
	if (!value) return '—';
	return new Date(value).toLocaleDateString('en-US', {
		year: 'numeric',
		month: 'long',
		day: 'numeric'
	});
}

export function relativeTime(value: Date | number | string | null | undefined) {
	if (!value) return '—';
	const diff = Date.now() - new Date(value).getTime();
	const minutes = Math.round(diff / 60000);
	if (minutes < 1) return 'just now';
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.round(hours / 24);
	if (days < 30) return `${days}d ago`;
	return shortDate(value);
}

export function initials(name: string | null, email: string) {
	const source = name?.trim() || email;
	const parts = source.split(/[\s@._-]+/).filter(Boolean);
	return (parts[0]?.[0] ?? '?').concat(parts[1]?.[0] ?? '').toUpperCase();
}

/** "missing_feature" -> "Missing feature". Used for reason codes apps send us. */
export function humanize(value: string | null | undefined) {
	if (!value) return '';
	const spaced = value.replace(/[_-]+/g, ' ').trim();
	return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
