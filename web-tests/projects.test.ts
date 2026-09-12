import { describe, expect, it } from 'vitest';
import { api } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import { estimateTask } from '../convex/lib/projects';
import type { RoadmapProposal } from '../lib/contracts';
import { harness, identity as orgIdentity, linearWorkspace, publishEmployee, secret } from './support';
import type { Harness } from './support';

const DAY = 24 * 60 * 60 * 1_000;
const estimate = { workingHours: 4, tokens: 1_000, confidence: 0.3, model: 'gpt-5.6-terra' as const };

/** A workspace with one floor, one staffed employee, and one project in planning. */
async function setup() {
  const t = harness();
  await linearWorkspace(t);
  const { versionId } = await publishEmployee(t);
  const user = t.withIdentity(orgIdentity('owner', 'acme'));
  await user.mutation(api.workspace.bootstrap, { name: 'Acme' });
  const { employeeId } = await user.mutation(api.marketplace.hire, { versionId });
  const { floorId } = await user.mutation(api.floors.create, {
    name: 'Marketing',
    brief: 'Own the launch.',
    employeeIds: [employeeId],
  });
  const { projectId } = await user.mutation(api.projects.create, {
    name: 'Launch',
    brief: 'Ship the new site.',
    floorIds: [floorId],
  });
  return { t, user, versionId, employeeId, floorId, projectId };
}

function roadmap(floorId: string, employeeId: string): RoadmapProposal {
  return {
    staffing: [{ floorId, employeeIds: [employeeId], suggestedHires: [] }],
    milestones: [
      {
        key: 'm1',
        title: 'Copy',
        description: 'Write the page.',
        deadlineAt: 10 * DAY,
        dependsOn: [],
        tasks: [
          {
            key: 'draft',
            title: 'Draft copy',
            prompt: 'Draft the launch copy.',
            employeeId,
            floorId,
            dependsOn: [],
            deadlineAt: 5 * DAY,
            estimate,
          },
        ],
      },
      {
        key: 'm2',
        title: 'Review',
        description: 'Review the page.',
        dependsOn: ['m1'],
        tasks: [
          {
            key: 'review',
            title: 'Review copy',
            prompt: 'Review the launch copy.',
            employeeId,
            floorId,
            dependsOn: ['draft'],
            deadlineAt: 9 * DAY,
            estimate,
          },
        ],
      },
    ],
    meetings: [{ title: 'Kickoff', startsAt: DAY, purpose: 'Agree the plan.', milestoneKey: 'm2' }],
    prompts: [],
    projectedTokens: 2_000,
  };
}

/** Runs a task's start command through the queue and reports the session's outcome. */
async function finishTask(t: Harness, taskId: Id<'tasks'>, status: 'completed' | 'failed') {
  const jobs = await t.mutation(api.services.queue.claimJobs, { secret, workerId: 'worker-1', limit: 10 });
  const start = jobs.find((job) => job.taskId === taskId && job.kind === 'start_task');
  if (!start) throw new Error('Expected a start command for this task');
  await t.mutation(api.services.queue.completeJob, {
    secret,
    jobId: start.id,
    leaseToken: start.leaseToken,
  });
  const session = await t.query(api.services.sessions.sessionContext, { secret, taskId });
  await t.mutation(api.services.sessions.recordEvents, {
    secret,
    taskId,
    events: [],
    status,
    inputRevision: session.inputRevision,
  });
}

