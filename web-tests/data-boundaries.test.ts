import { describe, expect, it } from 'vitest';
import { api } from '../convex/_generated/api';
import {
  adminIdentity,
  connectLinear,
  harness,
  identity,
  linearUrl,
  linearWorkspace,
  publishEmployee,
  secret,
} from './support';

const userIdentity = identity('user-a');

describe('Convex data boundaries', () => {
  it('keeps private employee packages server-only and denies cross-tenant task reads', async () => {
    const t = harness();
    await linearWorkspace(t);
    const { versionId } = await publishEmployee(t);
    const user = t.withIdentity(userIdentity);
    await user.mutation(api.workspace.bootstrap, { name: 'Acme' });
    const { employeeId } = await user.mutation(api.marketplace.hire, { versionId });
    const { taskId } = await user.mutation(api.tasks.create, {
      employeeId,
      title: 'Review queue',
      prompt: 'Review the new work.',
    });

    const listings = await user.query(api.marketplace.list, {});
    expect(listings[0]).not.toHaveProperty('instructions');
    expect(listings[0]).not.toHaveProperty('skills');
    const dashboard = await user.query(api.workspace.dashboard, {});
    expect(dashboard.employees[0]).not.toHaveProperty('instructions');
    expect(dashboard.viewer).toEqual({ subject: 'user-a', name: 'user-a' });
    await expect(user.query(api.marketplace.adminList, {})).rejects.toThrow('Platform administrator');

    await expect(t.query(api.services.sessions.taskContext, { secret: 'wrong', taskId })).rejects.toThrow(
      'Unauthorized service request',
    );
    const serverContext = await t.query(api.services.sessions.taskContext, { secret, taskId });
    expect(serverContext.employeeVersion.instructions).toContain('approved task');
    expect(serverContext.employeeVersion.skills[0].content).toBe('Private skill body');
    expect(serverContext.employeeVersion.skills[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(serverContext.employeeVersion.skills[0].sha256).not.toBe('abc123');

    for (const message of [
      { text: 'Working', createdAt: 1, phase: 'commentary', completed: false },
      { text: 'Finished answer', createdAt: 2, phase: 'final_answer', completed: true },
      { text: 'Late partial', createdAt: 3, phase: 'final_answer', completed: false },
    ]) {
      await t.mutation(api.services.sessions.recordEvents, {
        secret,
        taskId,
        events: [],
        messages: [{ externalId: 'assistant-item-1', role: 'assistant', ...message }],
      });
    }
    const messages = await user.query(api.tasks.messages, { taskId });
    expect(messages.find((message) => message.role === 'assistant')?.text).toBe('Finished answer');

    const outsider = t.withIdentity(identity('user-b'));
    await outsider.mutation(api.workspace.bootstrap, { name: 'Other company' });
    await expect(outsider.query(api.tasks.messages, { taskId })).rejects.toThrow('Task not found');
  });

  it('creates one approval job and rechecks a revoked grant before execution', async () => {
    const t = harness();
    await linearWorkspace(t);
    const { versionId } = await publishEmployee(t, {
      capabilities: [{ provider: 'linear', tools: ['update_issue'], optional: false }],
    });
    const user = t.withIdentity(userIdentity);
    await user.mutation(api.workspace.bootstrap, { name: 'Acme' });
    const { connectionId } = await connectLinear(t, { subject: 'user-a' });
    const { employeeId } = await user.mutation(api.marketplace.hire, { versionId });
    const { taskId } = await user.mutation(api.tasks.create, {
      employeeId,
      title: 'Update issue',
      prompt: 'Update OPS-7 after review.',
    });
    const taskContext = await t.query(api.services.sessions.taskContext, { secret, taskId });
    expect(taskContext.policies).toEqual(
      expect.arrayContaining([{ provider: 'linear', name: 'update_issue', mode: 'write' }]),
    );
    const [startJob] = await t.mutation(api.services.queue.claimJobs, {
      secret,
      workerId: 'worker-1',
      limit: 10,
    });
    if (!startJob) throw new Error('Expected start job');
    await t.mutation(api.services.queue.completeJob, {
      secret,
      jobId: startJob.id,
      leaseToken: startJob.leaseToken,
    });
    const { proposalId } = await t.mutation(api.services.actions.proposeAction, {
      secret,
      runToken: taskContext.runToken,
      connectionId,
      tool: 'update_issue',
      arguments: { issue: 'OPS-7', status: 'Done' },
      summary: 'Mark OPS-7 done',
      correction: 'supported',
      correctionReason: 'Restore the previous status if the version still matches.',
      beforeState: { status: 'In Progress', version: 4 },
      idempotencyKey: 'operation-7',
    });

    await user.mutation(api.actions.decide, { proposalId, approved: true });
    await user.mutation(api.actions.decide, { proposalId, approved: true });
    const approvalJobs = await t.run(async (ctx) =>
      (await ctx.db.query('jobs').collect()).filter((job) => job.uniqueKey === `action:${proposalId}`),
    );
    expect(approvalJobs).toHaveLength(1);

    const jobs = await t.mutation(api.services.queue.claimJobs, {
      secret,
      workerId: 'worker-1',
      limit: 10,
    });
    const actionJob = jobs.find((job) => job.kind === 'execute_action');
    if (!actionJob) throw new Error('Expected action job');
    await user.mutation(api.integrations.disconnect, { connectionId });
    await expect(
      t.query(api.services.actions.actionContext, {
        secret,
        proposalId,
        leaseToken: actionJob.leaseToken,
      }),
    ).rejects.toThrow('Required linear access is unavailable');
  });

  it('does not treat membership in the same Clerk organization as source-data access', async () => {
    const t = harness();
    await linearWorkspace(t);
    const { versionId } = await publishEmployee(t);
    const owner = t.withIdentity(identity('org-user-a', 'org-acme'));
    const colleague = t.withIdentity(identity('org-user-b', 'org-acme', 'org:admin'));
    await owner.mutation(api.workspace.bootstrap, { name: 'Acme organization' });
    const { connectionId } = await connectLinear(t, {
      subject: 'org-user-a',
      orgId: 'org-acme',
      tools: ['get_issue'],
    });
    const { employeeId } = await owner.mutation(api.marketplace.hire, { versionId });
    const { taskId } = await owner.mutation(api.tasks.create, {
      employeeId,
      title: 'Private review',
      prompt: 'Review my private queue.',
    });

    const colleagueDashboard = await colleague.query(api.workspace.dashboard, {});
    expect(colleagueDashboard.workspace?.name).toBe('Acme organization');
    expect(colleagueDashboard.connections).toEqual([]);
    expect(colleagueDashboard.tasks).toEqual([]);
    await expect(colleague.query(api.tasks.messages, { taskId })).rejects.toThrow('Task not found');
    await expect(colleague.mutation(api.integrations.disconnect, { connectionId })).rejects.toThrow(
      'Connection not found',
    );
  });

  it('reads Clerk JWT v2 organization claims without granting colleagues access to private data', async () => {
    const t = harness();
    const owner = t.withIdentity({
      subject: 'jwt-v2-owner',
      tokenIdentifier: 'test|jwt-v2-owner',
      issuer: 'test',
      o: { id: 'org-v2', rol: 'member' },
    } as never);
    const admin = t.withIdentity({
      subject: 'jwt-v2-admin',
      tokenIdentifier: 'test|jwt-v2-admin',
      issuer: 'test',
      given_name: 'Ada',
      family_name: 'Byron',
      o: { id: 'org-v2', rol: 'admin' },
    } as never);
    await owner.mutation(api.workspace.bootstrap, { name: 'JWT v2 company' });
    await admin.mutation(api.workspace.setTokenCap, { monthlyTokenCap: 250_000 });
    const dashboard = await admin.query(api.workspace.dashboard, {});
    expect(dashboard.workspace).toMatchObject({
      name: 'JWT v2 company',
      role: 'admin',
      monthlyTokenCap: 250_000,
    });
    expect(dashboard.viewer.name).toBe('Ada Byron');
    expect(dashboard.tasks).toEqual([]);
    const workspaces = await t.run((ctx) => ctx.db.query('workspaces').collect());
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0].authKey).toBe('org:org-v2');
  });

  it('keeps session monitoring available after grants and the employee version are retired', async () => {
    const t = harness();
    await linearWorkspace(t);
    const { versionId } = await publishEmployee(t, {
      capabilities: [{ provider: 'linear', tools: ['get_issue'], optional: false }],
    });
    const user = t.withIdentity(userIdentity);
    const admin = t.withIdentity(adminIdentity);
    await user.mutation(api.workspace.bootstrap, { name: 'Monitoring' });
    const { connectionId } = await connectLinear(t, { subject: 'user-a', tools: ['get_issue'] });
    const { employeeId } = await user.mutation(api.marketplace.hire, { versionId });
    const { taskId } = await user.mutation(api.tasks.create, {
      employeeId,
      title: 'Monitor me',
      prompt: 'Read the issue.',
    });
    await user.mutation(api.integrations.disconnect, { connectionId });
    await admin.mutation(api.marketplace.retire, { versionId });

    const context = await t.query(api.services.sessions.sessionContext, { secret, taskId });
    expect(context.task).toMatchObject({ id: taskId, status: 'queued', title: 'Monitor me' });
    expect(context).not.toHaveProperty('connections');
    await expect(t.query(api.services.sessions.taskContext, { secret, taskId })).rejects.toThrow(
      'Employee version is retired',
    );
  });

  it('publishes only registered MCP tools and keeps the registry to platform admins', async () => {
    const t = harness();
    await linearWorkspace(t);
    const admin = t.withIdentity(adminIdentity);
    const user = t.withIdentity(userIdentity);
    const registry = await admin.query(api.admin.registryTools, {});
    expect(registry.map((tool) => `${tool.provider}.${tool.name}:${tool.mode}`)).toEqual([
      'linear.get_issue:read',
      'linear.update_issue:write',
    ]);
    await expect(user.query(api.admin.registryTools, {})).rejects.toThrow('Platform administrator');
    expect((await admin.query(api.admin.providerConfigs, {})).find((c) => c.provider === 'linear')).toEqual({
      provider: 'linear',
      enabledUrls: [linearUrl],
      oauthClients: [],
      hasInboxSecret: false,
      updatedAt: 1,
      updatedBy: 'platform-admin',
    });

    const { draftId } = await admin.mutation(api.marketplace.saveDraft, {
      name: 'Unregistered employee',
      role: 'Analyst',
      description: 'Uses an unregistered tool.',
      category: 'Operations',
      strengths: [],
      limitations: [],
      capabilities: [{ provider: 'linear', tools: ['unknown_tool'], optional: true }],
      model: 'gpt-5.6-luna',
      color: '#000000',
      media: [],
      instructions: 'Review records.',
      skills: [],
    });
    await expect(admin.mutation(api.marketplace.publish, { draftId })).rejects.toThrow(
      'linear.unknown_tool is not in the MCP tool registry',
    );

    const { draftId: unsafeMediaDraftId } = await admin.mutation(api.marketplace.saveDraft, {
      name: 'Unsafe media employee',
      role: 'Analyst',
      description: 'Has an invalid media URL.',
      category: 'Operations',
      strengths: [],
      limitations: [],
      capabilities: [],
      model: 'gpt-5.6-luna',
      color: '#000000',
      media: [{ url: 'http://media.example/preview.png', type: 'image', alt: 'Preview' }],
      instructions: 'Review records.',
      skills: [],
    });
    await expect(admin.mutation(api.marketplace.publish, { draftId: unsafeMediaDraftId })).rejects.toThrow(
      'Marketplace media must use HTTPS',
    );
  });
});
