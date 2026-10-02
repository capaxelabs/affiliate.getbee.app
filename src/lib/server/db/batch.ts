import type { BatchItem } from 'drizzle-orm/batch';
import type { DrizzleClient } from '.';

/**
 * Runs statements as D1 batches. A batch is one subrequest however many
 * statements it carries, which is what keeps per-row writes inside the Workers
 * cap. Chunked so one oversized batch cannot fail the whole write.
 */
export async function runBatch(db: DrizzleClient, statements: BatchItem<'sqlite'>[], size = 50) {
	for (let i = 0; i < statements.length; i += size) {
		const chunk = statements.slice(i, i + size);
		await db.batch(chunk as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
	}
}

/** Splits rows so a multi-row insert stays under D1's 100 bound parameters. */
export function chunkRows<T>(rows: T[], columns: number): T[][] {
	const size = Math.max(1, Math.floor(100 / columns));
	const out: T[][] = [];
	for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
	return out;
}
