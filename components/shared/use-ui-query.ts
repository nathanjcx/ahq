'use client';

import { type OptionalRestArgsOrSkip, useQuery } from 'convex/react';
import {
  type FunctionArgs,
  type FunctionReference,
  type FunctionReturnType,
  getFunctionName,
} from 'convex/server';
import { createContext, useContext } from 'react';

/**
 * Query answers for the fixture route, keyed by Convex function name ("projects:list"). A value may
 * be a function of the arguments so one entry can answer for several ids. Set by the QA shell only.
 */
export type FixtureQueries = Record<string, unknown>;

export const FixtureQueriesContext = createContext<FixtureQueries | null>(null);

/**
 * Whether the signed-in person has a workspace yet. Every page-owned query reads one, so before the
 * workspace exists they hold off instead of throwing "Create a workspace first" at the error boundary.
 * The shell sets it; outside the shell (tests, the fixture route) a workspace is assumed.
 */
export const WorkspaceReadyContext = createContext(true);

type Query = FunctionReference<'query'>;

/**
 * A page's own subscription. Live, it is `useQuery`; under the fixture route it answers from the
 * fixture instead, so the page can be photographed without a deployment. Pass 'skip' to hold off.
 */
export function useUiQuery<Q extends Query>(
  reference: Q,
  args: FunctionArgs<Q> | 'skip',
): FunctionReturnType<Q> | undefined {
  const fixtures = useContext(FixtureQueriesContext);
  const ready = useContext(WorkspaceReadyContext);
  const live = useQuery(
    reference,
    ...((fixtures || !ready ? ['skip'] : [args]) as OptionalRestArgsOrSkip<Q>),
  );
  if (!fixtures) return ready ? live : undefined;
  if (args === 'skip') return undefined;
  const answer = fixtures[getFunctionName(reference)];
  return typeof answer === 'function' ? (answer as (args: unknown) => unknown)(args) : answer;
}
