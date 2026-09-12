import { v } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import { mutation, query } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import {
  channelName,
  findChannel,
  insertHandoff,
  insertNote,
  postShiftReport,
  recentPosts,
  taskScopes,
  type ChannelScope,
} from '../lib/posts';
import { requireFloor } from '../lib/tasks';
import { requireService, type Ctx } from '../shared';
import { taskForRunToken } from './context';

const BOARD_LIMIT = 50;

/** An agent posts from a task, and a task posts on the floor it runs on. */
async function floorForRun(ctx: MutationCtx, runToken: string) {
  const task = await taskForRunToken(ctx, runToken);
  if (!task.floorId) throw new Error('This task is not on a floor');
  return { task, floor: await requireFloor(ctx, task.workspaceId, task.floorId) };
}

/** `services/floors:post` and `services/channels:postFromAgent` are the same write. */
export async function postFromRun(ctx: MutationCtx, runToken: string, text: string) {
  const { task, floor } = await floorForRun(ctx, runToken);
  return insertNote(ctx, {
    floor,
    authorEmployeeId: task.employeeId,
    authorName: task.employeeName,
    text,
    taskId: task._id,
  });
}

/** `services/floors:requestHandoff` and `services/channels:requestHandoffFromAgent` are the same write. */
export async function handoffFromRun(
  ctx: MutationCtx,
  runToken: string,
  toEmployeeId: Id<'installations'>,
  brief: string,
) {
  const { task, floor } = await floorForRun(ctx, runToken);
  return insertHandoff(ctx, {
    floor,
    authorEmployeeId: task.employeeId,
    authorName: task.employeeName,
    toEmployeeId,
    brief,
    sourceTaskId: task._id,
  });
}

async function channelRows(ctx: Ctx, task: Doc<'tasks'>, limit: number) {
  const scopes: ChannelScope[] = [...taskScopes(task), ['workspace', '']];
  const rows = [];
  for (const [kind, scopeId] of scopes) {
    const channel = await findChannel(ctx, task.workspaceId, kind, scopeId);
    if (!channel) continue;
    rows.push({
      channel: { kind, name: await channelName(ctx, kind, scopeId) },
      posts: (await recentPosts(ctx, channel._id, limit)).map((post) => ({
        kind: post.kind,
        authorName: post.authorName,
        text: post.text,
        createdAt: post.createdAt,
      })),
    });
  }
  return rows;
}

/**
 * The floor, project, and workspace channels an agent may read. The rows are returned verbatim:
 * every string here was written by a person, a provider, or another agent, and the gateway is the
 * one place that wraps them before they reach a model.
 */
export const readBoard = query({
  args: { secret: v.string(), runToken: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const task = await taskForRunToken(ctx, args.runToken);
    const limit = Math.min(Math.max(Math.floor(args.limit ?? BOARD_LIMIT), 1), BOARD_LIMIT);
    return channelRows(ctx, task, limit);
  },
});

export const postFromAgent = mutation({
  args: { secret: v.string(), runToken: v.string(), text: v.string() },
  handler: async (ctx, args) => {
    requireService(args.secret);
    return postFromRun(ctx, args.runToken, args.text);
  },
});

export const requestHandoffFromAgent = mutation({
  args: {
    secret: v.string(),
    runToken: v.string(),
    toEmployeeId: v.id('installations'),
    brief: v.string(),
  },
  handler: async (ctx, args) => {
    requireService(args.secret);
    return handoffFromRun(ctx, args.runToken, args.toEmployeeId, args.brief);
  },
});

/** One shift report rendered as a `report` post. Recording the same report twice posts once. */
export const postReport = mutation({
  args: { secret: v.string(), taskId: v.id('tasks'), reportId: v.id('reports') },
  returns: v.object({ postIds: v.array(v.id('posts')) }),
  handler: async (ctx, args) => {
    requireService(args.secret);
    const [task, report] = await Promise.all([ctx.db.get(args.taskId), ctx.db.get(args.reportId)]);
    if (!task || !report || report.taskId !== task._id) throw new Error('Report not found');
    return { postIds: await postShiftReport(ctx, task, report) };
  },
});
