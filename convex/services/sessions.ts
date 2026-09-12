import { v } from 'convex/values';
import { mutation, query } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { taskStatus, tokenUsage } from '../schema';
import { requireService, usagePeriod } from '../shared';
import { finalAssistantMessage, systemPost } from '../work';
import { activeTaskContext, isTerminal, privateConnection, taskInputState } from './context';

export const taskContext = query({
  args: { secret: v.string(), taskId: v.id('tasks') },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error('Task not found');
    const { version, connections, policies } = await activeTaskContext(ctx, task);
    return {
      task: publicTask(task),
      project:
        task.projectId && task.projectContext
          ? { id: task.projectId, name: task.projectContext.name, brief: task.projectContext.brief }
          : undefined,
      employeeVersion: {
        id: version._id,
        version: version.version,
        model: version.model,
        instructions: version.instructions,
        skills: version.skills,
        capabilities: version.capabilities,
        persona: version.persona,
      },
      connections: connections.map(privateConnection),
      policies,
      runToken: task.runToken,
    };
  },
});

function publicTask(task: Doc<'tasks'>) {
  return {
    id: task._id,
    workspaceId: task.workspaceId,
    title: task.title,
    prompt: task.prompt,
    status: task.status,
    sessionId: task.sessionId,
    model: task.model,
    createdBy: task.createdBy,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

export const sessionContext = query({
  args: { secret: v.string(), taskId: v.id('tasks') },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error('Task not found');
    const [artifacts, input] = await Promise.all([
      ctx.db
        .query('artifacts')
        .withIndex('by_task', (q) => q.eq('taskId', task._id))
        .take(100),
      taskInputState(ctx, task._id),
    ]);
    return {
      task: publicTask(task),
      archivedStorageKeys: artifacts.map((artifact) => artifact.storageKey),
      inputRevision: input.inputRevision,
      pendingInput: input.pendingInput,
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
    if (args.leaseToken) {
      const jobs = await ctx.db
        .query('jobs')
        .withIndex('by_task_state', (q) => q.eq('taskId', task._id).eq('state', 'leased'))
        .collect();
      const job = jobs.find((candidate) => candidate.leaseToken === args.leaseToken);
      if (!job || !job.leaseExpiresAt || job.leaseExpiresAt <= Date.now())
        throw new Error('Job lease is no longer valid');
    }
    await ctx.db.patch(task._id, { sessionId: args.sessionId, updatedAt: Date.now() });
    return null;
  },
});

/**
 * Records reported usage against the task, the per-report journal, and the workspace period aggregate.
 * Reports with an external id are additive and deduplicated; a report without one is a cumulative total.
 */
async function recordUsage(
  ctx: MutationCtx,
  task: Doc<'tasks'>,
  usage: { externalId?: string; input: number; cached: number; output: number },
  recordedAt: number,
) {
  if ([usage.input, usage.cached, usage.output].some((value) => !Number.isFinite(value) || value < 0))
    throw new Error('Usage values must be finite and non-negative');
  const current = task.usage || { input: 0, cached: 0, output: 0 };
  const externalId = usage.externalId || 'session';
  const period = usagePeriod(recordedAt);
  const reports = await ctx.db
    .query('usageReports')
    .withIndex('by_task_external', (q) => q.eq('taskId', task._id))
    .collect();
  const prior = reports.find((report) => report.externalId === externalId);
  const firstOfPeriod = !reports.some((report) => report.period === period);
  let next = current;
  if (usage.externalId) {
    if (prior) return undefined;
    next = {
      input: current.input + usage.input,
      cached: current.cached + usage.cached,
      output: current.output + usage.output,
    };
  } else {
    next = {
      input: Math.max(current.input, usage.input),
      cached: Math.max(current.cached, usage.cached),
      output: Math.max(current.output, usage.output),
    };
  }
  const delta = {
    input: next.input - current.input,
    cached: next.cached - current.cached,
    output: next.output - current.output,
  };
  const values = { input: usage.input, cached: usage.cached, output: usage.output };
  if (prior) await ctx.db.patch(prior._id, { ...values, period, createdAt: recordedAt });
  else
    await ctx.db.insert('usageReports', {
      workspaceId: task.workspaceId,
      taskId: task._id,
      externalId,
      model: task.model,
      ...values,
      period,
      createdAt: recordedAt,
    });
  const aggregate = await ctx.db
    .query('usage')
    .withIndex('by_workspace_period_model', (q) =>
      q.eq('workspaceId', task.workspaceId).eq('period', period).eq('model', task.model),
    )
    .unique();
  if (aggregate)
    await ctx.db.patch(aggregate._id, {
      input: aggregate.input + delta.input,
      cached: aggregate.cached + delta.cached,
      output: aggregate.output + delta.output,
      tasks: aggregate.tasks + (firstOfPeriod ? 1 : 0),
      updatedAt: recordedAt,
    });
  else
    await ctx.db.insert('usage', {
      workspaceId: task.workspaceId,
      period,
      model: task.model,
      ...delta,
      tasks: 1,
      updatedAt: recordedAt,
    });
  return next;
}

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
    usage: v.optional(v.object({ externalId: v.optional(v.string()), ...tokenUsage.fields })),
    status: v.optional(taskStatus),
    error: v.optional(v.string()),
    inputRevision: v.optional(v.string()),
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
        .withIndex('by_task_external', (q) => q.eq('taskId', task._id).eq('externalId', event.externalId))
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
        .withIndex('by_task_external', (q) => q.eq('taskId', task._id).eq('externalId', externalId))
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
    const recordedAt = Date.now();
    const patch: Record<string, unknown> = { updatedAt: recordedAt };
    if (args.usage) {
      const usage = await recordUsage(ctx, task, args.usage, recordedAt);
      if (usage) patch.usage = usage;
    }
    if (args.status) {
      let nextStatus = args.status;
      let staleTerminal = false;
      if (isTerminal(args.status)) {
        if (!args.inputRevision) throw new Error('Terminal session events require an input revision');
        const input = await taskInputState(ctx, task._id);
        staleTerminal = input.pendingInput || input.inputRevision !== args.inputRevision;
      }
      if (isTerminal(task.status) || staleTerminal) {
        nextStatus = task.status;
      } else if (args.status === 'completed') {
        const [activeProposals, queuedJobs, leasedJobs] = await Promise.all([
          ctx.db
            .query('proposals')
            .withIndex('by_task_status', (q) => q.eq('taskId', task._id))
            .collect(),
          ctx.db
            .query('jobs')
            .withIndex('by_task_state', (q) => q.eq('taskId', task._id).eq('state', 'queued'))
            .collect(),
          ctx.db
            .query('jobs')
            .withIndex('by_task_state', (q) => q.eq('taskId', task._id).eq('state', 'leased'))
            .collect(),
        ]);
        if (
          activeProposals.some((proposal) => ['pending', 'approved', 'executing'].includes(proposal.status))
        )
          nextStatus = 'awaiting_approval';
        else if ([...queuedJobs, ...leasedJobs].some((job) => job.kind === 'send_message'))
          nextStatus = task.status === 'queued' ? 'queued' : 'running';
      }
      patch.status = nextStatus;
    }
    if (args.error !== undefined) patch.error = args.error;
    const status = patch.status ? String(patch.status) : task.status;
    const becameTerminal = isTerminal(status) && !isTerminal(task.status);
    if (becameTerminal) {
      patch.streamOwner = undefined;
      patch.streamLeaseExpiresAt = undefined;
    }
    await ctx.db.patch(task._id, patch);
    if (becameTerminal && status !== 'uncertain') {
      const closing = status === 'completed' ? await finalAssistantMessage(ctx, task._id) : undefined;
      await systemPost(
        ctx,
        task,
        `${task.employeeName} ${status}: ${task.title}${closing ? `\n${closing.slice(0, 500)}` : ''}`,
      );
    }
    return { inserted, lastSequence: sequence, status };
  },
});
