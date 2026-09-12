import { v } from 'convex/values';
import { mutation } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import { requireService } from '../shared';
import { insertHandoff, insertNote, requireProject } from '../work';
import { taskForRunToken } from './context';

/** Agents post notes and request handoffs from a floor task. People accept them. */
async function floor(ctx: MutationCtx, runToken: string) {
  const task = await taskForRunToken(ctx, runToken);
  if (!task.projectId) throw new Error('This task is not on a floor');
  return { task, project: await requireProject(ctx, task.workspaceId, task.projectId) };
}

export const post = mutation({
  args: { secret: v.string(), runToken: v.string(), text: v.string() },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const { task, project } = await floor(ctx, args.runToken);
    return insertNote(ctx, {
      project,
      authorName: task.employeeName,
      text: args.text,
      taskId: task._id,
    });
  },
});

export const requestHandoff = mutation({
  args: {
    secret: v.string(),
    runToken: v.string(),
    toEmployeeId: v.id('installations'),
    brief: v.string(),
  },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const { task, project } = await floor(ctx, args.runToken);
    return insertHandoff(ctx, {
      project,
      authorName: task.employeeName,
      toEmployeeId: args.toEmployeeId,
      brief: args.brief,
      sourceTaskId: task._id,
    });
  },
});
