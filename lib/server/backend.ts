import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import { requiredEnv } from './secrets';
let client: ConvexHttpClient | undefined;
function getClient() {
  return (client ??= new ConvexHttpClient(process.env.CONVEX_URL || requiredEnv('NEXT_PUBLIC_CONVEX_URL')));
}
export async function query<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  return getClient().query(makeFunctionReference<'query'>(name), {
    ...args,
    secret: requiredEnv('AHQ_SERVICE_SECRET'),
  }) as Promise<T>;
}
export async function mutate<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  return getClient().mutation(makeFunctionReference<'mutation'>(name), {
    ...args,
    secret: requiredEnv('AHQ_SERVICE_SECRET'),
  }) as Promise<T>;
}

// Retry only idempotent journal writes. Never wrap a provider call in this helper.
export async function journalMutation(name: string, args: Record<string, unknown>) {
  let failure: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await mutate(name, args);
    } catch (error) {
      failure = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    }
  }
  throw failure;
}
