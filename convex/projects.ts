import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import { createMeetingEntry } from './lib/calendar';
import { assertAcyclic, topologicalOrder } from './lib/dependencies';
import {
  meetingRequests,
  parseProposal,
  projectTaskView,
  projectView,
  requireProject,
  storedProposal,
} from './lib/projects';
import {
  assertEmployeeReady,
  assertTokenCap,
  assignmentForFloor,
  requireFloor,
  startTask,
} from './lib/tasks';
import { enqueuePlanningFor } from './services/projects';
import { canSeeTask, cleanText, requireWorkspace } from './shared';

const projectStatus = v.union(
  v.literal('planning'),
  v.literal('active'),
  v.literal('done'),
  v.literal('archived'),
);

function projectFields(name: string, brief: string) {
  return {
    name: cleanText(name, 'Project name', 120),
    brief: cleanText(brief, 'Project brief', 20_000),
  };
}

async function validateFloors(ctx: MutationCtx, workspaceId: Id<'workspaces'>, floorIds: Id<'floors'>[]) {
  if (!floorIds.length) throw new Error('A project runs on at least one floor');
  if (new Set(floorIds).size !== floorIds.length)
    throw new Error('A project cannot list the same floor twice');
  for (const floorId of floorIds) await requireFloor(ctx, workspaceId, floorId);
}

// No `returns` validator on the project views: they would restate the milestone and count shapes
// that lib/contracts and web-tests/projects.types.test.ts already pin down.
export const list = query({
  args: {},
  handler: async (ctx) => {
    const { workspace } = await requireWorkspace(ctx);
    const projects = await ctx.db
      .query('projects')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', workspace._id))
      .collect();
    return Promise.all(
      projects.sort((a, b) => b.updatedAt - a.updatedAt).map((project) => projectView(ctx, project)),
    );
  },
});

/** One project with its milestones, its counts, and the planner proposal still awaiting a decision. */
export const get = query({
  args: { projectId: v.id('projects') },
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspace(ctx);
    const project = await requireProject(ctx, workspace._id, args.projectId);
    return { ...(await projectView(ctx, project)), proposal: storedProposal(project) };
  },
});

/** The project's work, in the order it was planned. Session tasks belong to the session that opened them. */
export const tasks = query({
  args: { projectId: v.id('projects') },
  handler: async (ctx, args) => {
    const { workspace, actor } = await requireWorkspace(ctx);
    const project = await requireProject(ctx, workspace._id, args.projectId);
    const rows = await ctx.db
      .query('tasks')
      .withIndex('by_project', (q) => q.eq('projectId', project._id))
      .collect();
    return rows
      .filter((task) => (task.kind ?? 'work') === 'work' && canSeeTask(task, actor.subject))
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(projectTaskView);
  },
});

export const create = mutation({
  args: { name: v.string(), brief: v.string(), floorIds: v.array(v.id('floors')) },
  returns: v.object({ projectId: v.id('projects') }),
  handler: async (ctx, args) => {
    const { workspace, actor } = await requireWorkspace(ctx);
    const fields = projectFields(args.name, args.brief);
    await validateFloors(ctx, workspace._id, args.floorIds);
    const now = Date.now();
    const projectId = await ctx.db.insert('projects', {
      workspaceId: workspace._id,
      createdBy: actor.subject,
      createdByName: actor.name,
      ...fields,
      floorIds: args.floorIds,
      status: 'planning',
      createdAt: now,
      updatedAt: now,
    });
    const project = await ctx.db.get(projectId);
    if (project) await enqueuePlanningFor(ctx, project);
    return { projectId };
  },
});

export const update = mutation({
  args: {
    projectId: v.id('projects'),
    name: v.string(),
    brief: v.string(),
    floorIds: v.array(v.id('floors')),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspace(ctx);
    const project = await requireProject(ctx, workspace._id, args.projectId);
    const fields = projectFields(args.name, args.brief);
    await validateFloors(ctx, workspace._id, args.floorIds);
    await ctx.db.patch(project._id, { ...fields, floorIds: args.floorIds, updatedAt: Date.now() });
    return null;
  },
});

export const setStatus = mutation({
  args: { projectId: v.id('projects'), status: projectStatus },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspace(ctx);
    const project = await requireProject(ctx, workspace._id, args.projectId);
    await ctx.db.patch(project._id, { status: args.status, updatedAt: Date.now() });
    return null;
  },
});

/**
 * Stores a roadmap the person edited. `v.any()` with a size cap and `parseProposal`: the proposal is
 * a nested document with keyed cross-references that a Convex validator cannot express compactly.
 */
