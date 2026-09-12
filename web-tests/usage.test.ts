import { describe, expect, it } from 'vitest';
import { api } from '../convex/_generated/api';
import { harness, identity, linearWorkspace, publishEmployee, secret, type Harness } from './support';

const user = identity('user-a');

async function employee(t: Harness) {
  await linearWorkspace(t);
  const { versionId } = await publishEmployee(t);
  const actor = t.withIdentity(user);
  await actor.mutation(api.workspace.bootstrap, { name: 'Usage' });
  const { employeeId } = await actor.mutation(api.marketplace.hire, { versionId });
  return { actor, employeeId };
}

describe('token usage', () => {
  it('aggregates reported usage per period and model and counts each task once', async () => {
    const t = harness();
    const { actor, employeeId } = await employee(t);
    const first = await actor.mutation(api.tasks.create, {
      employeeId,
      title: 'First',
      prompt: 'Do the first thing.',
    });
    const second = await actor.mutation(api.tasks.create, {
      employeeId,
      title: 'Second',
      prompt: 'Do the second thing.',
    });
    const report = { input: 100, cached: 40, output: 10 };
    await t.mutation(api.services.sessions.recordEvents, {
      secret,
      taskId: first.taskId,
      events: [],
      usage: { externalId: 'turn-1', ...report },
    });
    // The same external report is ignored, so retries never double-count.
    await t.mutation(api.services.sessions.recordEvents, {
      secret,
      taskId: first.taskId,
      events: [],
      usage: { externalId: 'turn-1', ...report },
    });
    await t.mutation(api.services.sessions.recordEvents, {
      secret,
      taskId: first.taskId,
      events: [],
      usage: { externalId: 'turn-2', input: 50, cached: 0, output: 5 },
    });
    await t.mutation(api.services.sessions.recordEvents, {
      secret,
      taskId: second.taskId,
      events: [],
      usage: { externalId: 'turn-1', ...report },
    });

    const dashboard = await actor.query(api.workspace.dashboard, {});
    expect(dashboard.workspace?.usage.period).toBe(new Date().toISOString().slice(0, 7));
    expect(dashboard.workspace?.usage.byModel).toEqual([
      { model: 'gpt-5.6-terra', input: 250, cached: 80, output: 25, tasks: 2 },
    ]);
    expect(dashboard.tasks.find((task) => task.id === first.taskId)?.usage).toEqual({
      input: 150,
      cached: 40,
      output: 15,
    });
  });

  it('treats a report without an external id as the session total', async () => {
    const t = harness();
    const { actor, employeeId } = await employee(t);
    const { taskId } = await actor.mutation(api.tasks.create, {
      employeeId,
      title: 'Cumulative',
      prompt: 'Stream a while.',
    });
    for (const usage of [
      { input: 100, cached: 0, output: 10 },
      { input: 180, cached: 20, output: 30 },
    ])
      await t.mutation(api.services.sessions.recordEvents, { secret, taskId, events: [], usage });
    const dashboard = await actor.query(api.workspace.dashboard, {});
    expect(dashboard.workspace?.usage.byModel).toEqual([
      { model: 'gpt-5.6-terra', input: 180, cached: 20, output: 30, tasks: 1 },
    ]);
    expect(dashboard.tasks[0].usage).toEqual({ input: 180, cached: 20, output: 30 });
  });

  it('refuses new work once the monthly token cap is reached', async () => {
    const t = harness();
    const { actor, employeeId } = await employee(t);
    await actor.mutation(api.workspace.setTokenCap, { monthlyTokenCap: 200 });
    const { taskId } = await actor.mutation(api.tasks.create, {
      employeeId,
      title: 'Within cap',
      prompt: 'Start inside the cap.',
    });
    await t.mutation(api.services.sessions.recordEvents, {
      secret,
      taskId,
      events: [],
      usage: { externalId: 'turn-1', input: 150, cached: 0, output: 60 },
    });
    await expect(
      actor.mutation(api.tasks.create, { employeeId, title: 'Over cap', prompt: 'Too late.' }),
    ).rejects.toThrow('Monthly token cap reached');
    await expect(actor.mutation(api.tasks.send, { taskId, text: 'Keep going.' })).rejects.toThrow(
      'Monthly token cap reached',
    );
    // Cached tokens are counted as input, but the cap only measures input plus output.
    await actor.mutation(api.workspace.setTokenCap, { monthlyTokenCap: 0 });
    await actor.mutation(api.tasks.send, { taskId, text: 'Keep going.' });
    expect((await actor.query(api.workspace.dashboard, {})).workspace?.monthlyTokenCap).toBe(0);
  });

  it('lets only a workspace owner or admin set the cap', async () => {
    const t = harness();
    const member = t.withIdentity(identity('member', 'acme'));
    await t.withIdentity(identity('owner', 'acme', 'org:admin')).mutation(api.workspace.bootstrap, {
      name: 'Acme',
    });
    await expect(member.mutation(api.workspace.setTokenCap, { monthlyTokenCap: 10 })).rejects.toThrow(
      'Workspace administrator access required',
    );
  });
});
