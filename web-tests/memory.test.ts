import { describe, expect, it } from 'vitest';
import { api } from '../convex/_generated/api';
import { compileWorkingMemory } from '../lib/server/memory';
import { harness, hireOne, identity as orgIdentity, publishEmployee, secret, type Harness } from './support';

const admin = orgIdentity('owner', 'acme', 'org:admin');
const colleague = orgIdentity('colleague', 'acme');

/** One workspace with a staffed floor and a running task, which is what memory hangs off. */
async function tower(t: Harness) {
  const { listingId } = await publishEmployee(t);
  const owner = t.withIdentity(admin);
  const member = t.withIdentity(colleague);
  await owner.mutation(api.workspace.bootstrap, { name: 'Acme' });
  const { employeeId } = await hireOne(owner, listingId);
  const { floorId } = await owner.mutation(api.floors.create, {
    name: 'Launch',
    brief: 'Prepare the launch.',
    employeeIds: [employeeId],
  });
  const { taskId } = await owner.mutation(api.tasks.create, {
    floorId,
    employeeId,
    title: 'Ship the launch',
    prompt: 'Prepare the launch.',
  });
  const { runToken, workspaceId } = await t.run(async (ctx) => {
    const task = await ctx.db.get(taskId);
    return { runToken: task!.runToken, workspaceId: task!.workspaceId };
  });
  return { t, owner, member, employeeId, floorId, taskId, runToken, workspaceId };
}

type Tower = Awaited<ReturnType<typeof tower>>;

/** A janitor instance with a task of its own, which is how janitor tools authorize. */
async function janitor(context: Tower) {
  const { employeeId } = await context.t.mutation(api.services.memory.ensureJanitor, {
    secret,
    workspaceId: context.workspaceId,
  });
  const { taskId } = await context.owner.mutation(api.tasks.create, {
    employeeId,
    title: 'Curate the memory',
    prompt: 'Merge, contest, archive, and promote.',
  });
  const runToken = await context.t.run(async (ctx) => (await ctx.db.get(taskId))!.runToken);
  return { employeeId, runToken };
}

function claim(runToken: string, text: string, over: Record<string, unknown> = {}) {
  return { secret, runToken, scope: 'self' as const, kind: 'fact' as const, text, ...over };
}

