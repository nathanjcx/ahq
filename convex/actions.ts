import { v } from 'convex/values';
import { mutation } from './_generated/server';
import type { Doc } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { reserveBudget } from './budget';
import { requireWorkspace, sha256 } from './shared';

async function transition(
  ctx: MutationCtx,
  proposal: Doc<'proposals'>,
  to: string,
  actor: string,
  detail?: string,
) {
  await ctx.db.insert('actionTransitions', {
    workspaceId: proposal.workspaceId,
    proposalId: proposal._id,
    from: proposal.status,
    to,
    actor,
    at: Date.now(),
    detail,
  });
}

export const decide = mutation({
  args: { proposalId: v.id('proposals'), approved: v.boolean() },
  handler: async (ctx, args) => {
    const { workspace, actor } = await requireWorkspace(ctx);
    const proposal = await ctx.db.get(args.proposalId);
    if (!proposal || proposal.workspaceId !== workspace._id) throw new Error('Action proposal not found');
    const proposalTask = await ctx.db.get(proposal.taskId);
    if (!proposalTask || proposalTask.createdBy !== actor.subject)
      throw new Error('Action proposal not found');
    if (
      ['failed', 'cancelled', 'uncertain'].includes(proposalTask.status) ||
      (proposalTask.status === 'completed' && !proposal.originalActionId)
    )
      throw new Error('The task is no longer active');
    const desired = args.approved ? 'approved' : 'rejected';
    if (proposal.status === desired) return null;
    if (proposal.status !== 'pending') throw new Error('This proposal has already been decided');
    const now = Date.now();
    await transition(ctx, proposal, desired, actor.subject);
    await ctx.db.patch(proposal._id, { status: desired, approvedBy: actor.subject, approvedAt: now });
    const task = proposalTask;
    if (args.approved) {
      const uniqueKey = `action:${proposal._id}`;
      const existing = await ctx.db
        .query('jobs')
        .withIndex('by_unique_key', (q) => q.eq('uniqueKey', uniqueKey))
        .unique();
      if (!existing)
        await ctx.db.insert('jobs', {
          workspaceId: workspace._id,
          taskId: proposal.taskId,
          proposalId: proposal._id,
          uniqueKey,
          kind: 'execute_action',
          payload: JSON.stringify({ proposalId: proposal._id }),
          state: 'queued',
          attempts: 0,
          availableAt: now,
          createdAt: now,
          updatedAt: now,
        });
    } else if (task && task.status === 'awaiting_approval') {
      const uniqueKey = `action-decision:${proposal._id}:rejected`;
      const existing = await ctx.db
        .query('jobs')
        .withIndex('by_unique_key', (q) => q.eq('uniqueKey', uniqueKey))
        .unique();
      if (!existing)
        await ctx.db.insert('jobs', {
          workspaceId: workspace._id,
          taskId: task._id,
          uniqueKey,
          kind: 'send_message',
          payload: JSON.stringify({
            text: `The user rejected the proposed action: ${proposal.summary}. Do not execute it. Continue only if useful work remains.`,
          }),
          state: 'queued',
          attempts: 0,
          availableAt: now,
          createdAt: now,
          updatedAt: now,
        });
      await ctx.db.patch(task._id, { status: 'queued', updatedAt: now });
    }
    return null;
  },
});

export const requestCorrection = mutation({
  args: { proposalId: v.id('proposals') },
  handler: async (ctx, args) => {
    const { workspace, actor } = await requireWorkspace(ctx);
    const original = await ctx.db.get(args.proposalId);
    if (!original || original.workspaceId !== workspace._id) throw new Error('Action proposal not found');
    const originalTask = await ctx.db.get(original.taskId);
    if (!originalTask || originalTask.createdBy !== actor.subject)
      throw new Error('Action proposal not found');
    if (original.status !== 'succeeded') throw new Error('Only a successful action can be corrected');
    if (original.correction === 'irreversible' || original.correction === 'unknown')
      throw new Error('This action has no supported correction');
    const existing = await ctx.db
      .query('proposals')
      .withIndex('by_original', (q) => q.eq('originalActionId', original._id))
      .first();
    if (existing) return { kind: 'proposal' as const, proposalId: existing._id };
    const now = Date.now();
    if (original.correction === 'manual' || original.correction === 'partial') {
      const existingTask = await ctx.db
        .query('tasks')
        .withIndex('by_source_proposal', (q) => q.eq('sourceProposalId', original._id))
        .first();
      if (existingTask) return { kind: 'task' as const, taskId: existingTask._id };
      const workspaceRecord = await ctx.db.get(workspace._id);
      if (!workspaceRecord) throw new Error('Workspace not found');
      const employeeVersion = await ctx.db.get(originalTask.versionId);
      if (!employeeVersion || employeeVersion.retiredAt) throw new Error('Employee version is retired');
      const amount = originalTask.reservedCost;
      await reserveBudget(ctx, workspaceRecord, amount, now);
      const prompt = `Review the requested correction for action ${original._id}. The original action was: ${original.summary}. Correction limits: ${original.correctionReason}. Prepare the safest supported correction or clear manual steps. Do not repeat the original action.`;
      const taskId = await ctx.db.insert('tasks', {
        workspaceId: workspace._id,
        createdBy: actor.subject,
        employeeId: originalTask.employeeId,
        versionId: originalTask.versionId,
        employeeName: originalTask.employeeName,
        title: `Correct: ${original.summary}`,
        prompt,
        status: 'queued',
        model: originalTask.model,
        createdAt: now,
        updatedAt: now,
        runToken: crypto.randomUUID(),
        reservedCost: amount,
        budgetFinalized: false,
        sourceProposalId: original._id,
      });
      await ctx.db.insert('messages', {
        workspaceId: workspace._id,
        taskId,
        externalId: `correction:${original._id}`,
        role: 'user',
        text: prompt,
        createdAt: now,
      });
      await ctx.db.insert('jobs', {
        workspaceId: workspace._id,
        taskId,
        uniqueKey: `start:${taskId}`,
        kind: 'start_task',
        payload: JSON.stringify({ taskId, correctionOf: original._id }),
        state: 'queued',
        attempts: 0,
        availableAt: now,
        createdAt: now,
        updatedAt: now,
      });
      return { kind: 'task' as const, taskId };
    }
    if (!original.beforeState || !original.afterState)
      throw new Error('This action lacks the state needed for an automatic correction');
    const parseState = (value: string) => {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    };
    const argumentsValue = JSON.stringify({
      correctionOf: original._id,
      restore: parseState(original.beforeState),
      expectedCurrentState: parseState(original.afterState),
    });
    const argumentsHash = await sha256(argumentsValue);
    const proposalId = await ctx.db.insert('proposals', {
      workspaceId: workspace._id,
      taskId: original.taskId,
      connectionId: original.connectionId,
      employeeName: original.employeeName,
      provider: original.provider,
      tool: original.tool,
      arguments: argumentsValue,
      argumentsHash,
      dedupeKey: `correction:${original._id}`,
      summary: `Correct: ${original.summary}`,
      status: 'pending',
      correction: 'manual',
      correctionReason: original.correctionReason,
      beforeState: original.afterState,
      originalActionId: original._id,
      proposedBy: actor.subject,
      createdAt: now,
    });
    await ctx.db.insert('actionTransitions', {
      workspaceId: workspace._id,
      proposalId,
      to: 'pending',
      actor: actor.subject,
      at: now,
      detail: `Correction for ${original._id}`,
    });
    return { kind: 'proposal' as const, proposalId };
  },
});
