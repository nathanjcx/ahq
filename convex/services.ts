import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { authKey, requireService, sha256, stableJson } from './shared';

const provider = v.union(
  v.literal('linear'),
  v.literal('slack'),
  v.literal('github'),
  v.literal('salesforce'),
  v.literal('servicenow'),
  v.literal('google-workspace'),
  v.literal('canva'),
);
const correction = v.union(
  v.literal('supported'),
  v.literal('partial'),
  v.literal('manual'),
  v.literal('irreversible'),
  v.literal('unknown'),
);
const taskStatus = v.union(
  v.literal('queued'),
  v.literal('running'),
  v.literal('awaiting_approval'),
  v.literal('completed'),
  v.literal('failed'),
  v.literal('cancelled'),
  v.literal('uncertain'),
);

async function workspaceForActor(ctx: any, subject: string, orgId?: string) {
  return ctx.db
    .query('workspaces')
    .withIndex('by_auth_key', (q: any) => q.eq('authKey', authKey(subject, orgId)))
    .unique();
}

function connectionVisibleToTask(connection: any, task: any) {
  return connection.ownerSubject === task.createdBy || connection.visibleToSubjects.includes(task.createdBy);
}

function versionAllows(version: any, providerId: string, tool: string) {
  return version.capabilities.some(
    (capability: any) => capability.provider === providerId && capability.tools.includes(tool),
  );
}

function privateConnection(connection: any) {
  return {
    id: connection._id,
    provider: connection.provider,
    name: connection.name,
    account: connection.account,
    status: connection.status,
    tools: connection.tools,
    allowedTools: connection.allowedTools,
    resourceScope: connection.resourceScope,
    inboxMode: connection.inboxMode,
    serverUrl: connection.serverUrl,
    credentialCiphertext: connection.credentialCiphertext,
    credentialKeyVersion: connection.credentialKeyVersion,
    ownerSubject: connection.ownerSubject,
    visibleToSubjects: connection.visibleToSubjects,
  };
}

