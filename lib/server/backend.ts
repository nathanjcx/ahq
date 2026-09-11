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
