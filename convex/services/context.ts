import type { Doc, Id } from '../_generated/dataModel';
import { policiesFor } from '../registry';
import { authKey, canSeeConnection, type DbCtx } from '../shared';

export type ReadCtx = DbCtx;
export const terminalStatuses = ['completed', 'failed', 'cancelled', 'uncertain'];

export function isTerminal(status: string) {
  return terminalStatuses.includes(status);
}

export async function workspaceForActor(ctx: ReadCtx, subject: string, orgId?: string) {
  return ctx.db
    .query('workspaces')
    .withIndex('by_auth_key', (q) => q.eq('authKey', authKey(subject, orgId)))
    .unique();
}

export function versionAllows(version: Doc<'employeeVersions'>, providerId: string, tool: string) {
  return version.capabilities.some(
    (capability) => capability.provider === providerId && capability.tools.includes(tool),
  );
}

export function privateConnection(connection: Doc<'connections'>) {
  return {
    id: connection._id,
    provider: connection.provider,
    serverUrl: connection.serverUrl,
    status: connection.status,
    ownerSubject: connection.ownerSubject,
    allowedTools: connection.allowedTools,
    resourceScope: connection.resourceScope,
    credentialCiphertext: connection.credentialCiphertext,
    credentialKeyVersion: connection.credentialKeyVersion,
  };
}

/**
 * The live authorization for one task: its employee version, the connections its creator can still
 * reach intersected with the version's capability, and the policies for those providers.
 */
export async function activeTaskContext(ctx: ReadCtx, task: Doc<'tasks'>) {
  const version = await ctx.db.get(task.versionId);
  if (!version || version.retiredAt) throw new Error('Employee version is retired');
  const connections = await ctx.db
    .query('connections')
    .withIndex('by_workspace', (q) => q.eq('workspaceId', task.workspaceId))
    .collect();
  const visible = connections.filter(
    (connection) => connection.status === 'connected' && canSeeConnection(connection, task.createdBy),
  );
  for (const capability of version.capabilities) {
    if (capability.optional) continue;
    if (
      !visible.some(
        (connection) =>
          connection.provider === capability.provider &&
          capability.tools.every((tool: string) => connection.allowedTools.includes(tool)),
      )
    )
      throw new Error(`Required ${capability.provider} access is unavailable`);
  }
  const active = visible
    .map((connection) => {
      const versionTools = new Set(
        version.capabilities
          .filter((capability) => capability.provider === connection.provider)
          .flatMap((capability) => capability.tools),
      );
      return {
        ...connection,
        allowedTools: connection.allowedTools.filter((tool: string) => versionTools.has(tool)),
      };
    })
    .filter((connection) => connection.allowedTools.length > 0);
  const policies = await policiesFor(
    ctx,
    active.map((connection) => connection.provider),
  );
  return { version, connections: active, policies };
}

export async function taskInputState(ctx: ReadCtx, taskId: Id<'tasks'>) {
  const [latestStart, latestMessage, queued, leased] = await Promise.all([
    ctx.db
      .query('jobs')
      .withIndex('by_task_kind_created', (q) => q.eq('taskId', taskId).eq('kind', 'start_task'))
      .order('desc')
      .first(),
    ctx.db
      .query('jobs')
      .withIndex('by_task_kind_created', (q) => q.eq('taskId', taskId).eq('kind', 'send_message'))
      .order('desc')
      .first(),
    ctx.db
      .query('jobs')
      .withIndex('by_task_state', (q) => q.eq('taskId', taskId).eq('state', 'queued'))
      .collect(),
    ctx.db
      .query('jobs')
      .withIndex('by_task_state', (q) => q.eq('taskId', taskId).eq('state', 'leased'))
      .collect(),
  ]);
  const latestInput = [latestStart, latestMessage]
    .filter((job): job is Doc<'jobs'> => Boolean(job))
    .sort((a, b) => b.createdAt - a.createdAt || b._creationTime - a._creationTime)[0];
  return {
    inputRevision: latestInput ? String(latestInput._id) : '',
    pendingInput: [...queued, ...leased].some(
      (job) => job.kind === 'start_task' || job.kind === 'send_message',
    ),
  };
}

export async function taskForRunToken(ctx: ReadCtx, runToken: string) {
  const task = await ctx.db
    .query('tasks')
    .withIndex('by_run_token', (q) => q.eq('runToken', runToken))
    .unique();
  if (!task || isTerminal(task.status)) throw new Error('Task authorization is inactive');
  return task;
}