function assertApprovedServerUrl(providerId: string, serverUrl: string) {
  let url: URL;
  try {
    url = new URL(serverUrl);
  } catch {
    throw new Error('Invalid MCP server URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('MCP server URL must use HTTPS without embedded credentials');
  let configured: Record<string, string[]>;
  try {
    configured = JSON.parse(process.env.MCP_SERVER_URLS_JSON || '{}');
  } catch {
    throw new Error('MCP_SERVER_URLS_JSON is invalid');
  }
  const approved = configured[providerId] || [];
  if (!approved.includes(url.toString())) throw new Error('MCP server URL is not in the approved registry');
}

async function activeTaskContext(ctx: any, task: any) {
  const version = await ctx.db.get(task.versionId);
  if (!version || version.retiredAt) throw new Error('Employee version is retired');
  const connections = await ctx.db
    .query('connections')
    .withIndex('by_workspace', (q: any) => q.eq('workspaceId', task.workspaceId))
    .collect();
  const visible = connections.filter(
    (connection: any) => connection.status === 'connected' && connectionVisibleToTask(connection, task),
  );
  for (const capability of version.capabilities) {
    if (capability.optional) continue;
    if (
      !visible.some(
        (connection: any) =>
          connection.provider === capability.provider &&
          capability.tools.every((tool: string) => connection.allowedTools.includes(tool)),
      )
    ) {
      throw new Error(`Required ${capability.provider} access is unavailable`);
    }
  }
  const active = visible
    .map((connection: any) => {
      const versionTools = new Set(
        version.capabilities
          .filter((capability: any) => capability.provider === connection.provider)
          .flatMap((capability: any) => capability.tools),
      );
      return {
        ...connection,
        allowedTools: connection.allowedTools.filter((tool: string) => versionTools.has(tool)),
      };
    })
    .filter((connection: any) => connection.allowedTools.length > 0);
  return { version, connections: active };
}

async function releaseReservation(ctx: any, task: any) {
  if (task.budgetFinalized) return;
  const workspace = await ctx.db.get(task.workspaceId);
  if (workspace)
    await ctx.db.patch(workspace._id, {
      reserved: Math.max(0, workspace.reserved - task.reservedCost),
    });
  await ctx.db.patch(task._id, { budgetFinalized: true });
}

export const workerState = query({
  args: { secret: v.string() },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const [queued, leased, queuedTasks, running, awaitingApproval, signal] = await Promise.all([
      ctx.db
        .query('jobs')
        .withIndex('by_state_available', (q: any) => q.eq('state', 'queued'))
        .take(100),
      ctx.db
        .query('jobs')
        .withIndex('by_state_available', (q: any) => q.eq('state', 'leased'))
        .take(100),
      ctx.db
        .query('tasks')
        .withIndex('by_status', (q: any) => q.eq('status', 'queued'))
        .take(500),
      ctx.db
        .query('tasks')
        .withIndex('by_status', (q: any) => q.eq('status', 'running'))
        .take(500),
      ctx.db
        .query('tasks')
        .withIndex('by_status', (q: any) => q.eq('status', 'awaiting_approval'))
        .take(500),
      ctx.db
        .query('workerSignals')
        .withIndex('by_name', (q: any) => q.eq('name', 'jobs'))
        .unique(),
    ]);
    return {
      pendingJobs: queued.length + leased.length,
      queuedJobIds: queued.slice(0, 100).map((job: any) => String(job._id)),
      activeTaskIds: [...queuedTasks, ...running, ...awaitingApproval]
        .filter((task: any) => task.sessionId)
        .map((task: any) => String(task._id)),
      nextAvailableAt: queued.reduce(
        (next: number | undefined, job: any) =>
          next === undefined ? job.availableAt : Math.min(next, job.availableAt),
        undefined,
      ),
      wakeRevision: signal?.revision || 0,
    };
  },
});

export const claimJobs = mutation({
  args: { secret: v.string(), workerId: v.string(), limit: v.number() },
  handler: async (ctx, args) => {
    requireService(args.secret);
    if (!args.workerId.trim()) throw new Error('workerId is required');
    const now = Date.now();
    const [expiredJobs, fresh] = await Promise.all([
      ctx.db
        .query('jobs')
        .withIndex('by_state_lease_expiration', (q: any) => q.eq('state', 'leased').lt('leaseExpiresAt', now))
        .take(50),
      ctx.db
        .query('jobs')
        .withIndex('by_state_available', (q: any) => q.eq('state', 'queued').lte('availableAt', now))
        .take(50),
    ]);
    const recovered: any[] = [];
    for (const job of expiredJobs) {
      if (job.kind === 'execute_action') {
        await ctx.db.patch(job._id, {
          state: 'failed',
          error: 'Lease expired after external action dispatch may have begun',
          updatedAt: now,
        });
        if (job.proposalId) {
          const proposal = await ctx.db.get(job.proposalId);
          if (proposal && proposal.status === 'executing') {
            await ctx.db.patch(proposal._id, {
              status: 'uncertain',
              result: 'Worker lease expired while the external result was unknown',
            });
            await ctx.db.insert('actionTransitions', {
              workspaceId: proposal.workspaceId,
              proposalId: proposal._id,
              from: 'executing',
              to: 'uncertain',
              actor: 'worker',
              at: now,
              detail: 'Lease expired',
            });
            const task = await ctx.db.get(proposal.taskId);
            if (task) {
              await releaseReservation(ctx, task);
              await ctx.db.patch(task._id, {
                status: 'uncertain',
                error: 'An external action may have completed, so it was not retried',
                updatedAt: now,
              });
            }
          }
        }
      } else {
        await ctx.db.patch(job._id, {
          state: 'queued',
          leaseOwner: undefined,
          leaseToken: undefined,
          leaseExpiresAt: undefined,
          availableAt: now,
          updatedAt: now,
        });
        recovered.push({ ...job, state: 'queued', availableAt: now });
      }
    }
    const candidates = [...fresh, ...recovered]
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, Math.max(0, Math.min(50, Math.floor(args.limit))));
    const output = [];
    for (const job of candidates) {
      const leaseToken = crypto.randomUUID();
      const attempts = job.attempts + 1;
      await ctx.db.patch(job._id, {
        state: 'leased',
        attempts,
        leaseOwner: args.workerId,
        leaseToken,
        leaseExpiresAt: now + 60_000,
        updatedAt: now,
      });
      if (job.kind === 'execute_action' && job.proposalId) {
        const proposal = await ctx.db.get(job.proposalId);
        if (!proposal || proposal.status !== 'approved') {
          await ctx.db.patch(job._id, {
            state: 'failed',
            error: 'Action is no longer approved',
            updatedAt: now,
          });
          continue;
        }
        await ctx.db.patch(proposal._id, { status: 'executing' });
        await ctx.db.insert('actionTransitions', {
          workspaceId: proposal.workspaceId,
          proposalId: proposal._id,
          from: 'approved',
          to: 'executing',
          actor: args.workerId,
          at: now,
        });
      } else if (job.kind === 'start_task' || job.kind === 'send_message') {
        const task = await ctx.db.get(job.taskId);
        if (task && task.status !== 'cancelled')
          await ctx.db.patch(task._id, { status: 'running', updatedAt: now });
      }
      let payload: unknown = job.payload;
      try {
        payload = JSON.parse(job.payload);
      } catch {
        /* Old jobs may contain plain text. */
      }
      output.push({ id: job._id, kind: job.kind, taskId: job.taskId, payload, leaseToken, attempts });
    }
    return output;
  },
});

export const renewLease = mutation({
  args: { secret: v.string(), jobId: v.id('jobs'), leaseToken: v.string() },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const job = await ctx.db.get(args.jobId);
    if (!job || job.state !== 'leased' || job.leaseToken !== args.leaseToken)
      throw new Error('Job lease is no longer valid');
    await ctx.db.patch(job._id, { leaseExpiresAt: Date.now() + 60_000, updatedAt: Date.now() });
    return null;
  },
});

