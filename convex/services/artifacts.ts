import { v } from 'convex/values';
import { mutation, query } from '../_generated/server';
import { canSeeTask, requireService } from '../shared';
import { workspaceForActor } from './context';

export const recordArtifact = mutation({
  args: {
    secret: v.string(),
    taskId: v.id('tasks'),
    name: v.string(),
    mediaType: v.string(),
    size: v.number(),
    storageKey: v.string(),
    sha256: v.string(),
  },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error('Task not found');
    // The archive key is the only thing the download route hands to object storage, and its last
    // segment is a provider-supplied file id. It has to stay inside this task's own prefix.
    const prefix = `${task.workspaceId}/${task._id}/`;
    if (
      !args.storageKey.startsWith(prefix) ||
      !/^[A-Za-z0-9_-]{1,200}$/.test(args.storageKey.slice(prefix.length))
    )
      throw new Error('Artifact storage key is outside this task');
    if (args.name.length > 300 || args.mediaType.length > 200 || !/^[0-9a-f]{64}$/.test(args.sha256))
      throw new Error('Artifact metadata is invalid');
    if (!Number.isFinite(args.size) || args.size < 0) throw new Error('Artifact size is invalid');
    const existing = (
      await ctx.db
        .query('artifacts')
        .withIndex('by_task', (q) => q.eq('taskId', task._id))
        .collect()
    ).find((artifact) => artifact.storageKey === args.storageKey && artifact.sha256 === args.sha256);
    if (existing) return { artifactId: existing._id };
    const artifactId = await ctx.db.insert('artifacts', {
      workspaceId: task.workspaceId,
      taskId: task._id,
      name: args.name,
      mediaType: args.mediaType,
      size: args.size,
      storageKey: args.storageKey,
      sha256: args.sha256,
      createdAt: Date.now(),
    });
    return { artifactId };
  },
});

export const artifactContext = query({
  args: {
    secret: v.string(),
    artifactId: v.id('artifacts'),
    authSubject: v.string(),
    authOrgId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const workspace = await workspaceForActor(ctx, args.authSubject, args.authOrgId);
    const artifact = await ctx.db.get(args.artifactId);
    if (!workspace || !artifact || artifact.workspaceId !== workspace._id)
      throw new Error('Artifact not found');
    const task = await ctx.db.get(artifact.taskId);
    if (!task || !canSeeTask(task, args.authSubject)) throw new Error('Artifact not found');
    return {
      artifact: {
        id: artifact._id,
        taskId: artifact.taskId,
        name: artifact.name,
        mediaType: artifact.mediaType,
        size: artifact.size,
        storageKey: artifact.storageKey,
        sha256: artifact.sha256,
        createdAt: artifact.createdAt,
      },
    };
  },
});
