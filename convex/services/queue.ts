import { v } from 'convex/values';
import { mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { requireService } from '../shared';
import { isTerminal, taskInputState } from './context';

/** Active task statuses, in the order a worker should take them on. */
const monitorable = ['queued', 'running', 'awaiting_approval'] as const;

async function activeTasks(ctx: QueryCtx | MutationCtx) {
  const tasks: Doc<'tasks'>[] = [];
  for (const status of monitorable) {
    tasks.push(
      ...(await ctx.db
        .query('tasks')
        .withIndex('by_status', (q) => q.eq('status', status))
        .take(500)),
    );
  }
  return tasks.filter((task) => task.sessionId);
}

/**
 * The worker subscription. It carries counts and revisions only: workers pull work with the claim
 * mutations, so a replica never acts on a list it was pushed.
 */
export const workerState = query({
  args: { secret: v.string() },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const [queued, leased, tasks, signal] = await Promise.all([
      ctx.db
        .query('jobs')
        .withIndex('by_state_available', (q) => q.eq('state', 'queued'))
        .take(100),
      ctx.db
        .query('jobs')
        .withIndex('by_state_available', (q) => q.eq('state', 'leased'))
        .take(100),
      activeTasks(ctx),
      ctx.db
        .query('workerSignals')
        .withIndex('by_name', (q) => q.eq('name', 'jobs'))
        .unique(),
    ]);
    return {
      pendingJobs: queued.length + leased.length,
      activeTasks: tasks.length,
      nextAvailableAt: queued.reduce(
        (next: number | undefined, job) =>
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
    const [expiredJobs, cancellations, fresh] = await Promise.all([
      ctx.db
        .query('jobs')
        .withIndex('by_state_lease_expiration', (q) => q.eq('state', 'leased').lt('leaseExpiresAt', now))
        .take(100),
      ctx.db
        .query('jobs')
        .withIndex('by_state_kind_available', (q) =>
          q.eq('state', 'queued').eq('kind', 'cancel_task').lte('availableAt', now),
        )
        .take(50),
      ctx.db
        .query('jobs')
        .withIndex('by_state_available', (q) => q.eq('state', 'queued').lte('availableAt', now))
        .take(100),
    ]);
    const recovered: Doc<'jobs'>[] = [];
    for (const job of expiredJobs) {
      if (job.kind === 'execute_action') {
        await ctx.db.patch(job._id, {
          state: 'failed',
          error: 'Lease expired after external action dispatch may have begun',
          leaseOwner: undefined,
          leaseToken: undefined,
          leaseExpiresAt: undefined,
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
            if (task && !isTerminal(task.status))
              await ctx.db.patch(task._id, {
                status: 'uncertain',
                error: 'An external action may have completed, so it was not retried',
                updatedAt: now,
              });
          }
        }
      } else {
        const task = await ctx.db.get(job.taskId);
        if (!task || (job.kind !== 'cancel_task' && isTerminal(task.status))) {
          await ctx.db.patch(job._id, {
            state: 'failed',
            error: 'Task became inactive before the command could be retried',
            leaseOwner: undefined,
            leaseToken: undefined,
            leaseExpiresAt: undefined,
            updatedAt: now,
          });
          continue;
        }
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
    const uniqueCandidates = new Map<Id<'jobs'>, Doc<'jobs'>>();
    for (const job of [...cancellations, ...fresh, ...recovered]) uniqueCandidates.set(job._id, job);
    const candidates = [...uniqueCandidates.values()].sort((a, b) => {
      const priority = Number(b.kind === 'cancel_task') - Number(a.kind === 'cancel_task');
      return priority || a.createdAt - b.createdAt;
    });
    const output: Array<{
      id: Id<'jobs'>;
      kind: string;
      taskId: Id<'tasks'>;
      payload: unknown;
      leaseToken: string;
      attempts: number;
    }> = [];
    const selectedTasks = new Set<string>();
    const limit = Number.isFinite(args.limit) ? Math.max(0, Math.min(50, Math.floor(args.limit))) : 0;
    for (const job of candidates) {
      if (output.length >= limit) break;
      const taskKey = String(job.taskId);
      if (selectedTasks.has(taskKey)) continue;
      const activeLeases = await ctx.db
        .query('jobs')
        .withIndex('by_task_state', (q) => q.eq('taskId', job.taskId).eq('state', 'leased'))
        .collect();
      const activeLeaseExpiresAt = activeLeases.reduce(
        (latest, active) => Math.max(latest, active.leaseExpiresAt || 0),
        0,
      );
      if (activeLeaseExpiresAt > now) {
        await ctx.db.patch(job._id, { availableAt: activeLeaseExpiresAt, updatedAt: now });
        continue;
      }
      const task = await ctx.db.get(job.taskId);
      if (!task) {
        await ctx.db.patch(job._id, { state: 'failed', error: 'Task not found', updatedAt: now });
        continue;
      }
      if (
        job.kind !== 'cancel_task' &&
        (['failed', 'cancelled', 'uncertain'].includes(task.status) ||
          (task.status === 'completed' && job.kind !== 'execute_action'))
      ) {
        await ctx.db.patch(job._id, { state: 'failed', error: 'Task is no longer active', updatedAt: now });
        if (job.kind === 'execute_action' && job.proposalId) {
          const proposal = await ctx.db.get(job.proposalId);
          if (proposal?.status === 'approved') {
            await ctx.db.patch(proposal._id, { status: 'rejected', result: 'Task is no longer active' });
            await ctx.db.insert('actionTransitions', {
              workspaceId: proposal.workspaceId,
              proposalId: proposal._id,
              from: 'approved',
              to: 'rejected',
              actor: 'worker',
              at: now,
              detail: 'Task is no longer active',
            });
          }
        }
        continue;
      }
      if (job.kind === 'execute_action') {
        const proposal = job.proposalId ? await ctx.db.get(job.proposalId) : null;
        if (
          !proposal ||
          proposal.status !== 'approved' ||
          (task.status === 'completed' && !proposal.originalActionId)
        ) {
          await ctx.db.patch(job._id, {
            state: 'failed',
            error: 'Action is no longer approved',
            updatedAt: now,
          });
          continue;
        }
      }
      // Invariant: one worker runs a job at a time. The lease token is minted and stored here, and
      // every later mutation for this job requires it, so a second replica's claim cannot complete,
      // renew, or fail the same attempt. At most one job per task is leased at once.
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
        if (!proposal) throw new Error('Approved action disappeared during claim');
        await ctx.db.patch(proposal._id, { status: 'executing' });
        await ctx.db.insert('actionTransitions', {
          workspaceId: proposal.workspaceId,
          proposalId: proposal._id,
          from: 'approved',
          to: 'executing',
          actor: args.workerId,
          at: now,
        });
      }
      let payload: unknown = job.payload;
      try {
        payload = JSON.parse(job.payload);
      } catch {
        /* Old jobs may contain plain text. */
      }
      output.push({ id: job._id, kind: job.kind, taskId: job.taskId, payload, leaseToken, attempts });
      selectedTasks.add(taskKey);
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
    const task = await ctx.db.get(job.taskId);
    const proposal = job.proposalId ? await ctx.db.get(job.proposalId) : null;
    const completedCorrection =
      job.kind === 'execute_action' && task?.status === 'completed' && Boolean(proposal?.originalActionId);
    if (!task || (job.kind !== 'cancel_task' && !completedCorrection && isTerminal(task.status)))
      throw new Error('Task is no longer active');
    await ctx.db.patch(job._id, { leaseExpiresAt: Date.now() + 60_000, updatedAt: Date.now() });
    return null;
  },
});

const streamLeaseMs = 120_000;

/**
 * Claims session monitors for one worker, up to its free monitor slots.
 *
 * Invariant: exactly one worker monitors a session at a time. A task is claimable only when its
 * stream lease is empty, already this worker's, or expired, and the lease is stamped inside this
 * same mutation. Convex serializes conflicting mutations, so two replicas cannot both take it.
 * Tasks with a pending input job are skipped: their monitor would race the job that sends input.
 */
export const claimStreams = mutation({
  args: { secret: v.string(), workerId: v.string(), limit: v.number() },
  handler: async (ctx, args) => {
    requireService(args.secret);
    if (!args.workerId.trim()) throw new Error('workerId is required');
    const limit = Number.isFinite(args.limit) ? Math.max(0, Math.min(64, Math.floor(args.limit))) : 0;
    if (!limit) return [];
    const now = Date.now();
    const leaseExpiresAt = now + streamLeaseMs;
    const claimed: { taskId: Id<'tasks'>; leaseExpiresAt: number }[] = [];
    let examined = 0;
    for (const task of await activeTasks(ctx)) {
      if (claimed.length >= limit || ++examined > 200) break;
      if (task.streamOwner && task.streamOwner !== args.workerId && (task.streamLeaseExpiresAt || 0) > now)
        continue;
      if ((await taskInputState(ctx, task._id)).pendingInput) continue;
      await ctx.db.patch(task._id, { streamOwner: args.workerId, streamLeaseExpiresAt: leaseExpiresAt });
      claimed.push({ taskId: task._id, leaseExpiresAt });
    }
    return claimed;
  },
});

/** The monitor heartbeat. Losing the lease means another replica took the session over. */
export const renewStream = mutation({
  args: { secret: v.string(), taskId: v.id('tasks'), workerId: v.string() },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const task = await ctx.db.get(args.taskId);
    if (!task || !task.sessionId || !monitorable.includes(task.status as (typeof monitorable)[number]))
      return { claimed: false as const };
    const now = Date.now();
    if (task.streamOwner && task.streamOwner !== args.workerId && (task.streamLeaseExpiresAt || 0) > now)
      return { claimed: false as const, leaseExpiresAt: task.streamLeaseExpiresAt };
    const leaseExpiresAt = now + streamLeaseMs;
    await ctx.db.patch(task._id, { streamOwner: args.workerId, streamLeaseExpiresAt: leaseExpiresAt });
    return { claimed: true as const, leaseExpiresAt };
  },
});

/** Shutdown releases the lease immediately so another replica takes over without waiting it out. */
export const releaseStream = mutation({
  args: { secret: v.string(), taskId: v.id('tasks'), workerId: v.string() },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const task = await ctx.db.get(args.taskId);
    if (!task || task.streamOwner !== args.workerId) return { released: false as const };
    await ctx.db.patch(task._id, { streamOwner: undefined, streamLeaseExpiresAt: undefined });
    return { released: true as const };
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
    const now = Date.now();
    const task = await ctx.db.get(job.taskId);
    if (task && (job.kind === 'start_task' || job.kind === 'send_message') && !isTerminal(task.status))
      await ctx.db.patch(task._id, { status: 'running', updatedAt: now });
    await ctx.db.patch(job._id, {
      state: 'completed',
      result: args.result,
      leaseOwner: undefined,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      updatedAt: now,
    });
    const queued = await ctx.db
      .query('jobs')
      .withIndex('by_task_state', (q) => q.eq('taskId', job.taskId).eq('state', 'queued'))
      .collect();
    for (const next of queued) {
      if (next.availableAt > now) await ctx.db.patch(next._id, { availableAt: now, updatedAt: now });
    }
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
    const task = await ctx.db.get(job.taskId);
    const taskActive = Boolean(task && !isTerminal(task.status));
    const canRetry =
      job.kind !== 'execute_action' && args.retryable === true && job.attempts < 3 && taskActive;
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
      if (task && !isTerminal(task.status))
        await ctx.db.patch(task._id, {
          status: args.outcomeUnknown ? 'uncertain' : 'failed',
          error: args.error,
          updatedAt: now,
        });
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
