import { describe, expect, it } from 'vitest';
import { api } from '../convex/_generated/api';
import {
  connectLinear,
  harness,
  identity as orgIdentity,
  linearWorkspace,
  publishEmployee,
  secret,
} from './support';

describe('workspace projects', () => {
  it('shares floor tasks in one workspace while keeping private tasks and tenants apart', async () => {
    const t = harness();
    await linearWorkspace(t);
    const { versionId } = await publishEmployee(t);
    const owner = t.withIdentity(orgIdentity('owner', 'acme'));
    const colleague = t.withIdentity(orgIdentity('colleague', 'acme'));
    const outsider = t.withIdentity(orgIdentity('outsider', 'other'));
    await owner.mutation(api.workspace.bootstrap, { name: 'Acme' });
    await outsider.mutation(api.workspace.bootstrap, { name: 'Other' });
    const { employeeId } = await owner.mutation(api.marketplace.hire, { versionId });
    const { projectId } = await owner.mutation(api.projects.create, {
      name: 'Launch',
      brief: 'Prepare the launch.',
      employeeIds: [employeeId],
    });

    expect((await colleague.query(api.workspace.dashboard, {})).projects).toEqual([
      expect.objectContaining({ id: projectId, name: 'Launch', employeeIds: [employeeId] }),
    ]);
    await colleague.mutation(api.projects.update, {
      projectId,
      name: 'Product launch',
      brief: 'Prepare the product launch.',
      employeeIds: [employeeId],
    });
    await expect(outsider.mutation(api.projects.setArchived, { projectId, archived: true })).rejects.toThrow(
      'Project not found',
    );

    const { taskId } = await owner.mutation(api.tasks.create, {
      projectId,
      employeeId,
      title: 'Floor launch task',
      prompt: 'Review the launch records.',
    });
    await owner.mutation(api.tasks.create, {
      employeeId,
      title: 'Private task',
      prompt: 'Review my own queue.',
    });
    // A task on a floor is shared because the floor is; a task outside one is not.
    expect((await colleague.query(api.workspace.dashboard, {})).tasks).toEqual([
      expect.objectContaining({ id: taskId, visibility: 'workspace', isOwner: false }),
    ]);
    expect((await colleague.query(api.projects.board, { projectId })).map((post) => post.text)).toEqual([
      'Operations analyst started: Floor launch task',
    ]);
    await expect(outsider.query(api.projects.board, { projectId })).rejects.toThrow('Project not found');
  });

  it('validates staffing and blocks new project work after archive', async () => {
    const t = harness();
    await linearWorkspace(t);
    const [{ versionId }, { versionId: secondVersionId }] = await Promise.all([
      publishEmployee(t),
      publishEmployee(t, { name: 'Writer' }),
    ]);
    const user = t.withIdentity(orgIdentity('owner', 'acme'));
    const outsider = t.withIdentity(orgIdentity('outsider', 'other'));
    await user.mutation(api.workspace.bootstrap, { name: 'Acme' });
    await outsider.mutation(api.workspace.bootstrap, { name: 'Other' });
    const { employeeId } = await user.mutation(api.marketplace.hire, { versionId });
    const { employeeId: secondEmployeeId } = await user.mutation(api.marketplace.hire, {
      versionId: secondVersionId,
    });
    const { employeeId: foreignEmployeeId } = await outsider.mutation(api.marketplace.hire, { versionId });
    const { projectId: foreignProjectId } = await outsider.mutation(api.projects.create, {
      name: 'Other project',
      brief: 'Belongs to another workspace.',
      employeeIds: [foreignEmployeeId],
    });

    await expect(
      user.mutation(api.projects.create, {
        name: 'Duplicate team',
        brief: 'Invalid staffing.',
        employeeIds: [employeeId, employeeId],
      }),
    ).rejects.toThrow('same employee more than once');
    await expect(
      user.mutation(api.projects.create, {
        name: 'Foreign team',
        brief: 'Invalid staffing.',
        employeeIds: [foreignEmployeeId],
      }),
    ).rejects.toThrow('Employee not found');
    await expect(
      user.mutation(api.projects.create, { name: ' ', brief: 'Brief', employeeIds: [] }),
    ).rejects.toThrow('Project name is required');

    const { projectId } = await user.mutation(api.projects.create, {
      name: 'Operations',
      brief: 'Run daily operations.',
      employeeIds: [employeeId],
    });
    const { projectId: secondProjectId } = await user.mutation(api.projects.create, {
      name: 'Planning',
      brief: 'Plan the next quarter.',
      employeeIds: [employeeId],
    });
    expect(projectId).not.toBe(secondProjectId);
    await expect(
      user.mutation(api.tasks.create, {
        projectId,
        employeeId: secondEmployeeId,
        title: 'Wrong employee',
        prompt: 'Start this task.',
      }),
    ).rejects.toThrow('Employee is not assigned to this project');
    await expect(
      user.mutation(api.tasks.create, {
        projectId: foreignProjectId,
        employeeId,
        title: 'Foreign project',
        prompt: 'Do not start this task.',
      }),
    ).rejects.toThrow('Project not found');

    const { taskId: unassignedTaskId } = await user.mutation(api.tasks.create, {
      employeeId: secondEmployeeId,
      title: 'Legacy task',
      prompt: 'Remain outside a project.',
    });
    expect((await t.run((ctx) => ctx.db.get(unassignedTaskId)))?.projectId).toBeUndefined();

    const { connectionId } = await connectLinear(t, { subject: 'owner', orgId: 'acme' });
    await t.mutation(api.services.inbox.ingestInbox, {
      secret,
      connectionId,
      items: [{ externalId: 'issue-1', title: 'New issue', preview: 'Review it.', createdAt: 1 }],
    });
    const itemId = (await user.query(api.workspace.dashboard, {})).inbox[0].id;

    await user.mutation(api.projects.setArchived, { projectId, archived: true });
    await expect(
      user.mutation(api.tasks.create, {
        projectId,
        employeeId,
        title: 'Archived task',
        prompt: 'Do not start this.',
      }),
    ).rejects.toThrow('Project is archived');
    await expect(user.mutation(api.inbox.assign, { itemId, employeeId, projectId })).rejects.toThrow(
      'Project is archived',
    );
    const { taskId: inboxTaskId } = await user.mutation(api.inbox.assign, { itemId, employeeId });
    expect((await t.run((ctx) => ctx.db.get(inboxTaskId)))?.projectId).toBeUndefined();

    await t.mutation(api.services.inbox.ingestInbox, {
      secret,
      connectionId,
      items: [{ externalId: 'issue-2', title: 'Project issue', preview: 'Assign it.', createdAt: 2 }],
    });
    const projectItemId = (await user.query(api.workspace.dashboard, {})).inbox.find(
      (item) => item.title === 'Project issue',
    )?.id;
    if (!projectItemId) throw new Error('Expected project inbox item');
    await user.mutation(api.projects.setArchived, { projectId, archived: false });
    const { taskId: projectInboxTaskId } = await user.mutation(api.inbox.assign, {
      itemId: projectItemId,
      employeeId,
      projectId,
    });
    expect(await t.run((ctx) => ctx.db.get(projectInboxTaskId))).toMatchObject({
      projectId,
      projectContext: { name: 'Operations', brief: 'Run daily operations.' },
    });
  });

  it('keeps the original project context on correction tasks after edits and archive', async () => {
    const t = harness();
    await linearWorkspace(t);
    const { versionId } = await publishEmployee(t);
    const user = t.withIdentity(orgIdentity('owner', 'acme'));
    await user.mutation(api.workspace.bootstrap, { name: 'Acme' });
    const { employeeId } = await user.mutation(api.marketplace.hire, { versionId });
    const { projectId } = await user.mutation(api.projects.create, {
      name: 'Original project',
      brief: 'Use the original project rules.',
      employeeIds: [employeeId],
    });
    const { taskId } = await user.mutation(api.tasks.create, {
      projectId,
      employeeId,
      title: 'Original task',
      prompt: 'Make the reviewed change.',
    });
    const { connectionId } = await connectLinear(t, { subject: 'owner', orgId: 'acme' });
    const proposalId = await t.run(async (ctx) => {
      const task = await ctx.db.get(taskId);
      if (!task) throw new Error('Expected task');
      return ctx.db.insert('proposals', {
        workspaceId: task.workspaceId,
        taskId,
        connectionId,
        employeeName: task.employeeName,
        provider: 'linear',
        tool: 'update_issue',
        arguments: '{}',
        argumentsHash: 'hash',
        dedupeKey: 'project-correction',
        summary: 'Update the issue',
        status: 'succeeded',
        correction: 'manual',
        correctionReason: 'Review and restore it manually.',
        proposedBy: 'agent',
        createdAt: Date.now(),
      });
    });

    await user.mutation(api.projects.update, {
      projectId,
      name: 'Renamed project',
      brief: 'This brief applies only to future tasks.',
      employeeIds: [],
    });
    await user.mutation(api.projects.setArchived, { projectId, archived: true });
    expect(
      (await user.query(api.workspace.dashboard, {})).tasks.find((task) => task.id === taskId),
    ).toMatchObject({
      projectId,
      projectContext: { name: 'Original project', brief: 'Use the original project rules.' },
    });
    const correction = await user.mutation(api.actions.requestCorrection, { proposalId });
    if (correction.kind !== 'task') throw new Error('Expected correction task');
    const context = await t.query(api.services.sessions.taskContext, {
      secret,
      taskId: correction.taskId,
    });
    expect(context.project).toEqual({
      id: projectId,
      name: 'Original project',
      brief: 'Use the original project rules.',
    });
    expect(await t.run((ctx) => ctx.db.get(correction.taskId))).toMatchObject({
      projectId,
      projectContext: { name: 'Original project', brief: 'Use the original project rules.' },
    });
  });
});
