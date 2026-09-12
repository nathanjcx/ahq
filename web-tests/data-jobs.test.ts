import { beforeEach, describe, expect, it } from 'vitest';
import { convexTest } from 'convex-test';
import { api } from '../convex/_generated/api';
import schema from '../convex/schema';

const modules = import.meta.glob('../convex/**/*.ts');
const adminIdentity = { subject: 'platform-admin', tokenIdentifier: 'test|platform-admin', issuer: 'test' };
const userIdentity = { subject: 'user-a', tokenIdentifier: 'test|user-a', issuer: 'test' };

async function setupEmployee(t: ReturnType<typeof convexTest>, tools: string[] = []) {
  const admin = t.withIdentity(adminIdentity);
  const user = t.withIdentity(userIdentity);
  const { draftId } = await admin.mutation(api.marketplace.saveDraft, {
    name: 'Issue operator',
    role: 'Operator',
    description: 'Handles one issue at a time.',
    category: 'Operations',
    strengths: ['Bounded changes'],
    limitations: ['Writes require approval'],
    capabilities: tools.length ? [{ provider: 'linear', tools, optional: false }] : [],
    model: 'gpt-5.6-terra',
    color: '#6657d9',
    media: [],
    instructions: 'Work only on the assigned issue.',
    skills: [],
  });
  const { versionId } = await admin.mutation(api.marketplace.publish, { draftId });
  await user.mutation(api.workspace.bootstrap, { name: 'Acme' });
  if (tools.length) {
    await t.mutation(api.services.connectIntegration, {
      secret: 'service-test-secret',
      authSubject: 'user-a',
      provider: 'linear',
      name: 'Linear',
      account: 'acme',
      tools: ['get_issue', 'update_issue'],
      serverUrl: 'https://mcp.linear.example',
      credentialCiphertext: 'encrypted-token',
      credentialKeyVersion: 'v1',
    });
  }
  const { employeeId } = await user.mutation(api.marketplace.hire, { versionId });
  return { admin, user, employeeId };
}

async function createAction(t: ReturnType<typeof convexTest>) {
  const { user, employeeId } = await setupEmployee(t, ['update_issue']);
  const { taskId } = await user.mutation(api.tasks.create, {
    employeeId,
    title: 'Update issue',
    prompt: 'Mark OPS-7 done.',
  });
  const [start] = await t.mutation(api.services.claimJobs, {
    secret: 'service-test-secret',
    workerId: 'worker-1',
    limit: 10,
  });
  if (!start) throw new Error('Expected start job');
  await t.mutation(api.services.completeJob, {
    secret: 'service-test-secret',
    jobId: start.id,
    leaseToken: start.leaseToken,
  });
  const context = await t.query(api.services.taskContext, { secret: 'service-test-secret', taskId });
  const connectionId = context.connections[0]?.id;
  if (!connectionId) throw new Error('Expected connection');
  const { proposalId } = await t.mutation(api.services.proposeAction, {
    secret: 'service-test-secret',
    runToken: context.runToken,
    connectionId,
    tool: 'update_issue',
    arguments: { id: 'OPS-7', status: 'Done' },
    summary: 'Mark OPS-7 done',
    correction: 'manual',
    correctionReason: 'Restore the prior status manually.',
  });
  return { user, taskId, proposalId, connectionId, runToken: context.runToken };
}

