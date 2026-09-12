import { v } from 'convex/values';
import { mutation } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import { requireService } from '../shared';
import { insertHandoff, insertNote, requireFloor } from '../work';
import { taskForRunToken } from './context';

/** Agents post notes and request handoffs from a floor task. People accept them. */
async function floorForRun(ctx: MutationCtx, runToken: string) {
  const task = await taskForRunToken(ctx, runToken);
  if (!task.floorId) throw new Error('This task is not on a floor');
  return { task, floor: await requireFloor(ctx, task.workspaceId, task.floorId) };
}

export const post = mutation({
  args: { secret: v.string(), runToken: v.string(), text: v.string() },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const { task, floor } = await floorForRun(ctx, args.runToken);
    return insertNote(ctx, {
      floor,
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
    const { task, floor } = await floorForRun(ctx, args.runToken);
    return insertHandoff(ctx, {
      floor,
      authorName: task.employeeName,
      toEmployeeId: args.toEmployeeId,
      brief: args.brief,
      sourceTaskId: task._id,
    });
  },
});
