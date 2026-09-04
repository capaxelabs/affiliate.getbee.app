import type { DrizzleClient } from '$lib/server/db';
import type { SessionUser, Session } from '$lib/server/auth';

declare global {
	namespace App {
		interface Locals {
			db: DrizzleClient;
			user: SessionUser | null;
			session: Session | null;
		}
		interface Platform {
			env: Env;
			cf: CfProperties;
			ctx: ExecutionContext;
		}
		interface Error {
			code?: string;
		}
	}
}

export {};