export const saveProposal = mutation({
  args: { projectId: v.id('projects'), proposal: v.any() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspace(ctx);
    const project = await requireProject(ctx, workspace._id, args.projectId);
    await ctx.db.patch(project._id, {
      proposal: JSON.stringify(parseProposal(args.proposal)),
      updatedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Turns a confirmed roadmap into real work: milestones, then tasks in dependency order so every task
 * can name the ids it waits for, then the roadmap's meeting points as calendar entries with the
 * instances the plan staffs as their attendees.
 */
export const confirmProposal = mutation({
  args: { projectId: v.id('projects'), proposal: v.any() },
  returns: v.object({
    milestoneIds: v.array(v.id('milestones')),
    taskIds: v.array(v.id('tasks')),
    meetings: v.array(
      v.object({
        entryId: v.id('calendarEntries'),
        milestoneId: v.optional(v.id('milestones')),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const { workspace, actor } = await requireWorkspace(ctx);
    const project = await requireProject(ctx, workspace._id, args.projectId);
    await assertTokenCap(ctx, workspace);
    const proposal = parseProposal(args.proposal);
    assertAcyclic(proposal.milestones.map((milestone) => ({ id: milestone.key, ...milestone })));
    const tasks = proposal.milestones.flatMap((milestone) =>
      milestone.tasks.map((task) => ({ ...task, milestoneKey: milestone.key })),
    );
    const byKey = new Map(tasks.map((task) => [task.key, task]));
    if (byKey.size !== tasks.length) throw new Error('Two tasks in the roadmap share a key');
    const floorIds = new Set(project.floorIds.map(String));

    const now = Date.now();
    const milestoneIds = new Map<string, Id<'milestones'>>();
    for (const [order, milestone] of proposal.milestones.entries()) {
      milestoneIds.set(
        milestone.key,
        await ctx.db.insert('milestones', {
          workspaceId: workspace._id,
          projectId: project._id,
          order,
          title: milestone.title,
          description: milestone.description,
          deadlineAt: milestone.deadlineAt,
          dependsOn: [],
          status: 'planned',
          createdAt: now,
          updatedAt: now,
        }),
      );
    }
    for (const milestone of proposal.milestones) {
      const id = milestoneIds.get(milestone.key);
      if (!id) continue;
      await ctx.db.patch(id, {
        dependsOn: milestone.dependsOn.map((key) => {
          const dependency = milestoneIds.get(key);
          if (!dependency) throw new Error(`Milestone "${milestone.key}" depends on an unknown milestone`);
          return dependency;
        }),
      });
    }

    const taskIds = new Map<string, Id<'tasks'>>();
    for (const key of topologicalOrder(tasks.map((task) => ({ id: task.key, ...task })))) {
      const task = byKey.get(key);
      if (!task) continue;
      if (!task.employeeId) throw new Error(`Task "${task.title}" needs an employee before it can start`);
      if (!floorIds.has(task.floorId)) throw new Error(`Task "${task.title}" names a floor off this project`);
      const employeeId = task.employeeId as Id<'installations'>;
      const { version } = await assertEmployeeReady(ctx, workspace, actor.subject, employeeId);
      taskIds.set(
        key,
        await startTask(ctx, {
          workspace,
          createdBy: actor.subject,
          createdByName: actor.name,
          employeeId,
          version,
          title: task.title,
          prompt: task.prompt,
          floor: await assignmentForFloor(ctx, workspace._id, task.floorId as Id<'floors'>, employeeId),
          projectId: project._id,
          milestoneId: milestoneIds.get(task.milestoneKey),
          cadence: 'daily',
          deadlineAt: task.deadlineAt,
          dependsOn: task.dependsOn.map((dependency) => {
            const id = taskIds.get(dependency);
            if (!id) throw new Error(`Task "${task.key}" depends on an unknown task`);
            return id;
          }),
        }),
      );
    }

    // Everyone the roadmap staffs attends its meeting points; a person edits the list afterwards.
    const attendees = await Promise.all(
      [...new Set(tasks.map((task) => task.employeeId))]
        .filter((id): id is string => Boolean(id))
        .map(async (id) => {
          const installation = await ctx.db.get(id as Id<'installations'>);
          const version = installation ? await ctx.db.get(installation.versionId) : null;
          return { kind: 'employee' as const, id, name: installation?.name ?? version?.name ?? 'Employee' };
        }),
    );
    const meetings = [];
    for (const { milestoneKey, ...meeting } of meetingRequests(proposal))
      meetings.push({
        entryId: await createMeetingEntry(ctx, workspace, actor, {
          ...meeting,
          projectId: project._id,
          attendees,
          agenda: [],
        }),
        milestoneId: milestoneKey ? milestoneIds.get(milestoneKey) : undefined,
      });

    await ctx.db.patch(project._id, { status: 'active', proposal: undefined, updatedAt: Date.now() });
    return { milestoneIds: [...milestoneIds.values()], taskIds: [...taskIds.values()], meetings };
  },
});

/** Sends a project back to planning and drops the stale proposal. The work already created stays. */
export const replan = mutation({
  args: { projectId: v.id('projects') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspace(ctx);
    const project = await requireProject(ctx, workspace._id, args.projectId);
    await ctx.db.patch(project._id, { status: 'planning', proposal: undefined, updatedAt: Date.now() });
    const refreshed = await ctx.db.get(project._id);
    if (refreshed) await enqueuePlanningFor(ctx, refreshed);
    return null;
  },
});

export const archive = mutation({
  args: { projectId: v.id('projects') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspace(ctx);
    const project = await requireProject(ctx, workspace._id, args.projectId);
    await ctx.db.patch(project._id, { status: 'archived', updatedAt: Date.now() });
    return null;
  },
});