export const claimStream = mutation({
  args: { secret: v.string(), taskId: v.id('tasks'), workerId: v.string() },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const task = await ctx.db.get(args.taskId);
    if (!task || !task.sessionId || !['queued', 'running', 'awaiting_approval'].includes(task.status))
      return { claimed: false as const };
    const now = Date.now();
    if (task.streamOwner && task.streamOwner !== args.workerId && (task.streamLeaseExpiresAt || 0) > now)
      return { claimed: false as const, leaseExpiresAt: task.streamLeaseExpiresAt };
    const leaseExpiresAt = now + 120_000;
    await ctx.db.patch(task._id, { streamOwner: args.workerId, streamLeaseExpiresAt: leaseExpiresAt });
    return { claimed: true as const, leaseExpiresAt };
  },
});

export const completeJob = mutation({
  args: { secret: v.string(), jobId: v.id('jobs'), leaseToken: v.string(), result: v.optional(v.string()) },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const job = await ctx.db.get(args.jobId);
    if (!job || job.state !== 'leased' || job.leaseToken !== args.leaseToken)
      throw new Error('Job lease is no longer valid');
    if (job.kind === 'execute_action' && job.proposalId) {
      const proposal = await ctx.db.get(job.proposalId);
      if (proposal && proposal.status === 'executing')
        throw new Error('Record the external action result before completing its job');
    }
    await ctx.db.patch(job._id, {
      state: 'completed',
      result: args.result,
      leaseOwner: undefined,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const failJob = mutation({
  args: {
    secret: v.string(),
    jobId: v.id('jobs'),
    leaseToken: v.string(),
    error: v.string(),
    outcomeUnknown: v.optional(v.boolean()),
    retryable: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const job = await ctx.db.get(args.jobId);
    if (!job || job.state !== 'leased' || job.leaseToken !== args.leaseToken)
      throw new Error('Job lease is no longer valid');
    const now = Date.now();
    const canRetry = job.kind !== 'execute_action' && args.retryable === true && job.attempts < 3;
    await ctx.db.patch(
      job._id,
      canRetry
        ? {
            state: 'queued',
            error: args.error,
            availableAt: now + Math.min(60_000, 1_000 * 2 ** job.attempts),
            leaseOwner: undefined,
            leaseToken: undefined,
            leaseExpiresAt: undefined,
            updatedAt: now,
          }
        : {
            state: 'failed',
            error: args.error,
            leaseOwner: undefined,
            leaseToken: undefined,
            leaseExpiresAt: undefined,
            updatedAt: now,
          },
    );
    if (!canRetry) {
      const task = await ctx.db.get(job.taskId);
      if (task && task.status !== 'cancelled') {
        await releaseReservation(ctx, task);
        await ctx.db.patch(task._id, {
          status: args.outcomeUnknown ? 'uncertain' : 'failed',
          error: args.error,
          updatedAt: now,
        });
      }
      if (job.proposalId) {
        const proposal = await ctx.db.get(job.proposalId);
        if (proposal && proposal.status === 'executing') {
          const status = args.outcomeUnknown ? 'uncertain' : 'failed';
          await ctx.db.patch(proposal._id, { status, result: args.error });
          await ctx.db.insert('actionTransitions', {
            workspaceId: proposal.workspaceId,
            proposalId: proposal._id,
            from: 'executing',
            to: status,
            actor: 'worker',
            at: now,
            detail: args.error,
          });
        }
      }
    }
    return null;
  },
});

export const taskContext = query({
  args: { secret: v.string(), taskId: v.id('tasks') },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error('Task not found');
    const { version, connections } = await activeTaskContext(ctx, task);
    return {
      task: {
        id: task._id,
        workspaceId: task.workspaceId,
        employeeId: task.employeeId,
        title: task.title,
        prompt: task.prompt,
        status: task.status,
        sessionId: task.sessionId,
        model: task.model,
        createdBy: task.createdBy,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      },
      employeeVersion: {
        id: version._id,
        version: version.version,
        model: version.model,
        instructions: version.instructions,
        skills: version.skills,
        capabilities: version.capabilities,
      },
      connections: connections.map(privateConnection),
      runToken: task.runToken,
      authorization: { workspaceId: task.workspaceId, userId: task.createdBy },
    };
  },
});

export const recordSession = mutation({
  args: {
    secret: v.string(),
    taskId: v.id('tasks'),
    sessionId: v.string(),
    leaseToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error('Task not found');
    if (task.sessionId && task.sessionId !== args.sessionId)
      throw new Error('Task already has a different session');
    await ctx.db.patch(task._id, {
      sessionId: args.sessionId,
      status: task.status === 'cancelled' ? 'cancelled' : 'running',
      updatedAt: Date.now(),
    });
    if (args.leaseToken) {
      const jobs = await ctx.db
        .query('jobs')
        .withIndex('by_task_state', (q: any) => q.eq('taskId', task._id).eq('state', 'leased'))
        .collect();
      const job = jobs.find((candidate: any) => candidate.leaseToken === args.leaseToken);
      if (!job || !job.leaseExpiresAt || job.leaseExpiresAt <= Date.now())
        throw new Error('Job lease is no longer valid');
    }
    return null;
  },
});

export const recordEvents = mutation({
  args: {
    secret: v.string(),
    taskId: v.id('tasks'),
    events: v.array(
      v.object({
        externalId: v.string(),
        sequence: v.optional(v.number()),
        type: v.string(),
        text: v.string(),
        createdAt: v.number(),
        gap: v.optional(v.boolean()),
        employeeName: v.optional(v.string()),
      }),
    ),
    messages: v.optional(
      v.array(
        v.object({
          externalId: v.optional(v.string()),
          itemId: v.optional(v.string()),
          role: v.union(v.literal('user'), v.literal('assistant'), v.literal('system')),
          text: v.string(),
          createdAt: v.number(),
          phase: v.optional(v.string()),
          completed: v.optional(v.boolean()),
        }),
      ),
    ),
    usage: v.optional(
      v.object({
        externalId: v.optional(v.string()),
        input: v.number(),
        output: v.number(),
        cached: v.number(),
        estimatedCost: v.number(),
      }),
    ),
    status: v.optional(taskStatus),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireService(args.secret);
    if (args.events.length > 200 || (args.messages?.length || 0) > 100)
      throw new Error('Event batch is too large');
    if (
      args.events.some(
        (event) => event.externalId.length > 500 || event.type.length > 200 || event.text.length > 100_000,
      ) ||
      args.messages?.some((message) => message.text.length > 100_000)
    )
      throw new Error('Event payload is too large');
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error('Task not found');
    const workspace = await ctx.db.get(task.workspaceId);
    if (!workspace) throw new Error('Workspace not found');
    let sequence = workspace.nextSequence;
    let inserted = 0;
    for (const event of args.events) {
      const existing = await ctx.db
        .query('events')
        .withIndex('by_task_external', (q: any) =>
          q.eq('taskId', task._id).eq('externalId', event.externalId),
        )
        .unique();
      if (existing) continue;
      sequence += 1;
      await ctx.db.insert('events', {
        workspaceId: task.workspaceId,
        taskId: task._id,
        externalId: event.externalId,
        sequence,
        type: event.type,
        text: event.text,
        createdAt: event.createdAt,
        gap: event.gap,
        employeeName: event.employeeName || task.employeeName,
      });
      inserted += 1;
    }
    if (inserted) await ctx.db.patch(workspace._id, { nextSequence: sequence });
    for (const message of args.messages || []) {
      const externalId = message.externalId || message.itemId;
      if (!externalId) throw new Error('Message externalId is required');
      const existing = await ctx.db
        .query('messages')
        .withIndex('by_task_external', (q: any) => q.eq('taskId', task._id).eq('externalId', externalId))
        .unique();
      if (!existing) {
        await ctx.db.insert('messages', {
          workspaceId: task.workspaceId,
          taskId: task._id,
          externalId,
          role: message.role,
          text: message.text,
          createdAt: message.createdAt,
          phase: message.phase,
          completed: message.completed,
        });
      } else if (!existing.completed) {
        await ctx.db.patch(existing._id, {
          text: message.text,
          phase: message.phase,
          completed: message.completed,
          createdAt: message.createdAt,
        });
      }
    }
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    let costDelta = 0;
    if (args.usage) {
      const current = task.usage || { input: 0, output: 0, cached: 0, estimatedCost: 0 };
      if (args.usage.externalId) {
        const prior = await ctx.db
          .query('usageReports')
          .withIndex('by_task_external', (q: any) =>
            q.eq('taskId', task._id).eq('externalId', args.usage!.externalId!),
          )
          .unique();
        if (!prior) {
          costDelta = Math.max(0, args.usage.estimatedCost);
          await ctx.db.insert('usageReports', {
            workspaceId: task.workspaceId,
            taskId: task._id,
            externalId: args.usage.externalId,
            input: args.usage.input,
            output: args.usage.output,
            cached: args.usage.cached,
            estimatedCost: args.usage.estimatedCost,
            createdAt: Date.now(),
          });
          patch.usage = {
            input: current.input + args.usage.input,
            output: current.output + args.usage.output,
            cached: current.cached + args.usage.cached,
            estimatedCost: current.estimatedCost + args.usage.estimatedCost,
          };
        }
      } else {
        costDelta = Math.max(0, args.usage.estimatedCost - current.estimatedCost);
        patch.usage = {
          input: Math.max(current.input, args.usage.input),
          output: Math.max(current.output, args.usage.output),
          cached: Math.max(current.cached, args.usage.cached),
          estimatedCost: Math.max(current.estimatedCost, args.usage.estimatedCost),
        };
      }
    }
    if (costDelta) await ctx.db.patch(workspace._id, { spent: workspace.spent + costDelta });
    if (args.status) {
      let nextStatus = args.status;
      if (args.status === 'completed') {
        if (task.status === 'cancelled' || task.status === 'uncertain') nextStatus = task.status;
        else {
          const [activeProposals, queuedJobs, leasedJobs] = await Promise.all([
            ctx.db
              .query('proposals')
              .withIndex('by_task_status', (q: any) => q.eq('taskId', task._id))
              .collect(),
            ctx.db
              .query('jobs')
              .withIndex('by_task_state', (q: any) => q.eq('taskId', task._id).eq('state', 'queued'))
              .collect(),
            ctx.db
              .query('jobs')
              .withIndex('by_task_state', (q: any) => q.eq('taskId', task._id).eq('state', 'leased'))
              .collect(),
          ]);
          if (
            activeProposals.some((proposal: any) =>
              ['pending', 'approved', 'executing'].includes(proposal.status),
            )
          )
            nextStatus = 'awaiting_approval';
          else if ([...queuedJobs, ...leasedJobs].some((job: any) => job.kind === 'send_message'))
            nextStatus = task.status === 'queued' ? 'queued' : 'running';
        }
      }
      patch.status = nextStatus;
    }
    if (args.error !== undefined) patch.error = args.error;
    const terminal =
      patch.status && ['completed', 'failed', 'cancelled', 'uncertain'].includes(String(patch.status));
    if (terminal && !task.budgetFinalized) {
      await ctx.db.patch(workspace._id, {
        reserved: Math.max(0, workspace.reserved - task.reservedCost),
      });
      patch.budgetFinalized = true;
    }
    if (terminal) {
      patch.streamOwner = undefined;
      patch.streamLeaseExpiresAt = undefined;
    }
    await ctx.db.patch(task._id, patch);
    return { inserted, lastSequence: sequence };
  },
});

export const connectIntegration = mutation({
  args: {
    secret: v.string(),
    authSubject: v.string(),
    authOrgId: v.optional(v.string()),
    provider,
    name: v.string(),
    account: v.string(),
    tools: v.array(v.string()),
    allowedTools: v.array(v.string()),
    resourceScope: v.string(),
    inboxMode: v.union(v.literal('push'), v.literal('on-demand'), v.literal('unsupported')),
    serverUrl: v.string(),
    credentialCiphertext: v.string(),
    credentialKeyVersion: v.string(),
    visibleToSubjects: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const workspace = await workspaceForActor(ctx, args.authSubject, args.authOrgId);
    if (!workspace) throw new Error('Workspace not found');
    assertApprovedServerUrl(args.provider, args.serverUrl);
    if (!args.credentialCiphertext || args.credentialCiphertext.length > 100_000)
      throw new Error('Encrypted credential is missing or too large');
    if (args.allowedTools.some((tool) => !args.tools.includes(tool)))
      throw new Error('Allowed tools must be discovered first');
    const owned = await ctx.db
      .query('connections')
      .withIndex('by_owner', (q: any) => q.eq('ownerSubject', args.authSubject))
      .collect();
    const existing = owned.find(
      (connection: any) =>
        connection.workspaceId === workspace._id &&
        connection.provider === args.provider &&
        connection.serverUrl === args.serverUrl &&
        connection.account === args.account,
    );
    const values = {
      workspaceId: workspace._id,
      ownerSubject: args.authSubject,
      visibleToSubjects: args.visibleToSubjects || [],
      provider: args.provider,
      name: args.name,
      account: args.account,
      status: 'connected' as const,
      tools: [...new Set(args.tools)],
      allowedTools: [...new Set(args.allowedTools)],
      resourceScope: args.resourceScope,
      inboxMode: args.inboxMode,
      serverUrl: args.serverUrl,
      credentialCiphertext: args.credentialCiphertext,
      credentialKeyVersion: args.credentialKeyVersion,
      lastCheckedAt: Date.now(),
      error: undefined,
    };
    if (existing) {
      await ctx.db.patch(existing._id, values);
      return { connectionId: existing._id };
    }
    const connectionId = await ctx.db.insert('connections', { ...values, createdAt: Date.now() });
    return { connectionId };
  },
});

export const refreshCredential = mutation({
  args: {
    secret: v.string(),
    connectionId: v.id('connections'),
    credentialCiphertext: v.string(),
    credentialKeyVersion: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const connection = await ctx.db.get(args.connectionId);
    if (!connection || connection.status === 'revoked') throw new Error('Connection not found');
    await ctx.db.patch(connection._id, {
      credentialCiphertext: args.credentialCiphertext,
      credentialKeyVersion: args.credentialKeyVersion || connection.credentialKeyVersion,
      lastCheckedAt: Date.now(),
      error: undefined,
    });
    return null;
  },
});

export const connectionContext = query({
  args: { secret: v.string(), connectionId: v.id('connections') },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const connection = await ctx.db.get(args.connectionId);
    if (!connection || connection.status === 'revoked') throw new Error('Connection not found');
    return {
      connection: privateConnection(connection),
      authorization: {
        workspaceId: connection.workspaceId,
        ownerSubject: connection.ownerSubject,
        visibleToSubjects: connection.visibleToSubjects,
      },
    };
  },
});

export const gatewayContext = query({
  args: { secret: v.string(), runToken: v.string() },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const task = await ctx.db
      .query('tasks')
      .withIndex('by_run_token', (q: any) => q.eq('runToken', args.runToken))
      .unique();
    if (!task || ['cancelled', 'failed', 'uncertain'].includes(task.status))
      throw new Error('Task authorization is inactive');
    const { version, connections } = await activeTaskContext(ctx, task);
    return {
      task: { id: task._id, workspaceId: task.workspaceId, status: task.status, createdBy: task.createdBy },
      employeeVersion: { id: version._id, capabilities: version.capabilities },
      connections: connections.map(privateConnection),
    };
  },
});

export const proposeAction = mutation({
  args: {
    secret: v.string(),
    runToken: v.string(),
    connectionId: v.id('connections'),
    tool: v.string(),
    arguments: v.any(),
    summary: v.string(),
    correction,
    correctionReason: v.string(),
    beforeState: v.optional(v.any()),
    providerRequestId: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const task = await ctx.db
      .query('tasks')
      .withIndex('by_run_token', (q: any) => q.eq('runToken', args.runToken))
      .unique();
    if (!task || ['completed', 'cancelled', 'failed', 'uncertain'].includes(task.status))
      throw new Error('Task authorization is inactive');
    const { version, connections } = await activeTaskContext(ctx, task);
    const connection = connections.find((item: any) => item._id === args.connectionId);
    if (
      !connection ||
      !connection.allowedTools.includes(args.tool) ||
      !versionAllows(version, connection.provider, args.tool)
    )
      throw new Error('Tool is not authorized for this task');
    const normalizedArguments = stableJson(args.arguments);
    if (
      normalizedArguments.length > 100_000 ||
      args.summary.length > 2_000 ||
      args.correctionReason.length > 2_000
    )
      throw new Error('Action proposal is too large');
    if (args.beforeState !== undefined && stableJson(args.beforeState).length > 100_000)
      throw new Error('Action before-state is too large');
    const argumentsHash = await sha256(normalizedArguments);
    const dedupeKey = args.idempotencyKey
      ? `gateway:${task._id}:${args.idempotencyKey}`
      : `gateway:${task._id}:${connection._id}:${args.tool}:${argumentsHash}`;
    const existing = await ctx.db
      .query('proposals')
      .withIndex('by_dedupe', (q: any) => q.eq('dedupeKey', dedupeKey))
      .unique();
    if (existing) return { proposalId: existing._id, status: existing.status };
    const now = Date.now();
    const proposalId = await ctx.db.insert('proposals', {
      workspaceId: task.workspaceId,
      taskId: task._id,
      connectionId: connection._id,
      employeeName: task.employeeName,
      provider: connection.provider,
      tool: args.tool,
      arguments: normalizedArguments,
      argumentsHash,
      dedupeKey,
      summary: args.summary,
      status: 'pending',
      correction: args.correction,
      correctionReason: args.correctionReason,
      beforeState: args.beforeState === undefined ? undefined : stableJson(args.beforeState),
      proposedBy: 'agent',
      providerRequestId: args.providerRequestId,
      createdAt: now,
    });
    await ctx.db.insert('actionTransitions', {
      workspaceId: task.workspaceId,
      proposalId,
      to: 'pending',
      actor: 'agent',
      at: now,
    });
    await ctx.db.patch(task._id, { status: 'awaiting_approval', updatedAt: now });
    return { proposalId, status: 'pending' as const };
  },
});

export const actionContext = query({
  args: { secret: v.string(), proposalId: v.id('proposals'), leaseToken: v.string() },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const proposal = await ctx.db.get(args.proposalId);
    if (!proposal || proposal.status !== 'executing') throw new Error('Action is not executable');
    const job = await ctx.db
      .query('jobs')
      .withIndex('by_unique_key', (q: any) => q.eq('uniqueKey', `action:${proposal._id}`))
      .unique();
    if (
      !job ||
      job.state !== 'leased' ||
      job.leaseToken !== args.leaseToken ||
      !job.leaseExpiresAt ||
      job.leaseExpiresAt <= Date.now()
    )
      throw new Error('Action lease is no longer valid');
    const task = await ctx.db.get(proposal.taskId);
    if (!task || ['cancelled', 'failed', 'uncertain'].includes(task.status))
      throw new Error('Task authorization is inactive');
    const { version, connections } = await activeTaskContext(ctx, task);
    const connection = connections.find((item: any) => item._id === proposal.connectionId);
    if (
      !connection ||
      !connection.allowedTools.includes(proposal.tool) ||
      !versionAllows(version, proposal.provider, proposal.tool)
    )
      throw new Error('The approved tool grant has been revoked');
    const original = proposal.originalActionId ? await ctx.db.get(proposal.originalActionId) : null;
    return {
      action: {
        id: proposal._id,
        taskId: task._id,
        tool: proposal.tool,
        arguments: proposal.arguments,
        argumentsHash: proposal.argumentsHash,
        summary: proposal.summary,
        beforeState: proposal.beforeState,
        correction: proposal.correction,
        originalActionId: proposal.originalActionId,
        approvedBy: proposal.approvedBy,
        approvedAt: proposal.approvedAt,
      },
      original: original
        ? {
            id: original._id,
            tool: original.tool,
            arguments: original.arguments,
            beforeState: original.beforeState,
            afterState: original.afterState,
          }
        : undefined,
      connection: privateConnection(connection),
      task: {
        id: task._id,
        workspaceId: task.workspaceId,
        runToken: task.runToken,
        createdBy: task.createdBy,
      },
      employeeVersionId: version._id,
    };
  },
});