describe('projects and roadmaps', () => {
  it('confirms a roadmap into milestones, dependent tasks, and meeting requests', async () => {
    const { t, user, floorId, employeeId, projectId } = await setup();
    const proposal = roadmap(floorId, employeeId);
    await user.mutation(api.projects.saveProposal, { projectId, proposal });
    expect(await user.query(api.projects.get, { projectId })).toMatchObject({
      status: 'planning',
      proposal: { projectedTokens: 2_000 },
    });

    const confirmed = await user.mutation(api.projects.confirmProposal, { projectId, proposal });
    expect(confirmed.milestoneIds).toHaveLength(2);
    expect(confirmed.taskIds).toHaveLength(2);
    expect(confirmed.meetings).toEqual([
      {
        title: 'Kickoff',
        startsAt: DAY,
        endsAt: DAY + 30 * 60_000,
        purpose: 'Agree the plan.',
        milestoneId: confirmed.milestoneIds[1],
      },
    ]);

    const project = await user.query(api.projects.get, { projectId });
    expect(project).toMatchObject({ status: 'active', openTasks: 2 });
    expect(project.proposal).toBeUndefined();
    expect(project.milestones.map((milestone) => milestone.order)).toEqual([0, 1]);
    expect(project.milestones[1].dependsOn).toEqual([confirmed.milestoneIds[0]]);
    expect(project.milestones.flatMap((milestone) => milestone.taskIds).sort()).toEqual(
      [...confirmed.taskIds].sort(),
    );

    // The first task is queued; the one that depends on it waits without a queue command.
    const [draft, review] = await Promise.all(
      confirmed.taskIds.map((taskId) => t.run((ctx) => ctx.db.get(taskId))),
    );
    expect(draft).toMatchObject({
      title: 'Draft copy',
      status: 'queued',
      cadence: 'daily',
      deadlineAt: 5 * DAY,
      projectId,
      floorContext: { name: 'Marketing' },
    });
    expect(review).toMatchObject({
      title: 'Review copy',
      status: 'waiting',
      dependsOn: [confirmed.taskIds[0]],
    });
    expect(
      await t.run((ctx) =>
        ctx.db
          .query('jobs')
          .withIndex('by_task_state', (q) => q.eq('taskId', confirmed.taskIds[1]).eq('state', 'queued'))
          .collect(),
      ),
    ).toEqual([]);
    expect((await user.query(api.projects.list, {}))[0]).toMatchObject({ id: projectId, openTasks: 2 });
  });

  it('refuses a roadmap whose tasks depend on each other', async () => {
    const { user, floorId, employeeId, projectId } = await setup();
    const proposal = roadmap(floorId, employeeId);
    proposal.milestones[0].tasks[0].dependsOn = ['review'];
    await expect(user.mutation(api.projects.confirmProposal, { projectId, proposal })).rejects.toThrow(
      'Dependency cycle',
    );
    // Nothing was created, so the project is still planning its way there.
    expect(await user.query(api.projects.get, { projectId })).toMatchObject({
      status: 'planning',
      milestones: [],
    });
  });

  it('keeps a project inside its workspace and on its own floors', async () => {
    const { t, user, floorId, employeeId, projectId } = await setup();
    const outsider = t.withIdentity(orgIdentity('outsider', 'other'));
    await outsider.mutation(api.workspace.bootstrap, { name: 'Other' });
    await expect(outsider.query(api.projects.get, { projectId })).rejects.toThrow('Project not found');
    expect(await outsider.query(api.projects.list, {})).toEqual([]);

    const { floorId: otherFloorId } = await user.mutation(api.floors.create, {
      name: 'Support',
      brief: 'Answer the questions.',
      employeeIds: [employeeId],
    });
    const proposal = roadmap(floorId, employeeId);
    proposal.milestones[0].tasks[0].floorId = otherFloorId;
    await expect(user.mutation(api.projects.confirmProposal, { projectId, proposal })).rejects.toThrow(
      'names a floor off this project',
    );
  });
});