describe('workspace memory', () => {
  it('holds an agent floor claim until a person approves it, then compiles it into working memory', async () => {
    const t = harness();
    const { owner, runToken, taskId, floorId } = await tower(t);

    const { memoryId, status } = await t.mutation(
      api.services.memory.remember,
      claim(runToken, 'The launch moved to March 12.', { scope: 'floor', kind: 'decision' }),
    );
    expect(status).toBe('proposed');
    expect((await t.query(api.services.memory.compileInputs, { secret, taskId })).entries.floor).toEqual([]);

    await owner.mutation(api.memory.approve, { id: memoryId });
    const inputs = await t.query(api.services.memory.compileInputs, { secret, taskId });
    expect(inputs.entries.floor.map((entry) => entry.text)).toEqual(['The launch moved to March 12.']);
    expect(compileWorkingMemory(inputs).text).toContain('- [decision] The launch moved to March 12.');

    // Use is recorded after the compile, not during it, so the compiler stays a pure read.
    await t.mutation(api.services.memory.touch, { secret, ids: [memoryId] });
    expect(await t.run(async (ctx) => (await ctx.db.get(memoryId))!.lastUsedAt)).toBeGreaterThan(0);
    expect(
      (await owner.query(api.memory.summaries, { scope: 'floor' })).find(
        (summary) => summary.scopeId === floorId,
      ),
    ).toEqual(expect.objectContaining({ active: 1, proposed: 0, contested: 0, budget: 4_000 }));
  });

  it('files a claim for this task alone, active at once and found by recall', async () => {
    const t = harness();
    const { runToken, taskId } = await tower(t);

    const { memoryId, status } = await t.mutation(
      api.services.memory.remember,
      claim(runToken, 'The staging database for this migration is the one named shadow.', {
        scope: 'task',
        kind: 'fact',
        tags: ['migration'],
      }),
    );
    expect(status).toBe('active');
    expect(await t.run(async (ctx) => ctx.db.get(memoryId))).toMatchObject({
      scope: 'task',
      scopeId: taskId,
      status: 'active',
    });
    expect(
      (await t.query(api.services.memory.recall, { secret, runToken, query: 'shadow' })).map(
        (entry) => entry.scope,
      ),
    ).toEqual(['task']);
  });

  it('supersedes a replaced claim and keeps the notebook inside its budget', async () => {
    const t = harness();
    const { owner, runToken, employeeId } = await tower(t);

    const first = await t.mutation(api.services.memory.remember, claim(runToken, 'The staging key is old.'));
    const second = await t.mutation(
      api.services.memory.remember,
      claim(runToken, 'The staging key rotated on Monday.', { supersedesId: first.memoryId }),
    );
    const replaced = await t.run(async (ctx) => ctx.db.get(first.memoryId));
    expect(replaced).toEqual(expect.objectContaining({ status: 'archived', supersedesId: second.memoryId }));

    // The budget holds two six-token notes, so each new note evicts the least recently used one.
    await owner.mutation(api.memory.setBudgets, {
      budgets: { workspace: 2_000, project: 3_000, floor: 4_000, agent: 12, summaries: 1_500 },
    });
    const texts = ['Oldest note here ok.....', 'Middle note here ok.....', 'Newest note here ok.....'];
    for (const text of texts) await t.mutation(api.services.memory.remember, claim(runToken, text));
    const notebook = await owner.query(api.memory.list, { scope: 'agent', scopeId: employeeId });
    expect(notebook.filter((entry) => entry.status === 'active').map((entry) => entry.text)).toEqual([
      texts[2],
      texts[1],
    ]);
  });

  it('only lets the janitor curate, and a promoted claim still needs an administrator', async () => {
    const t = harness();
    const context = await tower(t);
    const { owner, member, runToken, floorId, workspaceId } = context;
    const { runToken: janitorToken } = await janitor(context);
    const first = await owner.mutation(api.memory.propose, {
      scope: 'floor',
      scopeId: floorId,
      kind: 'fact',
      text: 'Design review happens on Tuesday.',
    });
    const second = await owner.mutation(api.memory.propose, {
      scope: 'floor',
      scopeId: floorId,
      kind: 'fact',
      text: 'The design review is every Tuesday morning.',
    });

    await expect(
      t.mutation(api.services.memory.contest, {
        secret,
        runToken,
        id: first.memoryId,
        reason: 'Two dates.',
      }),
    ).rejects.toThrow('Janitor access required');

    const merged = await t.mutation(api.services.memory.merge, {
      secret,
      runToken: janitorToken,
      ids: [first.memoryId, second.memoryId],
      text: 'The design review is on Tuesday morning.',
      kind: 'fact',
      tags: ['review'],
    });
    const chain = await t.run(async (ctx) => [
      await ctx.db.get(first.memoryId),
      await ctx.db.get(second.memoryId),
    ]);
    expect(chain.map((entry) => [entry!.status, entry!.supersedesId])).toEqual([
      ['archived', merged.memoryId],
      ['archived', merged.memoryId],
    ]);

    const promoted = await t.mutation(api.services.memory.promote, {
      secret,
      runToken: janitorToken,
      id: merged.memoryId,
    });
    const copy = await t.run(async (ctx) => ctx.db.get(promoted.memoryId));
    expect(copy).toEqual(
      expect.objectContaining({
        scope: 'workspace',
        scopeId: workspaceId,
        status: 'proposed',
        sourceMemoryId: merged.memoryId,
      }),
    );
    await expect(member.mutation(api.memory.approve, { id: promoted.memoryId })).rejects.toThrow(
      'Workspace administrator access required',
    );
    await owner.mutation(api.memory.approve, { id: promoted.memoryId });
    expect(await t.run(async (ctx) => (await ctx.db.get(promoted.memoryId))!.status)).toBe('active');
  });

  it('contests both sides of a conflict and keeps them out of working memory until a person decides', async () => {
    const t = harness();
    const context = await tower(t);
    const { owner, taskId, floorId } = context;
    const { runToken: janitorToken } = await janitor(context);
    const claimOn = (text: string) =>
      owner.mutation(api.memory.propose, { scope: 'floor', scopeId: floorId, kind: 'decision', text });
    const thursday = await claimOn('We ship on Thursday.');
    const friday = await claimOn('We ship on Friday.');

    const contested = await t.mutation(api.services.memory.contest, {
      secret,
      runToken: janitorToken,
      id: thursday.memoryId,
      reason: 'Two ship dates.',
      otherId: friday.memoryId,
    });
    expect(contested).toEqual(
      expect.objectContaining({
        status: 'contested',
        contestReason: 'Two ship dates.',
        contestedWithId: friday.memoryId,
      }),
    );
    expect(await t.run(async (ctx) => ctx.db.get(friday.memoryId))).toEqual(
      expect.objectContaining({ status: 'contested', contestedWithId: thursday.memoryId }),
    );
    const inputs = await t.query(api.services.memory.compileInputs, { secret, taskId });
    expect(inputs.entries.floor).toEqual([]);
    expect(compileWorkingMemory(inputs).text).not.toContain('We ship on');

    // The conflict is argued out where it was filed: a question in that floor's channel.
    const { channelId } = await owner.mutation(api.channels.open, { kind: 'floor', scopeId: floorId });
    const [question] = (await owner.query(api.channels.posts, { channelId })).filter(
      (post) => post.kind === 'decision',
    );
    // The flag is what marks a contest, so nothing has to read the post's first line to know.
    expect(question).toMatchObject({ authorName: 'The Janitor', flag: 'contested' });
    expect(question.text).toContain('Contested: We ship on Thursday.');
    expect(question.text).toContain('Against: We ship on Friday.');
    expect(question.text).toContain('Reason: Two ship dates.');

    // Keeping the competing claim retires this one, pointing at what replaced it.
    await owner.mutation(api.memory.resolveContest, { id: thursday.memoryId, keep: 'other' });
    const [retired, kept] = await t.run(async (ctx) => [
      await ctx.db.get(thursday.memoryId),
      await ctx.db.get(friday.memoryId),
    ]);
    expect(retired).toEqual(expect.objectContaining({ status: 'archived', supersedesId: friday.memoryId }));
    expect(kept).toEqual(expect.objectContaining({ status: 'active' }));
    expect(kept).not.toHaveProperty('contestReason');
    expect(kept).not.toHaveProperty('contestedWithId');
    expect(
      (await t.query(api.services.memory.compileInputs, { secret, taskId })).entries.floor.map(
        (entry) => entry.text,
      ),
    ).toEqual(['We ship on Friday.']);

    // When neither claim holds, both are retired and nothing replaces them.
    const saturday = await claimOn('We ship on Saturday.');
    await t.mutation(api.services.memory.contest, {
      secret,
      runToken: janitorToken,
      id: friday.memoryId,
      reason: 'A third date appeared.',
      otherId: saturday.memoryId,
    });
    await owner.mutation(api.memory.resolveContest, { id: saturday.memoryId, keep: 'neither' });
    const both = await t.run(async (ctx) => [
      await ctx.db.get(friday.memoryId),
      await ctx.db.get(saturday.memoryId),
    ]);
    expect(both.map((entry) => entry!.status)).toEqual(['archived', 'archived']);
    for (const entry of both) expect(entry).not.toHaveProperty('supersedesId');
    expect((await t.query(api.services.memory.compileInputs, { secret, taskId })).entries.floor).toEqual([]);
  });

  it('ranks recall by tags, then keywords, then recency, and keeps notebooks private', async () => {
    const t = harness();
    const { owner, member, runToken, employeeId, taskId, floorId } = await tower(t);
    await owner.mutation(api.memory.propose, {
      scope: 'floor',
      scopeId: floorId,
      kind: 'procedure',
      text: 'Tag the release branch before the deploy.',
      tags: ['deploy'],
    });
    await owner.mutation(api.memory.propose, {
      scope: 'floor',
      scopeId: floorId,
      kind: 'fact',
      text: 'The deploy window is short.',
    });
    await t.mutation(api.services.memory.remember, claim(runToken, 'Unrelated note about invoices.'));

    const found = await t.query(api.services.memory.recall, { secret, runToken, query: 'deploy' });
    expect(found.map((entry) => entry.text)).toEqual([
      'Tag the release branch before the deploy.',
      'The deploy window is short.',
    ]);

    // A colleague who never used this employee cannot read its notebook; an administrator can.
    expect(await member.query(api.memory.list, { scope: 'agent', scopeId: employeeId })).toEqual([]);
    expect(await owner.query(api.memory.list, { scope: 'agent', scopeId: employeeId })).toHaveLength(1);

    const summary = {
      secret,
      taskId,
      outcome: 'The launch shipped.',
      decisions: ['Shipped on Thursday'],
      openQuestions: [],
      artifactIds: [],
      text: 'The launch shipped on Thursday with the release notes.',
      inferred: false,
    };
    const first = await t.mutation(api.services.memory.recordSummary, summary);
    const again = await t.mutation(api.services.memory.recordSummary, {
      ...summary,
      outcome: 'The launch shipped on time.',
    });
    expect(again.summaryId).toBe(first.summaryId);
    expect(await owner.query(api.memory.taskSummary, { taskId })).toEqual(
      expect.objectContaining({ outcome: 'The launch shipped on time.' }),
    );
  });

  it('reads the janitor log back off the claims curation left behind', async () => {
    const t = harness();
    const context = await tower(t);
    const { owner, floorId } = context;
    const { runToken: janitorToken } = await janitor(context);
    const claimOn = (text: string) =>
      owner.mutation(api.memory.propose, { scope: 'floor', scopeId: floorId, kind: 'fact', text });
    const first = await claimOn('The review is Tuesday morning.');
    const second = await claimOn('The review happens on Tuesday.');
    const third = await claimOn('We deploy on Wednesday.');
    const fourth = await claimOn('We deploy on Thursday.');

    const merged = await t.mutation(api.services.memory.merge, {
      secret,
      runToken: janitorToken,
      ids: [first.memoryId, second.memoryId],
      text: 'The review is on Tuesday morning.',
      kind: 'fact',
      tags: [],
    });
    await t.mutation(api.services.memory.promote, { secret, runToken: janitorToken, id: merged.memoryId });
    await t.mutation(api.services.memory.contest, {
      secret,
      runToken: janitorToken,
      id: third.memoryId,
      otherId: fourth.memoryId,
      reason: 'Two deploy days.',
    });

    const log = await owner.query(api.memory.janitorLog, {});
    // One line per conflict, not one per side, and a merge that says what it replaced.
    expect(log.map((entry) => entry.action).sort()).toEqual(['contested', 'merged', 'promoted']);
    expect(log.find((entry) => entry.action === 'merged')?.detail).toBe('Replaced 2 overlapping claims');
    expect(log.find((entry) => entry.action === 'contested')?.detail).toBe('Two deploy days.');
    expect(log.every((entry, index) => index === 0 || log[index - 1].at >= entry.at)).toBe(true);
  });

  it('creates one janitor per workspace on a reserved version', async () => {
    const t = harness();
    const { workspaceId } = await tower(t);
    const first = await t.mutation(api.services.memory.ensureJanitor, { secret, workspaceId });
    const again = await t.mutation(api.services.memory.ensureJanitor, { secret, workspaceId });
    expect(again.employeeId).toBe(first.employeeId);
    expect(await t.query(api.services.memory.janitorFor, { secret, workspaceId })).toEqual({
      employeeId: first.employeeId,
      name: 'The Janitor',
    });
    const installed = await t.run(async (ctx) => ctx.db.get(first.employeeId));
    expect(installed).toEqual(expect.objectContaining({ kind: 'janitor', status: 'ready' }));
  });
});
