import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import type { QueryCtx } from './_generated/server';
import { channelFor, channelName, insertPost, publicPost, recentPosts, type ChannelKind } from './lib/posts';
import {
  assertEmployeeReady,
  assertTokenCap,
  assignmentForFloor,
  requireFloor,
  startTask,
} from './lib/tasks';
import { channelKind } from './schema';
import { requireWorkspace, untrustedBlock, type Ctx } from './shared';

/** Unread is a badge, not a ledger: past this many a channel simply reads as busy. */
const UNREAD_CAP = 50;
const PAGE_LIMIT = 200;

async function requireChannel(ctx: Ctx, workspaceId: Id<'workspaces'>, channelId: Id<'channels'>) {
  const channel = await ctx.db.get(channelId);
  if (!channel || channel.workspaceId !== workspaceId) throw new Error('Channel not found');
  return channel;
}

function readMarker(ctx: Ctx, channelId: Id<'channels'>, subject: string) {
  return ctx.db
    .query('channelReads')
    .withIndex('by_channel_subject', (q) => q.eq('channelId', channelId).eq('subject', subject))
    .unique();
}

async function unreadCount(ctx: QueryCtx, channel: Doc<'channels'>, subject: string) {
  const marker = await readMarker(ctx, channel._id, subject);
  const since = marker?.lastReadAt ?? 0;
  const posts = await ctx.db
    .query('posts')
    .withIndex('by_channel', (q) => q.eq('channelId', channel._id).gt('createdAt', since))
    .take(UNREAD_CAP + 1);
  return posts.filter((post) => post.authorSubject !== subject).length;
}

/** A scope only becomes a channel once it exists in this workspace. */
async function assertScope(ctx: Ctx, workspaceId: Id<'workspaces'>, kind: ChannelKind, scopeId: string) {
  if (kind === 'floor') {
    await requireFloor(ctx, workspaceId, scopeId as Id<'floors'>);
    return;
  }
  if (kind === 'project') {
    const project = await ctx.db.get(scopeId as Id<'projects'>);
    if (!project || project.workspaceId !== workspaceId) throw new Error('Project not found');
    return;
  }
  if (scopeId !== '') throw new Error('This channel covers the whole workspace');
}

/** Every channel in the workspace, with the viewer's unread count. People see all of them. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const { workspace, actor } = await requireWorkspace(ctx);
    const channels = await ctx.db
      .query('channels')
      .withIndex('by_workspace_kind_scope', (q) => q.eq('workspaceId', workspace._id))
      .collect();
    return Promise.all(
      channels.map(async (channel) => ({
        id: channel._id,
        kind: channel.kind,
        scopeId: channel.scopeId,
        name: await channelName(ctx, channel.kind, channel.scopeId),
        unread: await unreadCount(ctx, channel, actor.subject),
      })),
    );
  },
});

/** The channel for one scope, created on first use so an empty floor still has somewhere to post. */
export const open = mutation({
  args: { kind: channelKind, scopeId: v.string() },
  returns: v.object({ channelId: v.id('channels') }),
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspace(ctx);
    await assertScope(ctx, workspace._id, args.kind, args.scopeId);
    const channel = await channelFor(ctx, workspace._id, args.kind, args.scopeId);
    return { channelId: channel._id };
  },
});

export const posts = query({
  args: { channelId: v.id('channels'), before: v.optional(v.number()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspace(ctx);
    const channel = await requireChannel(ctx, workspace._id, args.channelId);
    const limit = Math.min(Math.max(Math.floor(args.limit ?? PAGE_LIMIT), 1), PAGE_LIMIT);
    return (await recentPosts(ctx, channel._id, limit, args.before)).map(publicPost);
  },
});

export const post = mutation({
  args: {
    channelId: v.id('channels'),
    text: v.string(),
    kind: v.union(v.literal('note'), v.literal('decision')),
    toEmployeeId: v.optional(v.id('installations')),
  },
  returns: v.object({ postId: v.id('posts') }),
  handler: async (ctx, args) => {
    const { workspace, actor } = await requireWorkspace(ctx);
    const channel = await requireChannel(ctx, workspace._id, args.channelId);
    if (channel.kind === 'floor') {
      const floor = await requireFloor(ctx, workspace._id, channel.scopeId as Id<'floors'>);
      if (floor.archivedAt !== undefined) throw new Error('Floor is archived');
    }
    if (args.toEmployeeId) {
      const installation = await ctx.db.get(args.toEmployeeId);
      if (!installation || installation.workspaceId !== workspace._id) throw new Error('Employee not found');
    }
    return insertPost(ctx, {
      channel,
      kind: args.kind,
      authorSubject: actor.subject,
      authorName: actor.name,
      text: args.text,
      toEmployeeId: args.toEmployeeId,
    });
  },
});

export const markRead = mutation({
  args: { channelId: v.id('channels') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { workspace, actor } = await requireWorkspace(ctx);
    const channel = await requireChannel(ctx, workspace._id, args.channelId);
    const marker = await readMarker(ctx, channel._id, actor.subject);
    const lastReadAt = Date.now();
    if (marker) await ctx.db.patch(marker._id, { lastReadAt });
    else
      await ctx.db.insert('channelReads', {
        workspaceId: workspace._id,
        channelId: channel._id,
        subject: actor.subject,
        lastReadAt,
      });
    return null;
  },
});

/** Everything one instance posted, anywhere in the workspace, newest last. */
export const employeeFeed = query({
  args: { employeeId: v.id('installations') },
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspace(ctx);
    const installation = await ctx.db.get(args.employeeId);
    if (!installation || installation.workspaceId !== workspace._id) throw new Error('Employee not found');
    const rows = await ctx.db
      .query('posts')
      .withIndex('by_employee', (q) => q.eq('authorEmployeeId', args.employeeId))
      .order('desc')
      .take(PAGE_LIMIT);
    return rows.reverse().map(publicPost);
  },
});

/**
 * An addressed note becomes a small task for the employee it names. A person accepts it, and text
 * an agent wrote travels as material rather than as instructions.
 */
export const acceptAddressed = mutation({
  args: { postId: v.id('posts') },
  returns: v.object({ taskId: v.id('tasks') }),
  handler: async (ctx, args) => {
    const { workspace, actor } = await requireWorkspace(ctx);
    const row = await ctx.db.get(args.postId);
    if (!row || row.workspaceId !== workspace._id || !row.toEmployeeId) throw new Error('Note not found');
    if (row.acceptedTaskId) return { taskId: row.acceptedTaskId };
    const channel = await requireChannel(ctx, workspace._id, row.channelId);
    await assertTokenCap(ctx, workspace);
    const { version } = await assertEmployeeReady(ctx, workspace, actor.subject, row.toEmployeeId);
    const taskId = await startTask(ctx, {
      workspace,
      createdBy: actor.subject,
      createdByName: actor.name,
      employeeId: row.toEmployeeId,
      version,
      title: row.text.slice(0, 200),
      prompt: row.authorSubject ? row.text : untrustedBlock(row.text),
      floor:
        channel.kind === 'floor'
          ? await assignmentForFloor(ctx, workspace._id, channel.scopeId as Id<'floors'>, row.toEmployeeId)
          : undefined,
    });
    await ctx.db.patch(row._id, { acceptedTaskId: taskId });
    return { taskId };
  },
});
