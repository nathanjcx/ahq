import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { cleanText } from '../shared';
import { requireFloor } from './tasks';

/** Posts on floor boards. The channels workstream generalizes these into channels and posts. */
export async function systemPost(ctx: MutationCtx, task: Doc<'tasks'>, text: string) {
  if (!task.floorId) return;
  await ctx.db.insert('floorPosts', {
    workspaceId: task.workspaceId,
    floorId: task.floorId,
    kind: 'system',
    authorName: task.employeeName,
    text: text.slice(0, 2_000),
    taskId: task._id,
    createdAt: Date.now(),
  });
}

export async function insertNote(
  ctx: MutationCtx,
  input: {
    floor: Doc<'floors'>;
    authorSubject?: string;
    authorName: string;
    text: string;
    taskId?: Id<'tasks'>;
  },
) {
  if (input.floor.archivedAt !== undefined) throw new Error('Floor is archived');
  const postId = await ctx.db.insert('floorPosts', {
    workspaceId: input.floor.workspaceId,
    floorId: input.floor._id,
    kind: 'note',
    authorSubject: input.authorSubject,
    authorName: input.authorName,
    text: cleanText(input.text, 'Post', 5_000),
    taskId: input.taskId,
    createdAt: Date.now(),
  });
  return { postId };
}

/** A handoff names a staffed employee, a brief, and the task whose result carries the context. */
export async function insertHandoff(
  ctx: MutationCtx,
  input: {
    floor: Doc<'floors'>;
    authorSubject?: string;
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
  const brief = cleanText(input.brief, 'Handoff brief', 5_000);
  const postId = await ctx.db.insert('floorPosts', {
    workspaceId: input.floor.workspaceId,
    floorId: input.floor._id,
    kind: 'handoff',
    authorSubject: input.authorSubject,
    authorName: input.authorName,
    text: brief,
    taskId: input.sourceTaskId,
    handoff: {
      toEmployeeId: installation._id,
      toEmployeeName: version.name,
      brief,
      status: 'pending',
    },
    createdAt: Date.now(),
  });
  return { postId };
}
