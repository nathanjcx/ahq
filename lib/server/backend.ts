import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import { requiredEnv } from './secrets';

/** Every Convex call a service makes. Production talks to Convex; tests inject convex-test. */
export interface Backend {
  query<T>(name: string, args?: Record<string, unknown>): Promise<T>;
  mutate<T>(name: string, args?: Record<string, unknown>): Promise<T>;
  /** Retries an idempotent journal write. Never wrap a provider call in this helper. */
  journalMutation<T>(name: string, args: Record<string, unknown>): Promise<T>;
}

export function convexBackend(): Backend {
  let client: ConvexHttpClient | undefined;
  const connect = () =>
    (client ??= new ConvexHttpClient(process.env.CONVEX_URL || requiredEnv('NEXT_PUBLIC_CONVEX_URL')));
  const withSecret = (args: Record<string, unknown> = {}) => ({
    ...args,
    secret: requiredEnv('AHQ_SERVICE_SECRET'),
  });
  const backend: Backend = {
    query: <T>(name: string, args?: Record<string, unknown>) =>
      connect().query(makeFunctionReference<'query'>(name), withSecret(args)) as Promise<T>,
    mutate: <T>(name: string, args?: Record<string, unknown>) =>
      connect().mutation(makeFunctionReference<'mutation'>(name), withSecret(args)) as Promise<T>,
    journalMutation: async <T>(name: string, args: Record<string, unknown>) => {
      let failure: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await backend.mutate<T>(name, args);
        } catch (error) {
          failure = error;
          if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
        }
      }
      throw failure;
    },
  };
  return backend;
}

let installed: Backend | undefined;

/**
 * A process talks to exactly one Convex deployment, so the backend is process state. Service entry
 * points keep the default; the gateway factory and the test harness install their own.
 */
export function installBackend(backend: Backend) {
  installed = backend;
}

export function backend(): Backend {
  return (installed ??= convexBackend());
}

export function query<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  return backend().query<T>(name, args);
}

export function mutate<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  return backend().mutate<T>(name, args);
}

export function journalMutation<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
  return backend().journalMutation<T>(name, args);
}
