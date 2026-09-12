import { v } from 'convex/values';
import { mutation, query } from '../_generated/server';
import { correctionKind } from '../schema';
import { canSeeTask, requireService, sha256, stableJson } from '../shared';
import { taskTimeline } from '../work';
import {
  activeTaskContext,
  isTerminal,
  privateConnection,
  taskForRunToken,
  versionAllows,
  workspaceForActor,
} from './context';

export const gatewayContext = query({
  args: { secret: v.string(), runToken: v.string() },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const task = await taskForRunToken(ctx, args.runToken);
    const { version, connections, policies } = await activeTaskContext(ctx, task);
    return {
      task: { id: task._id, workspaceId: task.workspaceId, status: task.status, createdBy: task.createdBy },
      employeeVersion: { id: version._id, capabilities: version.capabilities },
      connections: connections.map(privateConnection),
      policies,
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
    correction: correctionKind,
    correctionReason: v.string(),
    beforeState: v.optional(v.any()),
    providerRequestId: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const task = await taskForRunToken(ctx, args.runToken);
    const { version, connections } = await activeTaskContext(ctx, task);
    const connection = connections.find((item) => item._id === args.connectionId);
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
      .withIndex('by_dedupe', (q) => q.eq('dedupeKey', dedupeKey))
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
      .withIndex('by_unique_key', (q) => q.eq('uniqueKey', `action:${proposal._id}`))
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
    if (
      !task ||
      ['cancelled', 'failed', 'uncertain'].includes(task.status) ||
      (task.status === 'completed' && !proposal.originalActionId)
    )
      throw new Error('Task authorization is inactive');
    const { version, connections, policies } = await activeTaskContext(ctx, task);
    const connection = connections.find((item) => item._id === proposal.connectionId);
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
      policies,
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
    if (!proposal) throw new Error('Action is not executing');
    const job = await ctx.db
      .query('jobs')
      .withIndex('by_unique_key', (q) => q.eq('uniqueKey', `action:${proposal._id}`))
      .unique();
    const completionTokenHash = await sha256(args.leaseToken);
    if (['succeeded', 'failed', 'uncertain'].includes(proposal.status)) {
      if (
        job?.state === 'completed' &&
        job.completionTokenHash === completionTokenHash &&
        proposal.status === args.status
      )
        return null;
      throw new Error('Action result is already final');
    }
    if (proposal.status !== 'executing') throw new Error('Action is not executing');
    if (!job || job.state !== 'leased' || job.leaseToken !== args.leaseToken)
      throw new Error('Action lease is no longer valid');
    if ((args.result?.length || 0) > 100_000) throw new Error('Action result is too large');
    const afterState = args.afterState === undefined ? undefined : stableJson(args.afterState);
    if ((afterState?.length || 0) > 100_000) throw new Error('Action after-state is too large');
    const now = Date.now();
    await ctx.db.patch(proposal._id, {
      status: args.status,
      result: args.result,
      afterState,
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
      completionTokenHash,
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
    if (task && !isTerminal(task.status)) {
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
          .withIndex('by_unique_key', (q) => q.eq('uniqueKey', uniqueKey))
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

export const recordToolCall = mutation({
  args: {
    secret: v.string(),
    runToken: v.string(),
    connectionId: v.id('connections'),
    tool: v.string(),
    argumentsCiphertext: v.string(),
    resultCiphertext: v.optional(v.string()),
    outcome: v.union(v.literal('started'), v.literal('succeeded'), v.literal('failed'), v.literal('denied')),
    operationId: v.string(),
    reason: v.optional(v.string()),
    durationMs: v.optional(v.number()),
    sha256: v.optional(v.string()),
    proposalId: v.optional(v.id('proposals')),
    leaseToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireService(args.secret);
    if (!args.operationId.trim()) throw new Error('operationId is required');
    if (args.argumentsCiphertext.length > 100_000 || (args.resultCiphertext?.length || 0) > 100_000)
      throw new Error('Tool-call evidence exceeds 100 KB; store it externally and journal its digest');
    if (args.outcome === 'denied' && !args.reason?.trim())
      throw new Error('A denied tool call requires a reason');
    if (args.outcome === 'started' && args.durationMs !== undefined)
      throw new Error('Duration belongs to a terminal tool-call outcome');
    const task = await ctx.db
      .query('tasks')
      .withIndex('by_run_token', (q) => q.eq('runToken', args.runToken))
      .unique();
    if (!task) throw new Error('Task authorization is inactive');
    const leaseTokenHash = args.leaseToken ? await sha256(args.leaseToken) : undefined;
    const started = await ctx.db
      .query('toolCalls')
      .withIndex('by_task_operation_outcome', (q) =>
        q.eq('taskId', task._id).eq('operationId', args.operationId).eq('outcome', 'started'),
      )
      .unique();
    if (
      started &&
      args.outcome !== 'denied' &&
      (started.connectionId !== args.connectionId ||
        started.tool !== args.tool ||
        started.argumentsCiphertext !== args.argumentsCiphertext ||
        started.proposalId !== args.proposalId ||
        started.leaseTokenHash !== leaseTokenHash)
    )
      throw new Error('Tool-call evidence does not match the recorded operation');
    const existing = await ctx.db
      .query('toolCalls')
      .withIndex('by_task_operation_outcome', (q) =>
        q.eq('taskId', task._id).eq('operationId', args.operationId).eq('outcome', args.outcome),
      )
      .unique();
    if (existing) return { toolCallId: existing._id };
    if (args.outcome === 'started') {
      if (args.proposalId) {
        if (!args.leaseToken || args.operationId !== `action:${args.proposalId}`)
          throw new Error('Action audit requires its proposal and lease');
        const proposal = await ctx.db.get(args.proposalId);
        if (
          !proposal ||
          proposal.taskId !== task._id ||
          proposal.connectionId !== args.connectionId ||
          proposal.tool !== args.tool ||
          proposal.status !== 'executing'
        )
          throw new Error('Action is not executable');
        if (
          ['cancelled', 'failed', 'uncertain'].includes(task.status) ||
          (task.status === 'completed' && !proposal.originalActionId)
        )
          throw new Error('Task authorization is inactive');
        const job = await ctx.db
          .query('jobs')
          .withIndex('by_unique_key', (q) => q.eq('uniqueKey', `action:${proposal._id}`))
          .unique();
        if (
          !job ||
          job.state !== 'leased' ||
          job.leaseToken !== args.leaseToken ||
          !job.leaseExpiresAt ||
          job.leaseExpiresAt <= Date.now()
        )
          throw new Error('Action lease is no longer valid');
      } else if (args.leaseToken) {
        throw new Error('A lease token requires an action proposal');
      } else if (isTerminal(task.status)) {
        throw new Error('Task authorization is inactive');
      }
      const { version, connections } = await activeTaskContext(ctx, task);
      const connection = connections.find((item) => item._id === args.connectionId);
      if (
        !connection ||
        !connection.allowedTools.includes(args.tool) ||
        !versionAllows(version, connection.provider, args.tool)
      )
        throw new Error('Tool is not authorized for this task');
    } else if (args.outcome !== 'denied') {
      if (!started) throw new Error('Journal the tool call before executing it');
      if (started.proposalId && (!args.proposalId || !args.leaseToken))
        throw new Error('Action audit requires its proposal and lease');
      if (!started.proposalId && (args.proposalId || args.leaseToken))
        throw new Error('Tool-call evidence does not match the recorded operation');
      const otherOutcome = args.outcome === 'succeeded' ? 'failed' : 'succeeded';
      const conflicting = await ctx.db
        .query('toolCalls')
        .withIndex('by_task_operation_outcome', (q) =>
          q.eq('taskId', task._id).eq('operationId', args.operationId).eq('outcome', otherOutcome),
        )
        .unique();
      if (conflicting) throw new Error('Tool call already has a different terminal outcome');
    }
    const now = Date.now();
    const toolCallId = await ctx.db.insert('toolCalls', {
      workspaceId: task.workspaceId,
      taskId: task._id,
      connectionId: args.connectionId,
      operationId: args.operationId,
      proposalId: args.proposalId,
      leaseTokenHash,
      outcome: args.outcome,
      reason: args.reason,
      durationMs: args.durationMs,
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
      text: `${args.tool}: ${args.outcome}${args.reason ? ` (${args.reason})` : ''}`,
      createdAt: now,
      employeeName: task.employeeName,
    });
    return { toolCallId };
  },
});

/** The sealed timeline for the web service, which unseals it for viewers who can see the task. */
export const auditTimeline = query({
  args: {
    secret: v.string(),
    taskId: v.id('tasks'),
    authSubject: v.string(),
    authOrgId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const workspace = await workspaceForActor(ctx, args.authSubject, args.authOrgId);
    const task = await ctx.db.get(args.taskId);
    if (!workspace || !task || task.workspaceId !== workspace._id || !canSeeTask(task, args.authSubject))
      throw new Error('Task not found');
    return taskTimeline(ctx, task);
  },
});
