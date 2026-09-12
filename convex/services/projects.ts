import { v } from 'convex/values';
import type { Id } from '../_generated/dataModel';
import { mutation, query } from '../_generated/server';
import {
  bottleneckPrompts,
  estimateTask,
  parseProposal,
  requireProject,
  type FloorCapacity,
} from '../lib/projects';
import { requireFloor } from '../lib/tasks';
import { requireService } from '../shared';

/** Active memory claims the planner should know about, newest first. */
const MEMORY_SAMPLE = 40;

/**
 * Everything the planner turn needs to propose a roadmap. The worker builds the prompt from this:
 * the brief, the floors and the instances staffed on them, what their work has cost before, the
 * parallelism each floor has, and the memory the workspace has already agreed on.
 */
export const plannerInputs = query({
  args: { secret: v.string(), projectId: v.id('projects') },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const project = await ctx.db.get(args.projectId);
    if (!project) throw new Error('Project not found');
    const floors = await Promise.all(
      project.floorIds.map(async (floorId) => {
        const floor = await requireFloor(ctx, project.workspaceId, floorId);
        const instances = await Promise.all(
          floor.employeeIds.map(async (employeeId) => {
            const installation = await ctx.db.get(employeeId);
            const version = installation ? await ctx.db.get(installation.versionId) : null;
            if (!installation || !version) return null;
            return {
              id: installation._id,
              name: installation.name ?? version.name,
              kind: installation.kind ?? 'worker',
              status: installation.status,
              versionId: version._id,
              versionName: version.name,
              role: version.role,
              model: version.model,
              capabilities: version.capabilities,
              // History estimates are per version and cadence; roadmap tasks are daily.
              estimate: await estimateTask(ctx, project.workspaceId, version._id, 'daily'),
            };
          }),
        );
        return {
          id: floor._id,
          name: floor.name,
          brief: floor.brief,
          instances: instances.filter((instance) => instance !== null),
        };
      }),
    );
    // The memory module owns these tables; until it writes anything the planner simply sees none.
    const [projectMemory, workspaceMemory, settings] = await Promise.all([
      ctx.db
        .query('memories')
        .withIndex('by_scope_status', (q) =>
          q
            .eq('workspaceId', project.workspaceId)
            .eq('scope', 'project')
            .eq('scopeId', String(project._id))
            .eq('status', 'active'),
        )
        .take(MEMORY_SAMPLE),
      ctx.db
        .query('memories')
        .withIndex('by_scope_status', (q) =>
          q
            .eq('workspaceId', project.workspaceId)
            .eq('scope', 'workspace')
            .eq('scopeId', '')
            .eq('status', 'active'),
        )
        .take(MEMORY_SAMPLE),
      ctx.db
        .query('workspaceSettings')
        .withIndex('by_workspace', (q) => q.eq('workspaceId', project.workspaceId))
        .unique(),
    ]);
    return {
      project: { id: project._id, name: project.name, brief: project.brief, status: project.status },
      floors,
      capacity: {
        floors: floors.map((floor) => ({
          floorId: String(floor.id),
          name: floor.name,
          instances: floor.instances.length,
        })),
        maxConcurrentInstances: settings?.maxConcurrentInstances,
        dailyTokenCap: settings?.dailyTokenCap,
      },
      memory: [...projectMemory, ...workspaceMemory].map((memory) => ({
        scope: memory.scope,
        kind: memory.kind,
        text: memory.text,
        confidence: memory.confidence,
      })),
    };
  },
});

/**
 * Stores the planner's answer, with the bottleneck questions the platform can work out itself added
 * to whatever the planner already asked. Nothing exists until a person confirms the roadmap.
 */
export const recordProposal = mutation({
  args: { secret: v.string(), projectId: v.id('projects'), proposal: v.any() },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireService(args.secret);
    const project = await ctx.db.get(args.projectId);
    if (!project) throw new Error('Project not found');
    const proposal = parseProposal(args.proposal);
    const capacity: FloorCapacity[] = await Promise.all(
      project.floorIds.map(async (floorId: Id<'floors'>) => {
        const floor = await requireFloor(ctx, project.workspaceId, floorId);
        return { floorId: String(floor._id), name: floor.name, instances: floor.employeeIds.length };
      }),
    );
    const seen = new Set(proposal.prompts.map((prompt) => prompt.text));
    const prompts = [
      ...proposal.prompts,
      ...bottleneckPrompts(proposal, capacity).filter((prompt) => !seen.has(prompt.text)),
    ];
    await ctx.db.patch(project._id, {
      proposal: JSON.stringify({ ...proposal, prompts }),
      updatedAt: Date.now(),
    });
    return null;
  },
});

/** What a task's working memory says about the project it belongs to: the plan, the clock, the queue. */
export const projectContext = query({
  args: { secret: v.string(), taskId: v.id('tasks') },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error('Task not found');
    const project = task.projectId ? await requireProject(ctx, task.workspaceId, task.projectId) : undefined;
    const milestone = task.milestoneId ? await ctx.db.get(task.milestoneId) : null;
    const dependencies = await Promise.all(
      (task.dependsOn ?? []).map(async (id) => {
        const dependency = await ctx.db.get(id);
        return dependency ? { id: dependency._id, title: dependency.title, status: dependency.status } : null;
      }),
    );
    return {
      project: project && { id: project._id, name: project.name, brief: project.brief },
      milestone: milestone && {
        id: milestone._id,
        title: milestone.title,
        description: milestone.description,
        deadlineAt: milestone.deadlineAt,
      },
      cadence: task.cadence ?? 'once',
      deadlineAt: task.deadlineAt,
      dependencies: dependencies.filter((dependency) => dependency !== null),
    };
  },
});