export const recordActionResult = mutation({
  args: {
    secret: v.string(),
    proposalId: v.id('proposals'),
    leaseToken: v.string(),
    status: v.union(v.literal('succeeded'), v.literal('failed'), v.literal('uncertain')),
    result: v.optional(v.string()),
    afterState: v.optional(v.any()),
    providerRequestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const proposal = await ctx.db.get(args.proposalId);
    if (!proposal || proposal.status !== 'executing') throw new Error('Action is not executing');
    const job = await ctx.db
      .query('jobs')
      .withIndex('by_unique_key', (q: any) => q.eq('uniqueKey', `action:${proposal._id}`))
      .unique();
    if (!job || job.state !== 'leased' || job.leaseToken !== args.leaseToken)
      throw new Error('Action lease is no longer valid');
    const now = Date.now();
    await ctx.db.patch(proposal._id, {
      status: args.status,
      result: args.result,
      afterState: args.afterState === undefined ? undefined : stableJson(args.afterState),
      providerRequestId: args.providerRequestId || proposal.providerRequestId,
    });
    await ctx.db.insert('actionTransitions', {
      workspaceId: proposal.workspaceId,
      proposalId: proposal._id,
      from: 'executing',
      to: args.status,
      actor: 'worker',
      at: now,
      detail: args.result,
    });
    await ctx.db.patch(job._id, {
      state: 'completed',
      result: args.result,
      leaseOwner: undefined,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      updatedAt: now,
    });
    if (proposal.originalActionId && args.status === 'succeeded') {
      const original = await ctx.db.get(proposal.originalActionId);
      if (original) {
        await ctx.db.patch(original._id, { status: 'corrected' });
        await ctx.db.insert('actionTransitions', {
          workspaceId: proposal.workspaceId,
          proposalId: original._id,
          from: original.status,
          to: 'corrected',
          actor: 'worker',
          at: now,
          detail: `Correction ${proposal._id} succeeded`,
        });
      }
    }
    const task = await ctx.db.get(proposal.taskId);
    if (task) {
      if (args.status === 'uncertain') {
        await ctx.db.patch(task._id, {
          status: 'uncertain',
          error: 'External action outcome is unknown',
          updatedAt: now,
        });
      } else {
        const uniqueKey = `action-result:${proposal._id}:${args.status}`;
        const existing = await ctx.db
          .query('jobs')
          .withIndex('by_unique_key', (q: any) => q.eq('uniqueKey', uniqueKey))
          .unique();
        if (!existing) {
          const text =
            args.status === 'succeeded'
              ? `The approved action succeeded: ${proposal.summary}.${args.result ? ` Result: ${args.result}` : ''}`
              : `The approved action failed: ${proposal.summary}.${args.result ? ` Error: ${args.result}` : ''}`;
          await ctx.db.insert('jobs', {
            workspaceId: proposal.workspaceId,
            taskId: task._id,
            uniqueKey,
            kind: 'send_message',
            payload: JSON.stringify({ text }),
            state: 'queued',
            attempts: 0,
            availableAt: now,
            createdAt: now,
            updatedAt: now,
          });
        }
        await ctx.db.patch(task._id, { status: 'queued', updatedAt: now });
      }
    }
    return null;
  },
});

