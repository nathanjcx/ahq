import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import { acceptHandoff } from './lib/handoffs';
import { findChannel, insertHandoff, insertNote, recentPosts } from './lib/posts';
import { requireFloor } from './lib/tasks';
import { canSeeTask, cleanText, requireWorkspace } from './shared';

const handoffPolicy = v.union(v.literal('ask'), v.literal('auto'));

function floorFields(name: string, brief: string) {
  return {
    name: cleanText(name, 'Floor name', 120),
    brief: cleanText(brief, 'Floor brief', 5_000),
  };
}

async function validateEmployees(
  ctx: MutationCtx,
  workspaceId: Id<'workspaces'>,
  employeeIds: Id<'installations'>[],
) {
  if (new Set(employeeIds).size !== employeeIds.length)
    throw new Error('A floor cannot include the same employee more than once');
  for (const employeeId of employeeIds) {
    const employee = await ctx.db.get(employeeId);
    if (!employee || employee.workspaceId !== workspaceId) throw new Error('Employee not found');
  }
}

/** The board shows the three post kinds it has always shown; the rest live in the channel. */
const BOARD_KINDS = ['note', 'system', 'handoff'] as const;
type BoardKind = (typeof BOARD_KINDS)[number];

function isBoardPost(post: Doc<'posts'>): post is Doc<'posts'> & { kind: BoardKind } {
  return (BOARD_KINDS as readonly string[]).includes(post.kind);
}

function boardPost(floorId: Id<'floors'>, post: Doc<'posts'> & { kind: BoardKind }) {
  return {
    id: post._id,
    floorId,
    kind: post.kind,
    authorSubject: post.authorSubject,
    authorName: post.authorName,
    text: post.text,
    taskId: post.taskId,
    createdAt: post.createdAt,
    handoff: post.handoff,
  };
}

export const create = mutation({
  args: {
    name: v.string(),
    brief: v.string(),
    employeeIds: v.array(v.id('installations')),
    handoffs: v.optional(handoffPolicy),
  },
  returns: v.object({ floorId: v.id('floors') }),
  handler: async (ctx, args) => {
    const { workspace, actor } = await requireWorkspace(ctx);
    const fields = floorFields(args.name, args.brief);
    await validateEmployees(ctx, workspace._id, args.employeeIds);
    const now = Date.now();
    const floorId = await ctx.db.insert('floors', {
      workspaceId: workspace._id,
      createdBy: actor.subject,
      ...fields,
      employeeIds: args.employeeIds,
      handoffs: args.handoffs,
      createdAt: now,
      updatedAt: now,
    });
    return { floorId };
  },
});

export const update = mutation({
  args: {
    floorId: v.id('floors'),
    name: v.string(),
    brief: v.string(),
    employeeIds: v.array(v.id('installations')),
    handoffs: v.optional(handoffPolicy),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspace(ctx);
    const floor = await requireFloor(ctx, workspace._id, args.floorId);
    const fields = floorFields(args.name, args.brief);
    await validateEmployees(ctx, workspace._id, args.employeeIds);
    await ctx.db.patch(floor._id, {
      ...fields,
      employeeIds: args.employeeIds,
      handoffs: args.handoffs,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const setArchived = mutation({
  args: { floorId: v.id('floors'), archived: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspace(ctx);
    const floor = await requireFloor(ctx, workspace._id, args.floorId);
    await ctx.db.patch(floor._id, {
      archivedAt: args.archived ? floor.archivedAt || Date.now() : undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

// No `returns` validator on the board: it would restate the whole post document including its
// nested handoff record, which the schema already defines.
/** The floor channel under the board's old name, until the interface moves to `channels`. */
export const board = query({
  args: { floorId: v.id('floors') },
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspace(ctx);
    await requireFloor(ctx, workspace._id, args.floorId);
    const channel = await findChannel(ctx, workspace._id, 'floor', args.floorId);
    if (!channel) return [];
    const posts = await recentPosts(ctx, channel._id, 200);
    return posts.filter(isBoardPost).map((post) => boardPost(args.floorId, post));
  },
});

export const post = mutation({
  args: { floorId: v.id('floors'), text: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { workspace, actor } = await requireWorkspace(ctx);
    const floor = await requireFloor(ctx, workspace._id, args.floorId);
    await insertNote(ctx, {
      floor,
      authorSubject: actor.subject,
      authorName: actor.name,
      text: args.text,
    });
    return null;
  },
});

export const requestHandoff = mutation({
  args: {
    floorId: v.id('floors'),
    toEmployeeId: v.id('installations'),
    brief: v.string(),
    sourceTaskId: v.optional(v.id('tasks')),
  },
  returns: v.object({ postId: v.id('posts') }),
  handler: async (ctx, args) => {
    const { workspace, actor } = await requireWorkspace(ctx);
    const floor = await requireFloor(ctx, workspace._id, args.floorId);
    if (args.sourceTaskId) {
      const source = await ctx.db.get(args.sourceTaskId);
      if (!source || source.workspaceId !== workspace._id || !canSeeTask(source, actor.subject))
        throw new Error('Task not found');
    }
    return insertHandoff(ctx, {
      floor,
      authorSubject: actor.subject,
      authorName: actor.name,
      toEmployeeId: args.toEmployeeId,
      brief: args.brief,
      sourceTaskId: args.sourceTaskId,
    });
  },
});

/** A person accepts a handoff, which starts a floor task carrying the source task's final message. */
export const decideHandoff = mutation({
  args: { postId: v.id('posts'), accepted: v.boolean() },
  returns: v.object({ taskId: v.optional(v.id('tasks')) }),
  handler: async (ctx, args) => {
    const { workspace, actor } = await requireWorkspace(ctx);
    const post = await ctx.db.get(args.postId);
    if (!post || post.workspaceId !== workspace._id || !post.handoff) throw new Error('Handoff not found');
    if (post.handoff.status !== 'pending') return { taskId: post.handoff.taskId };
    const channel = await ctx.db.get(post.channelId);
    if (!channel || channel.kind !== 'floor') throw new Error('Handoff not found');
    const floor = await requireFloor(ctx, workspace._id, channel.scopeId as Id<'floors'>);
    const now = Date.now();
    if (!args.accepted) {
      await ctx.db.patch(post._id, {
        handoff: { ...post.handoff, status: 'declined', decidedBy: actor.subject, decidedAt: now },
      });
      return {};
    }
    const taskId = await acceptHandoff(ctx, workspace, { ...post, handoff: post.handoff }, floor, actor);
    return { taskId };
  },
});
