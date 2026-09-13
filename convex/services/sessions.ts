import { v } from 'convex/values';
import type { Workshop } from '../../lib/contracts';
import type { Doc } from '../_generated/dataModel';
import { mutation, query } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import { recordCompletedTask } from '../lib/marketplace';
import { systemPost } from '../lib/posts';
import { finalAssistantMessage, releaseDependents } from '../lib/tasks';
import { taskStatus, tokenUsage } from '../schema';
import { requireService, usagePeriod } from '../shared';
import { activeTaskContext, isTerminal, privateConnection, taskForRunToken, taskInputState } from './context';
import { recordAttempts, taskPages } from './notifications';
import { pagingState } from '../../lib/paging';

export const taskContext = query({
  args: { secret: v.string(), taskId: v.id('tasks') },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error('Task not found');
    const { version, connections, policies } = await activeTaskContext(ctx, task);
    const installation = await ctx.db.get(task.employeeId);
    return {
      task: publicTask(task),
      // The worker picks a turn's tool set from the employee kind, and reserved kinds get none.
      employee: {
        id: task.employeeId,
        name: task.employeeName,
        kind: installation?.kind ?? 'worker',
      },
      floor:
        task.floorId && task.floorContext
          ? { id: task.floorId, name: task.floorContext.name, brief: task.floorContext.brief }
          : undefined,
      employeeVersion: {
        id: version._id,
        version: version.version,
        model: version.model,
        instructions: version.instructions,
        skills: version.skills,
        capabilities: version.capabilities,
        workshop: version.workshop as Workshop | undefined,
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
    kind: task.kind ?? 'work',
    cadence: task.cadence,
    projectId: task.projectId,
    sessionId: task.sessionId,
    model: task.model,
    createdBy: task.createdBy,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    usage: task.usage,
    question: task.question,
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
  // A report with an external id is one more call's tokens; one without is the session total so far.
  if (usage.externalId && prior) return undefined;
  const next = usage.externalId
    ? {
        input: current.input + usage.input,
        cached: current.cached + usage.cached,
        output: current.output + usage.output,
      }
    : {
        input: Math.max(current.input, usage.input),
        cached: Math.max(current.cached, usage.cached),
        output: Math.max(current.output, usage.output),
      };
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
    const patch: Partial<Doc<'tasks'>> = { updatedAt: recordedAt };
    if (args.usage) {
      const usage = await recordUsage(ctx, task, args.usage, recordedAt);
      if (usage) patch.usage = usage;
    }
    if (args.status) {
      let nextStatus = args.status;
      let staleTerminal = false;
      if (isTerminal(args.status)) {
        // The revision may legitimately be empty: a daily task's input is its shift job, not a
        // `start_task`, so it has no input job to name. What the check needs is that the caller read
        // one and passed it, so that an input arriving mid-turn still makes this terminal stale.
        if (args.inputRevision === undefined)
          throw new Error('Terminal session events require an input revision');
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
        else if (task.question) nextStatus = 'needs_input';
      }
      patch.status = nextStatus;
    }
    if (args.error !== undefined) patch.error = args.error.slice(0, 2_000);
    const status = patch.status ?? task.status;
    const becameTerminal = isTerminal(status) && !isTerminal(task.status);
    // A daily task's session completes at the end of every shift and the next shift reopens it, so a
    // `completed` daily task has finished a shift and not the work. Nothing that belongs to a task
    // that is really over fires here: no closing post, no listing count, and no dependency release.
    const finishedWork = becameTerminal && !(task.cadence === 'daily' && status === 'completed');
    if (becameTerminal) {
      patch.streamOwner = undefined;
      patch.streamLeaseExpiresAt = undefined;
    }
    await ctx.db.patch(task._id, patch);
    if (finishedWork && status !== 'uncertain') {
      const closing = status === 'completed' ? await finalAssistantMessage(ctx, task._id) : undefined;
      await systemPost(
        ctx,
        task,
        `${task.employeeName} ${status}: ${task.title}${closing ? `\n${closing.slice(0, 500)}` : ''}`,
      );
    }
    // Marketplace usage count, owned by the marketplace workstream: a completed task is the one
    // signal a listing reports beyond its hires.
    if (finishedWork && status === 'completed') await recordCompletedTask(ctx, task.employeeId);
    // Dependency release, owned by the projects workstream: a task that just finished either frees
    // the tasks waiting on it or blocks them with the reason. Nothing else here reads the graph.
    if (finishedWork) await releaseDependents(ctx, task, status);
    return { inserted, lastSequence: sequence, status };
  },
});

/**
 * The employee stopped on a question only a person can answer. The turn that asked it ends as
 * `needs_input`, and the person's next message on the task clears it and resumes the session.
 */
export const askQuestion = mutation({
  args: { secret: v.string(), runToken: v.string(), text: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireService(args.secret);
    const task = await taskForRunToken(ctx, args.runToken);
    const text = args.text.trim().slice(0, 2_000);
    if (!text) throw new Error('A question needs text');
    await ctx.db.patch(task._id, { question: { text, askedAt: Date.now() }, updatedAt: Date.now() });
    return null;
  },
});

/**
 * One page for a task waiting on a person, recorded and handed back for delivery. The planner
 * decides when it is due from the same ledger the incident pages use; a task that has moved on or
 * whose owner already answered pages nobody.
 */
export const pageTask = mutation({
  args: { secret: v.string(), taskId: v.id('tasks') },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error('Task not found');
    const workspace = await ctx.db.get(task.workspaceId);
    if (!workspace) throw new Error('Workspace not found');
    if (task.status !== 'needs_input' && task.status !== 'awaiting_approval') return [];
    const paging = pagingState(await taskPages(ctx, task._id), Date.now());
    if (paging.acknowledged || paging.nextAttemptAt === undefined) return [];
    const question = task.status === 'needs_input' && task.question;
    return recordAttempts(ctx, workspace, {
      kind: 'task',
      title: question
        ? `${task.employeeName} has a question: ${task.title}`
        : `${task.employeeName} is waiting on an approval: ${task.title}`,
      text: question ? question.text : 'An external change is proposed and holds until you decide.',
      taskId: task._id,
      subjects: [task.createdBy],
    });
  },
});
