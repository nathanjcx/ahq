import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { cleanText, type Ctx } from '../shared';

export type ChannelKind = Doc<'channels'>['kind'];
export type ChannelScope = [kind: ChannelKind, scopeId: string];

const POST_TEXT_LIMIT = 5_000;

/** Channels for a whole workspace carry no scope; floor and project channels carry their id. */
const WORKSPACE_SCOPE_NAMES: Record<'workspace' | 'triage' | 'audit', string> = {
  workspace: 'Workspace',
  triage: 'Triage',
  audit: 'Audit',
};

/** The live name of a channel's scope, so a renamed floor renames its channel. */
export async function channelName(ctx: Ctx, kind: ChannelKind, scopeId: string) {
  if (kind === 'floor') return (await ctx.db.get(scopeId as Id<'floors'>))?.name ?? 'Floor';
  if (kind === 'project') return (await ctx.db.get(scopeId as Id<'projects'>))?.name ?? 'Project';
  return WORKSPACE_SCOPE_NAMES[kind];
}

/** The channel for one scope, or null when nothing has been posted there yet. */
export function findChannel(
  ctx: Ctx,
  workspaceId: Id<'workspaces'>,
  kind: ChannelKind,
  scopeId: string,
): Promise<Doc<'channels'> | null> {
  return ctx.db
    .query('channels')
    .withIndex('by_workspace_kind_scope', (q) =>
      q.eq('workspaceId', workspaceId).eq('kind', kind).eq('scopeId', scopeId),
    )
    .unique();
}

/** Channels are created the first time something is posted to them, or when a person opens one. */
export async function channelFor(
  ctx: MutationCtx,
  workspaceId: Id<'workspaces'>,
  kind: ChannelKind,
  scopeId: string,
): Promise<Doc<'channels'>> {
  const existing = await findChannel(ctx, workspaceId, kind, scopeId);
  if (existing) return existing;
  const channelId = await ctx.db.insert('channels', {
    workspaceId,
    kind,
    scopeId,
    name: await channelName(ctx, kind, scopeId),
    createdAt: Date.now(),
  });
  const created = await ctx.db.get(channelId);
  if (!created) throw new Error('Channel not found');
  return created;
}

export interface PostInput {
  channel: Doc<'channels'>;
  kind: Doc<'posts'>['kind'];
  authorSubject?: string;
  authorEmployeeId?: Id<'installations'>;
  authorName: string;
  text: string;
  taskId?: Id<'tasks'>;
  toEmployeeId?: Id<'installations'>;
  reportId?: Id<'reports'>;
  handoff?: Doc<'posts'>['handoff'];
}

/** The one path that writes a post. Text is trimmed and capped; the channel fixes the workspace. */
export async function insertPost(ctx: MutationCtx, input: PostInput) {
  const postId = await ctx.db.insert('posts', {
    workspaceId: input.channel.workspaceId,
    channelId: input.channel._id,
    kind: input.kind,
    authorSubject: input.authorSubject,
    authorEmployeeId: input.authorEmployeeId,
    authorName: input.authorName,
    text: cleanText(input.text, 'Post', POST_TEXT_LIMIT),
    taskId: input.taskId,
    toEmployeeId: input.toEmployeeId,
    reportId: input.reportId,
    handoff: input.handoff,
    createdAt: Date.now(),
  });
  return { postId };
}

/** The channels a task belongs to: its floor, and its project when it has one. */
export function taskScopes(task: Doc<'tasks'>): ChannelScope[] {
  return [
    ...(task.floorId ? [['floor', task.floorId] as ChannelScope] : []),
    ...(task.projectId ? [['project', task.projectId] as ChannelScope] : []),
  ];
}

/** A task's own trace, written to every channel it belongs to. */
export async function systemPost(ctx: MutationCtx, task: Doc<'tasks'>, text: string) {
  for (const [kind, scopeId] of taskScopes(task)) {
    await insertPost(ctx, {
      channel: await channelFor(ctx, task.workspaceId, kind, scopeId),
      kind: 'system',
      authorEmployeeId: task.employeeId,
      authorName: task.employeeName,
      text: text.slice(0, 2_000),
      taskId: task._id,
    });
  }
}

export async function insertNote(
  ctx: MutationCtx,
  input: {
    floor: Doc<'floors'>;
    authorSubject?: string;
    authorEmployeeId?: Id<'installations'>;
    authorName: string;
    text: string;
    taskId?: Id<'tasks'>;
  },
) {
  if (input.floor.archivedAt !== undefined) throw new Error('Floor is archived');
  return insertPost(ctx, {
    channel: await channelFor(ctx, input.floor.workspaceId, 'floor', input.floor._id),
    kind: 'note',
    authorSubject: input.authorSubject,
    authorEmployeeId: input.authorEmployeeId,
    authorName: input.authorName,
    text: input.text,
    taskId: input.taskId,
  });
}

/** A handoff names a staffed employee, a brief, and the task whose result carries the context. */
export async function insertHandoff(
  ctx: MutationCtx,
  input: {
    floor: Doc<'floors'>;
    authorSubject?: string;
    authorEmployeeId?: Id<'installations'>;
    authorName: string;
    toEmployeeId: Id<'installations'>;
    brief: string;
    sourceTaskId?: Id<'tasks'>;
  },
) {
  if (input.floor.archivedAt !== undefined) throw new Error('Floor is archived');
  const installation = await ctx.db.get(input.toEmployeeId);
  if (!installation || installation.workspaceId !== input.floor.workspaceId)
    throw new Error('Employee not found');
  if (!input.floor.employeeIds.includes(installation._id))
    throw new Error('Employee is not assigned to this floor');
  const version = await ctx.db.get(installation.versionId);
  if (!version) throw new Error('Employee version is retired');
  const brief = cleanText(input.brief, 'Handoff brief', POST_TEXT_LIMIT);
  return insertPost(ctx, {
    channel: await channelFor(ctx, input.floor.workspaceId, 'floor', input.floor._id),
    kind: 'handoff',
    authorSubject: input.authorSubject,
    authorEmployeeId: input.authorEmployeeId,
    authorName: input.authorName,
    text: brief,
    taskId: input.sourceTaskId,
    handoff: { toEmployeeId: installation._id, toEmployeeName: version.name, brief, status: 'pending' },
  });
}

/** One post exactly as the interface renders it. */
export function publicPost(post: Doc<'posts'>) {
  return {
    id: post._id,
    channelId: post.channelId,
    kind: post.kind,
    authorSubject: post.authorSubject,
    authorEmployeeId: post.authorEmployeeId,
    authorName: post.authorName,
    text: post.text,
    taskId: post.taskId,
    toEmployeeId: post.toEmployeeId,
    handoff: post.handoff,
    createdAt: post.createdAt,
  };
}

/** Newest posts in one channel, oldest first, optionally paging back from a timestamp. */
export async function recentPosts(
  ctx: Ctx,
  channelId: Id<'channels'>,
  limit: number,
  before?: number,
): Promise<Doc<'posts'>[]> {
  const posts = await ctx.db
    .query('posts')
    .withIndex('by_channel', (q) =>
      before === undefined
        ? q.eq('channelId', channelId)
        : q.eq('channelId', channelId).lt('createdAt', before),
    )
    .order('desc')
    .take(limit);
  return posts.reverse();
}