describe('task dependencies', () => {
  it('releases a waiting task when its dependency completes', async () => {
    const { t, user, employeeId, floorId } = await setup();
    const { taskId: firstId } = await user.mutation(api.tasks.create, {
      employeeId,
      floorId,
      title: 'Gather the numbers',
      prompt: 'Gather the numbers.',
    });
    const { taskId: secondId } = await user.mutation(api.tasks.create, {
      employeeId,
      floorId,
      title: 'Write the summary',
      prompt: 'Write the summary.',
      dependsOn: [firstId],
    });
    expect((await t.run((ctx) => ctx.db.get(secondId)))?.status).toBe('waiting');

    await finishTask(t, firstId, 'completed');
    expect((await t.run((ctx) => ctx.db.get(secondId)))?.status).toBe('queued');
    const jobs = await t.run(async (ctx) =>
      ctx.db
        .query('jobs')
        .withIndex('by_task_state', (q) => q.eq('taskId', secondId).eq('state', 'queued'))
        .collect(),
    );
    expect(jobs.map((job) => job.kind)).toEqual(['start_task']);
  });

  it('blocks a waiting task when its dependency fails, and a person can requeue it', async () => {
    const { t, user, employeeId, floorId } = await setup();
    const { taskId: firstId } = await user.mutation(api.tasks.create, {
      employeeId,
      floorId,
      title: 'Gather the numbers',
      prompt: 'Gather the numbers.',
    });
    const { taskId: secondId } = await user.mutation(api.tasks.create, {
      employeeId,
      floorId,
      title: 'Write the summary',
      prompt: 'Write the summary.',
      dependsOn: [firstId],
    });

    await finishTask(t, firstId, 'failed');
    expect(await t.run((ctx) => ctx.db.get(secondId))).toMatchObject({
      status: 'blocked',
      error: 'Blocked: Gather the numbers failed',
    });

    await user.mutation(api.tasks.unblock, { taskId: secondId });
    const unblocked = await t.run((ctx) => ctx.db.get(secondId));
    expect(unblocked).toMatchObject({ status: 'queued' });
    expect(unblocked?.error).toBeUndefined();
    await expect(user.mutation(api.tasks.unblock, { taskId: secondId })).rejects.toThrow(
      'This task is not blocked',
    );
  });

  it('blocks dependents when a person cancels the dependency', async () => {
    const { t, user, employeeId, floorId } = await setup();
    const { taskId: firstId } = await user.mutation(api.tasks.create, {
      employeeId,
      floorId,
      title: 'Gather the numbers',
      prompt: 'Gather the numbers.',
    });
    const { taskId: secondId } = await user.mutation(api.tasks.create, {
      employeeId,
      floorId,
      title: 'Write the summary',
      prompt: 'Write the summary.',
      dependsOn: [firstId],
    });

    await user.mutation(api.tasks.cancel, { taskId: firstId });
    expect(await t.run((ctx) => ctx.db.get(secondId))).toMatchObject({
      status: 'blocked',
      error: 'Blocked: Gather the numbers cancelled',
    });
  });

  it('refuses dependencies that cycle, repeat, or belong to another workspace', async () => {
    const { t, user, employeeId } = await setup();
    const outsider = t.withIdentity(orgIdentity('outsider', 'other'));
    await outsider.mutation(api.workspace.bootstrap, { name: 'Other' });
    const { versionId } = await publishEmployee(t, { name: 'Outside analyst' });
    const { employeeId: outsideEmployeeId } = await outsider.mutation(api.marketplace.hire, { versionId });
    const { taskId: foreignId } = await outsider.mutation(api.tasks.create, {
      employeeId: outsideEmployeeId,
      title: 'Their task',
      prompt: 'Their work.',
    });
    const { taskId: firstId } = await user.mutation(api.tasks.create, {
      employeeId,
      title: 'First',
      prompt: 'First piece.',
    });
    const { taskId: secondId } = await user.mutation(api.tasks.create, {
      employeeId,
      title: 'Second',
      prompt: 'Second piece.',
      dependsOn: [firstId],
    });

    await expect(
      user.mutation(api.tasks.create, {
        employeeId,
        title: 'Third',
        prompt: 'Third piece.',
        dependsOn: [foreignId],
      }),
    ).rejects.toThrow('A dependency must be a task in this workspace');
    await expect(
      user.mutation(api.tasks.create, {
        employeeId,
        title: 'Third',
        prompt: 'Third piece.',
        dependsOn: [firstId, firstId],
      }),
    ).rejects.toThrow('cannot depend on the same task twice');
    await expect(
      user.mutation(api.tasks.setDependencies, { taskId: firstId, dependsOn: [secondId] }),
    ).rejects.toThrow('Dependency cycle');
  });

  it('re-points dependencies, deadlines, and cadence, and releases work that no longer waits', async () => {
    const { t, user, employeeId, floorId } = await setup();
    const { taskId: firstId } = await user.mutation(api.tasks.create, {
      employeeId,
      floorId,
      title: 'Gather the numbers',
      prompt: 'Gather the numbers.',
    });
    const { taskId: secondId } = await user.mutation(api.tasks.create, {
      employeeId,
      floorId,
      title: 'Write the summary',
      prompt: 'Write the summary.',
      dependsOn: [firstId],
    });

    await user.mutation(api.tasks.setDeadline, { taskId: secondId, deadlineAt: 3 * DAY });
    await user.mutation(api.tasks.setCadence, { taskId: secondId, cadence: 'daily' });
    await user.mutation(api.tasks.setDependencies, { taskId: secondId, dependsOn: [] });
    expect(await t.run((ctx) => ctx.db.get(secondId))).toMatchObject({
      status: 'queued',
      cadence: 'daily',
      deadlineAt: 3 * DAY,
      dependsOn: [],
    });

    const stranger = t.withIdentity(orgIdentity('colleague', 'acme'));
    await expect(
      stranger.mutation(api.tasks.setDeadline, { taskId: secondId, deadlineAt: DAY }),
    ).rejects.toThrow('Only the person who created this task or an administrator can change it');
  });
});

