import { beforeEach, describe, expect, it } from 'vitest';
import { convexTest } from 'convex-test';
import { api } from '../convex/_generated/api';
import schema from '../convex/schema';

const modules = import.meta.glob('../convex/**/*.ts');
const adminIdentity = { subject: 'platform-admin', tokenIdentifier: 'test|platform-admin', issuer: 'test' };
const userIdentity = { subject: 'user-a', tokenIdentifier: 'test|user-a', issuer: 'test' };

async function publishEmployee(
  t: ReturnType<typeof convexTest>,
  capabilities: Array<{ provider: 'linear'; tools: string[]; optional: boolean }> = [],
) {
  const admin = t.withIdentity(adminIdentity);
  const { draftId } = await admin.mutation(api.marketplace.saveDraft, {
    name: 'Operations analyst',
    role: 'Analyst',
    description: 'Reviews operating work and prepares updates.',
    category: 'Operations',
    strengths: ['Careful review'],
    limitations: ['External writes require approval'],
    capabilities,
    model: 'gpt-5.6-terra',
    color: '#6757d9',
    media: [],
    instructions: 'Follow the approved task and cite the records used.',
    skills: [{ name: 'review', version: '1', sha256: 'abc123', content: 'Private skill body' }],
  });
  return admin.mutation(api.marketplace.publish, { draftId });
}

describe('Convex data boundaries', () => {
  beforeEach(() => {
    process.env.AHQ_SERVICE_SECRET = 'service-test-secret';
    process.env.PLATFORM_ADMIN_USER_IDS = 'platform-admin';
    process.env.MCP_SERVER_URLS_JSON = JSON.stringify({ linear: ['https://mcp.linear.example/'] });
  });

  it('keeps private employee packages server-only and denies cross-tenant task reads', async () => {
    const t = convexTest(schema, modules);
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
    await expect(user.query(api.marketplace.adminList, {})).rejects.toThrow('Platform administrator');

    await expect(t.query(api.services.taskContext, { secret: 'wrong', taskId })).rejects.toThrow(
      'Unauthorized service request',
    );
    const serverContext = await t.query(api.services.taskContext, { secret: 'service-test-secret', taskId });
    expect(serverContext.employeeVersion.instructions).toContain('approved task');
    expect(serverContext.employeeVersion.skills[0].content).toBe('Private skill body');

    for (const message of [
      { text: 'Working', createdAt: 1, phase: 'commentary', completed: false },
      { text: 'Finished answer', createdAt: 2, phase: 'final_answer', completed: true },
      { text: 'Late partial', createdAt: 3, phase: 'final_answer', completed: false },
    ]) {
      await t.mutation(api.services.recordEvents, {
        secret: 'service-test-secret',
        taskId,
        events: [],
        messages: [{ externalId: 'assistant-item-1', role: 'assistant', ...message }],
      });
    }
    const messages = await user.query(api.tasks.messages, { taskId });
    expect(messages.find((message: { role: string }) => message.role === 'assistant')?.text).toBe(
      'Finished answer',
    );

    const outsider = t.withIdentity({ subject: 'user-b', tokenIdentifier: 'test|user-b', issuer: 'test' });
    await outsider.mutation(api.workspace.bootstrap, { name: 'Other company' });
    await expect(outsider.query(api.tasks.messages, { taskId })).rejects.toThrow('Task not found');
  });

  it('creates one approval job and rechecks a revoked grant before execution', async () => {
    const t = convexTest(schema, modules);
    const { versionId } = await publishEmployee(t, [
      { provider: 'linear', tools: ['update_issue'], optional: false },
    ]);
    const user = t.withIdentity(userIdentity);
    await user.mutation(api.workspace.bootstrap, { name: 'Acme' });
    const { connectionId } = await t.mutation(api.services.connectIntegration, {
      secret: 'service-test-secret',
      authSubject: 'user-a',
      provider: 'linear',
      name: 'Linear',
      account: 'acme.linear.app',
      tools: ['get_issue', 'update_issue'],
      allowedTools: ['update_issue'],
      resourceScope: 'team:operations',
      inboxMode: 'on-demand',
      serverUrl: 'https://mcp.linear.example',
      credentialCiphertext: 'encrypted-token',
      credentialKeyVersion: 'v1',
    });
    const { employeeId } = await user.mutation(api.marketplace.hire, { versionId });
    const { taskId } = await user.mutation(api.tasks.create, {
      employeeId,
      title: 'Update issue',
      prompt: 'Update OPS-7 after review.',
    });
    const taskContext = await t.query(api.services.taskContext, { secret: 'service-test-secret', taskId });
    const { proposalId } = await t.mutation(api.services.proposeAction, {
      secret: 'service-test-secret',
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

    const jobs = await t.mutation(api.services.claimJobs, {
      secret: 'service-test-secret',
      workerId: 'worker-1',
      limit: 10,
    });
    const actionJob = jobs.find((job: { kind: string }) => job.kind === 'execute_action');
    expect(actionJob).toBeTruthy();
    await user.mutation(api.integrations.disconnect, { connectionId });
    await expect(
      t.query(api.services.actionContext, {
        secret: 'service-test-secret',
        proposalId,
        leaseToken: actionJob.leaseToken,
      }),
    ).rejects.toThrow('Required linear access is unavailable');
  });

  it('does not treat membership in the same Clerk organization as source-data access', async () => {
    const t = convexTest(schema, modules);
    const { versionId } = await publishEmployee(t);
    const owner = t.withIdentity({
      subject: 'org-user-a',
      tokenIdentifier: 'test|org-user-a',
      issuer: 'test',
      org_id: 'org-acme',
      org_role: 'org:member',
    } as any);
    const colleague = t.withIdentity({
      subject: 'org-user-b',
      tokenIdentifier: 'test|org-user-b',
      issuer: 'test',
      org_id: 'org-acme',
      org_role: 'org:admin',
    } as any);
    await owner.mutation(api.workspace.bootstrap, { name: 'Acme organization' });
    const { connectionId } = await t.mutation(api.services.connectIntegration, {
      secret: 'service-test-secret',
      authSubject: 'org-user-a',
      authOrgId: 'org-acme',
      provider: 'linear',
      name: 'Private Linear',
      account: 'private-team',
      tools: ['get_issue'],
      allowedTools: ['get_issue'],
      resourceScope: 'team:private',
      inboxMode: 'on-demand',
      serverUrl: 'https://mcp.linear.example',
      credentialCiphertext: 'encrypted-token',
      credentialKeyVersion: 'v1',
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
});
