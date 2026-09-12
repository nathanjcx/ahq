import { v } from 'convex/values';
import { mutation } from './_generated/server';
import type { Doc } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { canDecide, requireWorkspace, sha256, type WorkspaceRole } from './shared';
import { startTask } from './work';

async function decidable(
  ctx: MutationCtx,
  workspaceId: Doc<'workspaces'>['_id'],
  proposalId: Doc<'proposals'>['_id'],
  subject: string,
  role: WorkspaceRole,
) {
  const proposal = await ctx.db.get(proposalId);
  if (!proposal || proposal.workspaceId !== workspaceId) throw new Error('Action proposal not found');
  const task = await ctx.db.get(proposal.taskId);
  if (!task) throw new Error('Action proposal not found');
  const connection = await ctx.db.get(proposal.connectionId);
  if (!canDecide(connection, subject, role))
    throw new Error('Only the connection owner or a workspace administrator can decide this action');
  return { proposal, task };
}

export const decide = mutation({
  args: { proposalId: v.id('proposals'), approved: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { workspace, actor, role } = await requireWorkspace(ctx);
    const { proposal, task } = await decidable(ctx, workspace._id, args.proposalId, actor.subject, role);
    if (
      ['failed', 'cancelled', 'uncertain'].includes(task.status) ||
      (task.status === 'completed' && !proposal.originalActionId)
    )
      throw new Error('The task is no longer active');
    const desired = args.approved ? 'approved' : 'rejected';
    if (proposal.status === desired) return null;
    if (proposal.status !== 'pending') throw new Error('This proposal has already been decided');
    const now = Date.now();
    await ctx.db.insert('actionTransitions', {
      workspaceId: workspace._id,
      proposalId: proposal._id,
      from: proposal.status,
      to: desired,
      actor: actor.subject,
      at: now,
    });
    await ctx.db.patch(proposal._id, {
      status: desired,
      approvedBy: actor.subject,
      approvedByName: actor.name,
      approvedAt: now,
    });
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
    } else if (task.status === 'awaiting_approval') {
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
  returns: v.union(
    v.object({ kind: v.literal('task'), taskId: v.id('tasks') }),
    v.object({ kind: v.literal('proposal'), proposalId: v.id('proposals') }),
  ),
  handler: async (ctx, args) => {
    const { workspace, actor, role } = await requireWorkspace(ctx);
    const { proposal: original, task: originalTask } = await decidable(
      ctx,
      workspace._id,
      args.proposalId,
      actor.subject,
      role,
    );
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
      const version = await ctx.db.get(originalTask.versionId);
      if (!version || version.retiredAt) throw new Error('Employee version is retired');
      const taskId = await startTask(ctx, {
        workspace,
        createdBy: actor.subject,
        createdByName: actor.name,
        employeeId: originalTask.employeeId,
        version,
        title: `Correct: ${original.summary}`,
        prompt: `Review the requested correction for action ${original._id}. The original action was: ${original.summary}. Correction limits: ${original.correctionReason}. Prepare the safest supported correction or clear manual steps. Do not repeat the original action.`,
        project:
          originalTask.projectId && originalTask.projectContext
            ? { projectId: originalTask.projectId, projectContext: originalTask.projectContext }
            : undefined,
        sourceProposalId: original._id,
        messageExternalId: `correction:${original._id}`,
        jobPayload: { correctionOf: original._id },
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
    const proposalId = await ctx.db.insert('proposals', {
      workspaceId: workspace._id,
      taskId: original.taskId,
      connectionId: original.connectionId,
      employeeName: original.employeeName,
      provider: original.provider,
      tool: original.tool,
      arguments: argumentsValue,
      argumentsHash: await sha256(argumentsValue),
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