describe('planner inputs', () => {
  it('describes the floors, capacity, and estimates a planner turn needs', async () => {
    const { t, user, projectId, floorId, employeeId, versionId } = await setup();
    const inputs = await t.query(api.services.projects.plannerInputs, { secret, projectId });
    expect(inputs.project).toMatchObject({ name: 'Launch', brief: 'Ship the new site.' });
    expect(inputs.capacity.floors).toEqual([{ floorId, name: 'Marketing', instances: 1 }]);
    expect(inputs.floors[0].instances[0]).toMatchObject({
      id: employeeId,
      versionId,
      // Without history the estimate is the per-model default at the confidence a guess deserves.
      estimate: { workingHours: 4, tokens: 90_000, confidence: 0.3, model: 'gpt-5.6-terra' },
    });

    // Once the workspace has completed work of the same cadence, the estimate comes from it.
    const { taskId } = await user.mutation(api.tasks.create, {
      employeeId,
      floorId,
      title: 'Daily work',
      prompt: 'Do the daily work.',
      cadence: 'daily',
    });
    await t.run(async (ctx) => {
      const task = await ctx.db.get(taskId);
      if (!task) throw new Error('Expected the task');
      await ctx.db.patch(taskId, {
        status: 'completed',
        usage: { input: 700, cached: 0, output: 300 },
        updatedAt: task.createdAt + 2 * 3_600_000,
      });
    });
    expect(
      await t.run(async (ctx) => {
        const task = await ctx.db.get(taskId);
        if (!task) throw new Error('Expected the task');
        return estimateTask(ctx, task.workspaceId, versionId, 'daily');
      }),
    ).toMatchObject({ workingHours: 2, tokens: 1_000, confidence: 0.4 });
  });

  it('stores a planner proposal with the bottleneck questions the platform can see', async () => {
    const { t, floorId, employeeId, projectId, user } = await setup();
    const proposal = roadmap(floorId, employeeId);
    // Both tasks are due in the same week on a floor with one instance.
    proposal.milestones[1].tasks[0].deadlineAt = 5 * DAY;
    await t.mutation(api.services.projects.recordProposal, { secret, projectId, proposal });
    expect((await user.query(api.projects.get, { projectId })).proposal?.prompts).toEqual([
      {
        kind: 'capacity',
        text: 'Marketing has 2 tasks due in the week of 1970-01-01 and 1 instance(s). Hire more or move the deadline.',
      },
    ]);
  });

  it('carries the project, milestone, and dependencies into working memory', async () => {
    const { t, user, floorId, employeeId, projectId } = await setup();
    const proposal = roadmap(floorId, employeeId);
    const { taskIds, milestoneIds } = await user.mutation(api.projects.confirmProposal, {
      projectId,
      proposal,
    });
    expect(await t.query(api.services.projects.projectContext, { secret, taskId: taskIds[1] })).toMatchObject(
      {
        project: { name: 'Launch' },
        milestone: { id: milestoneIds[1], title: 'Review' },
        cadence: 'daily',
        deadlineAt: 9 * DAY,
        dependencies: [{ id: taskIds[0], title: 'Draft copy', status: 'queued' }],
      },
    );
  });
});
