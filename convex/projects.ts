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
  requireProject,
  startTask,
} from './work';

function projectFields(name: string, brief: string) {
  return {
    name: cleanText(name, 'Project name', 120),
    brief: cleanText(brief, 'Project brief', 5_000),
  };
}

async function validateEmployees(
  ctx: MutationCtx,
  workspaceId: Id<'workspaces'>,
  employeeIds: Id<'installations'>[],
) {
  if (new Set(employeeIds).size !== employeeIds.length)
    throw new Error('A project cannot include the same employee more than once');
  for (const employeeId of employeeIds) {
    const employee = await ctx.db.get(employeeId);
    if (!employee || employee.workspaceId !== workspaceId) throw new Error('Employee not found');
  }
}

function publicPost(post: Doc<'projectPosts'>) {
  return {
    id: post._id,
    projectId: post.projectId,
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
  returns: v.object({ projectId: v.id('projects') }),
  handler: async (ctx, args) => {
    const { workspace, actor } = await requireWorkspace(ctx);
    const fields = projectFields(args.name, args.brief);
    await validateEmployees(ctx, workspace._id, args.employeeIds);
    const now = Date.now();
    const projectId = await ctx.db.insert('projects', {
      workspaceId: workspace._id,
      createdBy: actor.subject,
      ...fields,
      employeeIds: args.employeeIds,
      createdAt: now,
      updatedAt: now,
    });
    return { projectId };
  },
});

export const update = mutation({
  args: {
    projectId: v.id('projects'),
    name: v.string(),
    brief: v.string(),
    employeeIds: v.array(v.id('installations')),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspace(ctx);
    const project = await requireProject(ctx, workspace._id, args.projectId);
    const fields = projectFields(args.name, args.brief);
    await validateEmployees(ctx, workspace._id, args.employeeIds);
    await ctx.db.patch(project._id, { ...fields, employeeIds: args.employeeIds, updatedAt: Date.now() });
    return null;
  },
});

export const setArchived = mutation({
  args: { projectId: v.id('projects'), archived: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspace(ctx);
    const project = await requireProject(ctx, workspace._id, args.projectId);
    await ctx.db.patch(project._id, {
      archivedAt: args.archived ? project.archivedAt || Date.now() : undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

// No `returns` validator on the board: it would restate the whole post document including its
// nested handoff record, which the schema already defines.
export const board = query({
  args: { projectId: v.id('projects') },
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspace(ctx);
    await requireProject(ctx, workspace._id, args.projectId);
    const posts = await ctx.db
      .query('projectPosts')
      .withIndex('by_project', (q) => q.eq('projectId', args.projectId))
      .order('desc')
      .take(200);
    return posts.reverse().map(publicPost);
  },
});

export const post = mutation({
  args: { projectId: v.id('projects'), text: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { workspace, actor } = await requireWorkspace(ctx);
    const project = await requireProject(ctx, workspace._id, args.projectId);
    await insertNote(ctx, {
      project,
      authorSubject: actor.subject,
      authorName: actor.name,
      text: args.text,
    });
    return null;
  },
});

export const requestHandoff = mutation({
  args: {
    projectId: v.id('projects'),
    toEmployeeId: v.id('installations'),
    brief: v.string(),
    sourceTaskId: v.optional(v.id('tasks')),
  },
  returns: v.object({ postId: v.id('projectPosts') }),
  handler: async (ctx, args) => {
    const { workspace, actor } = await requireWorkspace(ctx);
    const project = await requireProject(ctx, workspace._id, args.projectId);
    if (args.sourceTaskId) {
      const source = await ctx.db.get(args.sourceTaskId);
      if (!source || source.workspaceId !== workspace._id || !canSeeTask(source, actor.subject))
        throw new Error('Task not found');
    }
    return insertHandoff(ctx, {
      project,
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
  args: { postId: v.id('projectPosts'), accepted: v.boolean() },
  returns: v.object({ taskId: v.optional(v.id('tasks')) }),
  handler: async (ctx, args) => {
    const { workspace, actor } = await requireWorkspace(ctx);
    const post = await ctx.db.get(args.postId);
    if (!post || post.workspaceId !== workspace._id || !post.handoff) throw new Error('Handoff not found');
    if (post.handoff.status !== 'pending') return { taskId: post.handoff.taskId };
    const project = await requireProject(ctx, workspace._id, post.projectId);
    const now = Date.now();
    if (!args.accepted) {
      await ctx.db.patch(post._id, {
        handoff: { ...post.handoff, status: 'declined', decidedBy: actor.subject, decidedAt: now },
      });
      return {};
    }
    if (!project.employeeIds.includes(post.handoff.toEmployeeId))
      throw new Error('Employee is not assigned to this project');
    await assertTokenCap(ctx, workspace);
    const { version } = await assertEmployeeReady(ctx, workspace, actor.subject, post.handoff.toEmployeeId);
    let prompt = post.handoff.brief;
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
      project: { projectId: project._id, projectContext: { name: project.name, brief: project.brief } },
      sourceTaskId: post.taskId,
    });
    await ctx.db.patch(post._id, {
      handoff: { ...post.handoff, status: 'accepted', decidedBy: actor.subject, decidedAt: now, taskId },
    });
    await ctx.db.insert('projectPosts', {
      workspaceId: workspace._id,
      projectId: project._id,
      kind: 'system',
      authorName: version.name,
      text: 'Accepted handoff → task created',
      taskId,
      createdAt: Date.now(),
    });
    return { taskId };
  },
});