export const ingestInbox = mutation({
  args: {
    secret: v.string(),
    connectionId: v.id('connections'),
    items: v.array(
      v.object({
        externalId: v.string(),
        title: v.string(),
        preview: v.string(),
        sourceUrl: v.optional(v.string()),
        createdAt: v.number(),
        visibilitySubjects: v.optional(v.array(v.string())),
      }),
    ),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireService(args.secret);
    if (
      args.items.length > 200 ||
      args.items.some((item) => item.title.length > 500 || item.preview.length > 20_000)
    )
      throw new Error('Inbox batch is too large');
    const connection = await ctx.db.get(args.connectionId);
    if (!connection || connection.status !== 'connected') throw new Error('Connection is inactive');
    let inserted = 0;
    for (const item of args.items) {
      const existing = await ctx.db
        .query('inbox')
        .withIndex('by_connection_external', (q: any) =>
          q.eq('connectionId', connection._id).eq('externalId', item.externalId),
        )
        .unique();
      const requested = item.visibilitySubjects || [];
      const visibleToSubjects = requested.filter(
        (subject) => subject === connection.ownerSubject || connection.visibleToSubjects.includes(subject),
      );
      if (existing) {
        await ctx.db.patch(existing._id, {
          title: item.title,
          preview: item.preview,
          sourceUrl: item.sourceUrl,
          createdAt: item.createdAt,
          visibleToSubjects,
        });
      } else {
        await ctx.db.insert('inbox', {
          workspaceId: connection.workspaceId,
          connectionId: connection._id,
          ownerSubject: connection.ownerSubject,
          visibleToSubjects,
          externalId: item.externalId,
          provider: connection.provider,
          title: item.title,
          preview: item.preview,
          sourceUrl: item.sourceUrl,
          createdAt: item.createdAt,
          status: 'unread',
        });
        inserted += 1;
      }
    }
    await ctx.db.patch(connection._id, {
      cursor: args.cursor === undefined ? connection.cursor : args.cursor,
      lastCheckedAt: Date.now(),
      error: undefined,
    });
    return { inserted };
  },
});

