import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import * as schema from './schema';

export type DrizzleClient = DrizzleD1Database<typeof schema>;

let cached: { binding: D1Database; db: DrizzleClient } | null = null;

export function initDb(binding: D1Database): DrizzleClient {
	if (cached?.binding === binding) return cached.db;
	const db = drizzle(binding, { schema });
	cached = { binding, db };
	return db;
}

export { schema };
