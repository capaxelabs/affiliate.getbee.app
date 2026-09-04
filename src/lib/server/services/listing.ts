/**
 * App Store listing lookup.
 *
 * The Partner API gives an app's id and name and nothing else — no icon, no
 * listing URL, no tagline. Those only exist on the public App Store page, so we
 * read them from its Open Graph tags.
 */
export type Listing = {
	url: string;
	iconUrl: string | null;
	title: string | null;
	tagline: string | null;
};

const USER_AGENT = 'BeeAffiliates/1.0 (+https://affiliate.getbee.app)';

/** Most apps publish at apps.shopify.com/<slug>, but it is only a guess. */
export function guessListingUrl(slug: string) {
	return `https://apps.shopify.com/${slug}`;
}

function meta(html: string, key: string, attr: 'property' | 'name' = 'property') {
	const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const patterns = [
		new RegExp(`<meta[^>]+${attr}=["']${escaped}["'][^>]*content=["']([^"']+)`, 'i'),
		new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*${attr}=["']${escaped}["']`, 'i')
	];
	for (const re of patterns) {
		const match = html.match(re);
		if (match) return decodeEntities(match[1]);
	}
	return null;
}

function decodeEntities(value: string) {
	return value
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, ' ')
		.trim();
}

/**
 * Reads a listing page. Returns null when the page does not exist or cannot be
 * read — a missing listing is normal (unlisted or renamed apps) and must never
 * fail a sync.
 */
export async function fetchListing(url: string): Promise<Listing | null> {
	let target: URL;
	try {
		target = new URL(url);
	} catch {
		return null;
	}

	// Only ever fetch the Shopify App Store, never an arbitrary host.
	if (target.hostname !== 'apps.shopify.com') return null;

	try {
		const res = await fetch(target.toString(), {
			headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
			redirect: 'follow'
		});
		if (!res.ok) return null;

		const html = (await res.text()).slice(0, 400_000);
		const title = meta(html, 'og:title');

		return {
			url: res.url || target.toString(),
			iconUrl: meta(html, 'og:image'),
			// "RankFlo: AI Merchandising - ... | Shopify App Store" -> "RankFlo: AI Merchandising"
			title: title ? title.split(' - ')[0].replace(/\s*\|\s*Shopify App Store$/i, '').trim() : null,
			tagline: meta(html, 'og:description')
		};
	} catch {
		return null;
	}
}

/**
 * Best effort listing for an app we only know the name and slug of. Tries the
 * slug, then the name slugified, and gives up quietly.
 */
export async function findListing(slug: string, name?: string): Promise<Listing | null> {
	const candidates = new Set<string>([slug]);

	if (name) {
		candidates.add(
			name
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, '-')
				.replace(/^-+|-+$/g, '')
		);
		// "RankFlo: AI Merchandising" -> "rankflo"
		const firstWord = name.split(/[\s:—-]+/)[0];
		if (firstWord) candidates.add(firstWord.toLowerCase().replace(/[^a-z0-9]+/g, ''));
	}

	for (const candidate of candidates) {
		if (!candidate) continue;
		const listing = await fetchListing(guessListingUrl(candidate));
		if (listing) return listing;
	}

	return null;
}