export const recordArtifact = mutation({
  args: {
    secret: v.string(),
    taskId: v.id('tasks'),
    name: v.string(),
    mediaType: v.string(),
    size: v.number(),
    storageKey: v.string(),
    sha256: v.string(),
  },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error('Task not found');
    const existing = (
      await ctx.db
        .query('artifacts')
        .withIndex('by_task', (q: any) => q.eq('taskId', task._id))
        .collect()
    ).find((artifact: any) => artifact.storageKey === args.storageKey && artifact.sha256 === args.sha256);
    if (existing) return { artifactId: existing._id };
    const artifactId = await ctx.db.insert('artifacts', {
      workspaceId: task.workspaceId,
      taskId: task._id,
      name: args.name,
      mediaType: args.mediaType,
      size: args.size,
      storageKey: args.storageKey,
      sha256: args.sha256,
      createdAt: Date.now(),
    });
    return { artifactId };
  },
});

export const recordToolCall = mutation({
  args: {
    secret: v.string(),
    runToken: v.string(),
    connectionId: v.id('connections'),
    tool: v.string(),
    argumentsCiphertext: v.string(),
    resultCiphertext: v.optional(v.string()),
    outcome: v.union(v.literal('started'), v.literal('succeeded'), v.literal('failed')),
    operationId: v.string(),
    sha256: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireService(args.secret);
    if (!args.operationId.trim()) throw new Error('operationId is required');
    if (args.argumentsCiphertext.length > 100_000 || (args.resultCiphertext?.length || 0) > 100_000)
      throw new Error('Tool-call evidence exceeds 100 KB; store it externally and journal its digest');
    const task = await ctx.db
      .query('tasks')
      .withIndex('by_run_token', (q: any) => q.eq('runToken', args.runToken))
      .unique();
    if (!task || ['cancelled', 'failed', 'uncertain'].includes(task.status))
      throw new Error('Task authorization is inactive');
    const { version, connections } = await activeTaskContext(ctx, task);
    const connection = connections.find((item: any) => item._id === args.connectionId);
    if (
      !connection ||
      !connection.allowedTools.includes(args.tool) ||
      !versionAllows(version, connection.provider, args.tool)
    )
      throw new Error('Tool is not authorized for this task');
    const existing = await ctx.db
      .query('toolCalls')
      .withIndex('by_task_operation_outcome', (q: any) =>
        q.eq('taskId', task._id).eq('operationId', args.operationId).eq('outcome', args.outcome),
      )
      .unique();
    if (existing) return { toolCallId: existing._id };
    if (args.outcome !== 'started') {
      const otherOutcome = args.outcome === 'succeeded' ? 'failed' : 'succeeded';
      const conflicting = await ctx.db
        .query('toolCalls')
        .withIndex('by_task_operation_outcome', (q: any) =>
          q.eq('taskId', task._id).eq('operationId', args.operationId).eq('outcome', otherOutcome),
        )
        .unique();
      if (conflicting) throw new Error('Tool call already has a different terminal outcome');
    }
    const started = await ctx.db
      .query('toolCalls')
      .withIndex('by_task_operation_outcome', (q: any) =>
        q.eq('taskId', task._id).eq('operationId', args.operationId).eq('outcome', 'started'),
      )
      .unique();
    if (args.outcome !== 'started' && !started) throw new Error('Journal the tool call before executing it');
    if (
      started &&
      (started.taskId !== task._id ||
        started.connectionId !== connection._id ||
        started.tool !== args.tool ||
        started.argumentsCiphertext !== args.argumentsCiphertext)
    )
      throw new Error('Tool-call evidence does not match the recorded operation');
    const now = Date.now();
    const toolCallId = await ctx.db.insert('toolCalls', {
      workspaceId: task.workspaceId,
      taskId: task._id,
      connectionId: connection._id,
      operationId: args.operationId,
      outcome: args.outcome,
      tool: args.tool,
      argumentsCiphertext: args.argumentsCiphertext,
      resultCiphertext: args.resultCiphertext,
      sha256: args.sha256,
      createdAt: now,
    });
    const workspace = await ctx.db.get(task.workspaceId);
    if (!workspace) throw new Error('Workspace not found');
    const sequence = workspace.nextSequence + 1;
    await ctx.db.patch(workspace._id, { nextSequence: sequence });
    await ctx.db.insert('events', {
      workspaceId: task.workspaceId,
      taskId: task._id,
      externalId: `tool:${args.operationId}:${args.outcome}`,
      sequence,
      type: 'tool_call',
      text: `${args.tool}: ${args.outcome}`,
      createdAt: now,
      employeeName: task.employeeName,
    });
    return { toolCallId };
  },
});

export const artifactContext = query({
  args: {
    secret: v.string(),
    artifactId: v.id('artifacts'),
    authSubject: v.string(),
    authOrgId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const workspace = await workspaceForActor(ctx, args.authSubject, args.authOrgId);
    const artifact = await ctx.db.get(args.artifactId);
    if (!workspace || !artifact || artifact.workspaceId !== workspace._id)
      throw new Error('Artifact not found');
    const task = await ctx.db.get(artifact.taskId);
    if (!task || task.createdBy !== args.authSubject) throw new Error('Artifact not found');
    return {
      artifact: {
        id: artifact._id,
        taskId: artifact.taskId,
        name: artifact.name,
        mediaType: artifact.mediaType,
        size: artifact.size,
        storageKey: artifact.storageKey,
        sha256: artifact.sha256,
        createdAt: artifact.createdAt,
      },
      authorization: { workspaceId: workspace._id, taskCreatedBy: task?.createdBy },
    };
  },
});