describe('Convex job and audit invariants', () => {
  beforeEach(() => {
    process.env.AHQ_SERVICE_SECRET = 'service-test-secret';
    process.env.PLATFORM_ADMIN_USER_IDS = 'platform-admin';
    process.env.MCP_SERVER_URLS_JSON = JSON.stringify({ linear: ['https://mcp.linear.example/'] });
    process.env.MCP_TOOL_REGISTRY_JSON = JSON.stringify({
      linear: [
        { name: 'get_issue', description: 'Read one issue', mode: 'read' },
        { name: 'update_issue', description: 'Update one issue', mode: 'write' },
      ],
    });
  });

  it('leases at most one command for a task and waits for its active lease', async () => {
    const t = convexTest(schema, modules);
    const { user, employeeId } = await setupEmployee(t);
    const { taskId } = await user.mutation(api.tasks.create, {
      employeeId,
      title: 'Serial task',
      prompt: 'First turn.',
    });
    await user.mutation(api.tasks.send, { taskId, text: 'Second turn.' });

    const first = await t.mutation(api.services.claimJobs, {
      secret: 'service-test-secret',
      workerId: 'worker-1',
      limit: 10,
    });
    expect(first).toHaveLength(1);
    const blocked = await t.mutation(api.services.claimJobs, {
      secret: 'service-test-secret',
      workerId: 'worker-2',
      limit: 10,
    });
    expect(blocked).toEqual([]);
    await t.mutation(api.services.completeJob, {
      secret: 'service-test-secret',
      jobId: first[0].id,
      leaseToken: first[0].leaseToken,
    });
    const second = await t.mutation(api.services.claimJobs, {
      secret: 'service-test-secret',
      workerId: 'worker-2',
      limit: 10,
    });
    expect(second).toHaveLength(1);
    expect(second[0].taskId).toBe(taskId);
  });

  it('binds terminal stream events to the input revision they monitored', async () => {
    const t = convexTest(schema, modules);
    const { user, employeeId } = await setupEmployee(t);
    const { taskId } = await user.mutation(api.tasks.create, {
      employeeId,
      title: 'Revision task',
      prompt: 'First turn.',
    });
    const [start] = await t.mutation(api.services.claimJobs, {
      secret: 'service-test-secret',
      workerId: 'worker-1',
      limit: 1,
    });
    if (!start) throw new Error('Expected start job');
    await t.mutation(api.services.recordSession, {
      secret: 'service-test-secret',
      taskId,
      sessionId: 'session-1',
      leaseToken: start.leaseToken,
    });
    const starting = await t.query(api.services.sessionContext, {
      secret: 'service-test-secret',
      taskId,
    });
    expect(starting).toMatchObject({ inputRevision: String(start.id), pendingInput: true });
    const workerState = await t.query(api.services.workerState, { secret: 'service-test-secret' });
    expect(workerState.activeTaskIds).not.toContain(String(taskId));
    await t.mutation(api.services.completeJob, {
      secret: 'service-test-secret',
      jobId: start.id,
      leaseToken: start.leaseToken,
    });
    await user.mutation(api.tasks.send, { taskId, text: 'Second turn.' });

    await t.mutation(api.services.recordEvents, {
      secret: 'service-test-secret',
      taskId,
      events: [],
      status: 'completed',
      inputRevision: starting.inputRevision,
    });
    expect((await t.run((ctx) => ctx.db.get(taskId)))?.status).toBe('queued');
    const [send] = await t.mutation(api.services.claimJobs, {
      secret: 'service-test-secret',
      workerId: 'worker-1',
      limit: 1,
    });
    if (!send || send.kind !== 'send_message') throw new Error('Expected message job');
    await t.mutation(api.services.completeJob, {
      secret: 'service-test-secret',
      jobId: send.id,
      leaseToken: send.leaseToken,
    });
    await t.mutation(api.services.recordEvents, {
      secret: 'service-test-secret',
      taskId,
      events: [],
      status: 'completed',
      inputRevision: starting.inputRevision,
    });
    expect((await t.run((ctx) => ctx.db.get(taskId)))?.status).toBe('running');

    const current = await t.query(api.services.sessionContext, {
      secret: 'service-test-secret',
      taskId,
    });
    expect(current.pendingInput).toBe(false);
    expect(current.inputRevision).toBe(String(send.id));
    await t.mutation(api.services.recordEvents, {
      secret: 'service-test-secret',
      taskId,
      events: [],
      status: 'completed',
      inputRevision: current.inputRevision,
    });
    expect((await t.run((ctx) => ctx.db.get(taskId)))?.status).toBe('completed');
  });

  it('moves commands behind active leases out of the claim window', async () => {
    const t = convexTest(schema, modules);
    const { user, employeeId } = await setupEmployee(t);
    const { taskId: seedTaskId } = await user.mutation(api.tasks.create, {
      employeeId,
      title: 'Seed',
      prompt: 'Seed task.',
    });
    const runnableTaskId = await t.run(async (ctx) => {
      const seed = await ctx.db.get(seedTaskId);
      if (!seed) throw new Error('Expected seed task');
      const seedJob = await ctx.db
        .query('jobs')
        .withIndex('by_unique_key', (q) => q.eq('uniqueKey', `start:${seedTaskId}`))
        .unique();
      if (!seedJob) throw new Error('Expected seed job');
      await ctx.db.patch(seedJob._id, { state: 'completed', updatedAt: 1 });
      const { _id, _creationTime, ...taskFields } = seed;
      void _id;
      void _creationTime;
      for (let index = 0; index < 100; index++) {
        const busyTaskId = await ctx.db.insert('tasks', {
          ...taskFields,
          status: 'running',
          runToken: `busy-run-${index}`,
          createdAt: 1,
          updatedAt: 1,
        });
        await ctx.db.insert('jobs', {
          workspaceId: seed.workspaceId,
          taskId: busyTaskId,
          uniqueKey: `busy-lease-${index}`,
          kind: 'start_task',
          payload: '{}',
          state: 'leased',
          attempts: 1,
          availableAt: 1,
          leaseOwner: 'busy-worker',
          leaseToken: `busy-lease-token-${index}`,
          leaseExpiresAt: Date.now() + 60_000,
          createdAt: 1,
          updatedAt: 1,
        });
        await ctx.db.insert('jobs', {
          workspaceId: seed.workspaceId,
          taskId: busyTaskId,
          uniqueKey: `busy-message-${index}`,
          kind: 'send_message',
          payload: '{}',
          state: 'queued',
          attempts: 0,
          availableAt: 1,
          createdAt: 1,
          updatedAt: 1,
        });
      }
      const runnableTaskId = await ctx.db.insert('tasks', {
        ...taskFields,
        status: 'queued',
        runToken: 'runnable-run',
        createdAt: 2,
        updatedAt: 2,
      });
      await ctx.db.insert('jobs', {
        workspaceId: seed.workspaceId,
        taskId: runnableTaskId,
        uniqueKey: 'runnable-start',
        kind: 'start_task',
        payload: '{}',
        state: 'queued',
        attempts: 0,
        availableAt: 2,
        createdAt: 2,
        updatedAt: 2,
      });
      return runnableTaskId;
    });

    const first = await t.mutation(api.services.claimJobs, {
      secret: 'service-test-secret',
      workerId: 'worker-1',
      limit: 1,
    });
    expect(first).toEqual([]);
    const second = await t.mutation(api.services.claimJobs, {
      secret: 'service-test-secret',
      workerId: 'worker-1',
      limit: 1,
    });
    expect(second).toHaveLength(1);
    expect(second[0].taskId).toBe(runnableTaskId);
  });

  it('prioritizes cancellation and never recovers stale work into a cancelled task', async () => {
    const t = convexTest(schema, modules);
    const { user, employeeId } = await setupEmployee(t);
    const { taskId } = await user.mutation(api.tasks.create, {
      employeeId,
      title: 'Cancel task',
      prompt: 'Start this.',
    });
    const [leased] = await t.mutation(api.services.claimJobs, {
      secret: 'service-test-secret',
      workerId: 'worker-1',
      limit: 1,
    });
    if (!leased) throw new Error('Expected leased job');
    await user.mutation(api.tasks.cancel, { taskId });
    await t.run((ctx) => ctx.db.patch(leased.id, { leaseExpiresAt: Date.now() - 1 }));

    const recovered = await t.mutation(api.services.claimJobs, {
      secret: 'service-test-secret',
      workerId: 'worker-2',
      limit: 10,
    });
    expect(recovered).toHaveLength(1);
    expect(recovered[0].kind).toBe('cancel_task');
    const jobs = await t.run((ctx) => ctx.db.query('jobs').collect());
    expect(jobs.find((job) => job._id === leased.id)).toMatchObject({
      state: 'failed',
      error: 'Task became inactive before the command could be retried',
    });
  });

  it('rejects an approval after cancellation', async () => {
    const t = convexTest(schema, modules);
    const { user, taskId, proposalId } = await createAction(t);
    await user.mutation(api.tasks.cancel, { taskId });
    await expect(user.mutation(api.actions.decide, { proposalId, approved: true })).rejects.toThrow(
      'task is no longer active',
    );
  });

  it('refuses to lease an approved action after its task becomes terminal', async () => {
    const t = convexTest(schema, modules);
    const { user, taskId, proposalId } = await createAction(t);
    await user.mutation(api.actions.decide, { proposalId, approved: true });
    await t.run((ctx) => ctx.db.patch(taskId, { status: 'cancelled', updatedAt: Date.now() }));

    const claimed = await t.mutation(api.services.claimJobs, {
      secret: 'service-test-secret',
      workerId: 'worker-1',
      limit: 10,
    });
    expect(claimed).toEqual([]);
    const state = await t.run(async (ctx) => ({
      proposal: await ctx.db.get(proposalId),
      actionJob: await ctx.db
        .query('jobs')
        .withIndex('by_unique_key', (q) => q.eq('uniqueKey', `action:${proposalId}`))
        .unique(),
    }));
    expect(state.proposal?.status).toBe('rejected');
    expect(state.actionJob?.state).toBe('failed');
  });

  it('does not lease an approved action after the task becomes terminal', async () => {
    const t = convexTest(schema, modules);
    const { user, taskId, proposalId } = await createAction(t);
    await user.mutation(api.actions.decide, { proposalId, approved: true });
    await t.run((ctx) => ctx.db.patch(taskId, { status: 'cancelled', updatedAt: Date.now() }));

    const claimed = await t.mutation(api.services.claimJobs, {
      secret: 'service-test-secret',
      workerId: 'worker-1',
      limit: 10,
    });
    expect(claimed).toEqual([]);
    const proposal = await t.run((ctx) => ctx.db.get(proposalId));
    expect(proposal).toMatchObject({ status: 'rejected', result: 'Task is no longer active' });
  });

  it('records a known action result after revocation without reviving a cancelled task', async () => {
    const t = convexTest(schema, modules);
    const { user, taskId, proposalId, connectionId, runToken } = await createAction(t);
    await user.mutation(api.actions.decide, { proposalId, approved: true });
    const [action] = await t.mutation(api.services.claimJobs, {
      secret: 'service-test-secret',
      workerId: 'worker-1',
      limit: 10,
    });
    if (!action || action.kind !== 'execute_action') throw new Error('Expected action job');
    const audit = {
      secret: 'service-test-secret',
      runToken,
      connectionId,
      tool: 'update_issue',
      argumentsCiphertext: 'sealed-arguments',
      operationId: `action:${proposalId}`,
      proposalId,
      leaseToken: action.leaseToken,
    };
    await t.mutation(api.services.recordToolCall, { ...audit, outcome: 'started' });
    await user.mutation(api.integrations.disconnect, { connectionId });
    await user.mutation(api.tasks.cancel, { taskId });
    await t.mutation(api.services.recordToolCall, {
      ...audit,
      outcome: 'succeeded',
      resultCiphertext: 'sealed-result',
      sha256: 'result-digest',
    });
    const result = {
      secret: 'service-test-secret',
      proposalId,
      leaseToken: action.leaseToken,
      status: 'succeeded' as const,
      result: 'Updated OPS-7',
      afterState: { id: 'OPS-7', status: 'Done' },
    };
    await t.mutation(api.services.recordActionResult, result);
    await t.mutation(api.services.recordActionResult, result);
    await expect(
      t.mutation(api.services.recordActionResult, { ...result, status: 'uncertain' }),
    ).rejects.toThrow('already final');

    const state = await t.run(async (ctx) => ({
      task: await ctx.db.get(taskId),
      proposal: await ctx.db.get(proposalId),
      jobs: await ctx.db.query('jobs').collect(),
      audit: await ctx.db.query('toolCalls').collect(),
    }));
    expect(state.task?.status).toBe('cancelled');
    expect(state.proposal?.status).toBe('succeeded');
    expect(state.jobs.filter((job) => job.uniqueKey.startsWith(`action-result:${proposalId}`))).toEqual([]);
    expect(state.audit.map((entry) => entry.outcome)).toEqual(['started', 'succeeded']);
  });
});
