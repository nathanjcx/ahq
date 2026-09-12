import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { canSeeTask, cleanText, requireWorkspace, untrustedBlock } from './shared';
import {
  assertEmployeeReady,
  assertTokenCap,
  finalAssistantMessage,
  insertHandoff,
  insertNote,
  requireFloor,
  startTask,
} from './work';

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

function publicPost(post: Doc<'floorPosts'>) {
  return {
    id: post._id,
    floorId: post.floorId,
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
  args: { name: v.string(), brief: v.string(), employeeIds: v.array(v.id('installations')) },
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
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspace(ctx);
    const floor = await requireFloor(ctx, workspace._id, args.floorId);
    const fields = floorFields(args.name, args.brief);
    await validateEmployees(ctx, workspace._id, args.employeeIds);
    await ctx.db.patch(floor._id, { ...fields, employeeIds: args.employeeIds, updatedAt: Date.now() });
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
export const board = query({
  args: { floorId: v.id('floors') },
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspace(ctx);
    await requireFloor(ctx, workspace._id, args.floorId);
    const posts = await ctx.db
      .query('floorPosts')
      .withIndex('by_floor', (q) => q.eq('floorId', args.floorId))
      .order('desc')
      .take(200);
    return posts.reverse().map(publicPost);
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
  returns: v.object({ postId: v.id('floorPosts') }),
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
  args: { postId: v.id('floorPosts'), accepted: v.boolean() },
  returns: v.object({ taskId: v.optional(v.id('tasks')) }),
  handler: async (ctx, args) => {
    const { workspace, actor } = await requireWorkspace(ctx);
    const post = await ctx.db.get(args.postId);
    if (!post || post.workspaceId !== workspace._id || !post.handoff) throw new Error('Handoff not found');
    if (post.handoff.status !== 'pending') return { taskId: post.handoff.taskId };
    const floor = await requireFloor(ctx, workspace._id, post.floorId);
    const now = Date.now();
    if (!args.accepted) {
      await ctx.db.patch(post._id, {
        handoff: { ...post.handoff, status: 'declined', decidedBy: actor.subject, decidedAt: now },
      });
      return {};
    }
    if (!floor.employeeIds.includes(post.handoff.toEmployeeId))
      throw new Error('Employee is not assigned to this floor');
    await assertTokenCap(ctx, workspace);
    const { version } = await assertEmployeeReady(ctx, workspace, actor.subject, post.handoff.toEmployeeId);
    // A handoff a person wrote is an instruction. One an agent requested through the floor tools has
    // no author subject, and it is the previous employee's words, so it is delimited as material.
    let prompt = post.authorSubject ? post.handoff.brief : untrustedBlock(post.handoff.brief);
    // The carried context is another employee's output. It travels only to someone who could already
    // read the source task, and it is delimited so this employee treats it as material, not orders.
    const source = post.taskId ? await ctx.db.get(post.taskId) : null;
    if (source && canSeeTask(source, actor.subject)) {
      const closing = await finalAssistantMessage(ctx, source._id);
      if (closing)
        prompt = `${prompt}\n\nContext carried from ${source.title}:\n${untrustedBlock(
          closing.slice(0, 20_000),
        )}`;
    }
    const taskId = await startTask(ctx, {
      workspace,
      createdBy: actor.subject,
      createdByName: actor.name,
      employeeId: post.handoff.toEmployeeId,
      version,
      title: post.handoff.brief.slice(0, 200),
      prompt,
      floor: { floorId: floor._id, floorContext: { name: floor.name, brief: floor.brief } },
      sourceTaskId: post.taskId,
    });
    await ctx.db.patch(post._id, {
      handoff: { ...post.handoff, status: 'accepted', decidedBy: actor.subject, decidedAt: now, taskId },
    });
    await ctx.db.insert('floorPosts', {
      workspaceId: workspace._id,
      floorId: floor._id,
      kind: 'system',
      authorName: version.name,
      text: 'Accepted handoff → task created',
      taskId,
      createdAt: Date.now(),
    });
    return { taskId };
  },
});
