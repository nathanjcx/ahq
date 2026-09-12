import { describe, expect, it } from 'vitest';
import { api } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import { ensureAuditRun } from '../convex/lib/audit';
import { harness, hireOne, identity as orgIdentity, publishEmployee, secret, type Harness } from './support';

const date = '2026-09-12';
const yesterday = '2026-09-11';
const noon = Date.parse(`${yesterday}T12:00:00Z`);

/** A workspace with one finished shift on the audited day, and its nightly auditor run. */
async function auditedDay(t: Harness) {
  const { listingId } = await publishEmployee(t);
  const owner = t.withIdentity(orgIdentity('owner', 'acme'));
  await owner.mutation(api.workspace.bootstrap, { name: 'Acme' });
  const { employeeId } = await hireOne(owner, listingId);
  const { taskId } = await owner.mutation(api.tasks.create, {
    employeeId,
    title: 'Draft the release notes',
    prompt: 'Draft them.',
  });
  const workspaceId = await t.run(async (ctx) => {
    const task = await ctx.db.get(taskId);
    const workspaceId = task!.workspaceId;
    await ctx.db.insert('workspaceSettings', {
      workspaceId,
      timezone: 'UTC',
      workingDays: [1, 2, 3, 4, 5],
      startHour: 9,
      endHour: 18,
      attendedStartHour: 9,
      attendedEndHour: 18,
      overnightPolicy: 'audits_only',
      dailyTokenCap: 0,
      triageAllowance: 0,
      memoryBudgets: { workspace: 1, project: 1, floor: 1, agent: 1, summaries: 1 },
      hiringPolicy: 'anyone',
      auditPolicy: 'soft',
      triageAllowList: [],
      emergencyAllowList: [],
      notificationChannels: [],
      plan: 'subscription',
      monthlyAllowance: 0,
      maxConcurrentInstances: 1,
      rates: [],
      standards: 'Every claim cites the record.',
      updatedAt: 1,
    });
    const reportId = await ctx.db.insert('reports', {
      workspaceId,
      taskId,
      employeeId,
      done: ['Wrote the release notes'],
      inProgress: [],
      blockedOn: [],
      next: [],
      risks: [],
      inferred: false,
      createdAt: noon,
    });
    await ctx.db.insert('shifts', {
      workspaceId,
      taskId,
      employeeId,
      date: yesterday,
      model: 'gpt-5.6-terra',
      kind: 'work',
      startedAt: noon - 3_600_000,
      endedAt: noon,
      reportId,
    });
    return workspaceId;
  });
  const auditTaskId = await t.run(async (ctx) => ensureAuditRun(ctx, workspaceId, date));
  const runToken = await t.run(async (ctx) => (await ctx.db.get(auditTaskId))!.runToken);
  return { owner, workspaceId, employeeId, taskId, auditTaskId, runToken };
}

describe('audit findings', () => {
  it('runs one auditor over the day and records findings once', async () => {
    const t = harness();
    const { owner, workspaceId, employeeId, taskId, auditTaskId, runToken } = await auditedDay(t);

    const auditors = await t.run(async (ctx) =>
      (await ctx.db.query('installations').collect()).filter(
        (installation) => installation.kind === 'auditor',
      ),
    );
    expect(auditors).toHaveLength(1);
    expect(auditors[0].name).toBe('The Auditor');
    const { employeeId: sameAuditor } = await t.mutation(api.services.audit.ensureAuditors, {
      secret,
      workspaceId,
    });
    expect(sameAuditor).toBe(auditors[0]._id);
    const version = await t.run(async (ctx) => ctx.db.get(auditors[0].versionId));
    expect(version?.capabilities).toEqual([]);
    // The night's task holds the session; the scheduler is what enqueues the run into it.
    expect(await t.run(async (ctx) => ctx.db.get(auditTaskId))).toMatchObject({
      kind: 'audit',
      sessionKey: date,
    });

    const workerRunToken = await t.run(async (ctx) => (await ctx.db.get(taskId))!.runToken);
    await expect(
      t.query(api.services.audit.auditInputs, {
        secret,
        runToken: workerRunToken,
        workspaceId,
        date: yesterday,
      }),
    ).rejects.toThrow('Auditor access required');

    const inputs = await t.query(api.services.audit.auditInputs, {
      secret,
      runToken,
      workspaceId,
      date: yesterday,
    });
    expect(inputs.standards).toBe('Every claim cites the record.');
    expect(inputs.work).toHaveLength(1);
    expect(inputs.work[0]).toMatchObject({
      taskId,
      title: 'Draft the release notes',
      employeeId,
      report: expect.objectContaining({ done: ['Wrote the release notes'] }),
      memoryWrites: 0,
    });

    const finding = {
      employeeId,
      taskId,
      severity: 'medium' as const,
      claim: 'The report claims release notes the journal does not show.',
      evidence: 'No artifact and no tool call for the notes.',
      requiredAction: 'Produce the notes or correct the report.',
    };
    const documents = await t.mutation(api.services.audit.recordFindings, {
      secret,
      runToken,
      workspaceId,
      date,
      findings: [finding],
    });
    expect(documents).toHaveLength(1);
    expect(documents[0]).toMatchObject({ employeeId, employeeName: 'Operations analyst' });
    expect(documents[0].findings).toHaveLength(1);
    // A re-run of the same audit records the same claim once.
    const again = await t.mutation(api.services.audit.recordFindings, {
      secret,
      runToken,
      workspaceId,
      date,
      findings: [finding, { ...finding, claim: 'A second claim.' }],
    });
    expect(again[0].findings).toHaveLength(2);

    expect(await owner.query(api.audit.findings, { status: 'open' })).toHaveLength(2);
    expect(await owner.query(api.audit.documents, { date })).toHaveLength(1);
    expect(await owner.query(api.audit.documents, { date: yesterday })).toEqual([]);
    const open = await t.query(api.services.audit.openFindingsFor, { secret, employeeId });
    expect(open).toHaveLength(2);
    expect(open[0].prompt).toContain('Required action: Produce the notes');
  });

  it('posts the night’s findings to the audit channel and the instance’s floor', async () => {
    const t = harness();
    const { owner, workspaceId, employeeId, taskId, runToken } = await auditedDay(t);
    const { floorId } = await owner.mutation(api.floors.create, {
      name: 'Launch',
      brief: 'Prepare the launch.',
      employeeIds: [employeeId],
    });
    await t.run(async (ctx) => ctx.db.patch(employeeId, { floorId }));
    const finding = {
      employeeId,
      taskId,
      severity: 'medium' as const,
      claim: 'The report claims release notes the journal does not show.',
      evidence: 'No artifact and no tool call for the notes.',
      requiredAction: 'Produce the notes or correct the report.',
    };
    const record = () =>
      t.mutation(api.services.audit.recordFindings, {
        secret,
        runToken,
        workspaceId,
        date,
        findings: [finding],
      });
    await record();

    const posts = async (kind: 'audit' | 'floor', scopeId: string) => {
      const { channelId } = await owner.mutation(api.channels.open, { kind, scopeId });
      return (await owner.query(api.channels.posts, { channelId })).filter((post) => post.kind === 'finding');
    };
    for (const found of [await posts('audit', ''), await posts('floor', floorId)]) {
      expect(found).toHaveLength(1);
      expect(found[0].text).toContain('MEDIUM: The report claims release notes');
      expect(found[0].text).toContain('Produce the notes or correct the report.');
      expect(found[0].authorName).toBe('Operations analyst');
    }
    // The same audit run again records nothing new, so it posts nothing new either.
    await record();
    expect(await posts('audit', '')).toHaveLength(1);
  });

  it('escalates to the workspace channel and the next meeting’s agenda', async () => {
    const t = harness();
    const { owner, workspaceId, employeeId, taskId, runToken } = await auditedDay(t);
    const boss = t.withIdentity(orgIdentity('boss', 'acme', 'org:admin'));
    const { entryId } = await boss.mutation(api.calendar.createMeeting, {
      title: 'Launch review',
      startsAt: Date.now() + 86_400_000,
      endsAt: Date.now() + 86_400_000 + 1_800_000,
      attendees: [],
      agenda: ['Launch readiness'],
    });
    await t.mutation(api.services.audit.recordFindings, {
      secret,
      runToken,
      workspaceId,
      date,
      findings: [
        {
          employeeId,
          taskId,
          severity: 'high' as const,
          claim: 'A test was reported as passing without a run.',
          evidence: 'No tool call ran the suite.',
          requiredAction: 'Run the suite and report the result.',
        },
      ],
    });
    const [open] = await owner.query(api.audit.findings, { status: 'open' });
    await boss.mutation(api.audit.escalate, { id: open.id as Id<'auditFindings'> });

    const { channelId } = await owner.mutation(api.channels.open, { kind: 'workspace', scopeId: '' });
    const [posted] = await owner.query(api.channels.posts, { channelId });
    expect(posted.text).toContain('Escalated finding against Operations analyst');
    expect(posted.text).toContain('Required action: Run the suite');
    expect(await t.run(async (ctx) => (await ctx.db.get(entryId))!.agenda)).toEqual([
      'Launch readiness',
      'Escalated finding: A test was reported as passing without a run.',
    ]);

    // A second escalation of the same finding changes nothing and says nothing twice.
    await boss.mutation(api.audit.escalate, { id: open.id as Id<'auditFindings'> });
    expect(await owner.query(api.channels.posts, { channelId })).toHaveLength(1);
  });

  it('moves a finding from open to addressed, verified, or escalated', async () => {
    const t = harness();
    const { owner, workspaceId, employeeId, taskId, runToken } = await auditedDay(t);
    await t.mutation(api.services.audit.recordFindings, {
      secret,
      runToken,
      workspaceId,
      date: yesterday,
      findings: [
        {
          employeeId,
          taskId,
          severity: 'high' as const,
          claim: 'A test was reported as passing without a run.',
          evidence: 'No tool call ran the suite.',
          requiredAction: 'Run the suite and report the result.',
        },
      ],
    });
    const [listed] = await owner.query(api.audit.findings, {});
    const findingId = listed.id as Id<'auditFindings'>;

    const colleague = t.withIdentity(orgIdentity('colleague', 'acme'));
    await expect(colleague.mutation(api.audit.markAddressed, { id: findingId })).rejects.toThrow(
      'task owner or an administrator',
    );
    await owner.mutation(api.audit.markAddressed, { id: findingId });
    expect((await owner.query(api.audit.findings, {}))[0].status).toBe('addressed');

    // Verification is not granted on a person's word alone: the later record must show the action.
    expect(
      await t.mutation(api.services.audit.verifyFindings, { secret, runToken, workspaceId, date }),
    ).toEqual({ verified: 0 });
    await t.run(async (ctx) => {
      const finding = await ctx.db.get(findingId);
      await ctx.db.insert('reports', {
        workspaceId,
        taskId,
        employeeId,
        done: [`Ran the suite for finding ${findingId}`],
        inProgress: [],
        blockedOn: [],
        next: [],
        risks: [],
        inferred: false,
        createdAt: finding!.updatedAt + 1,
      });
    });
    expect(
      await t.mutation(api.services.audit.verifyFindings, { secret, runToken, workspaceId, date }),
    ).toEqual({ verified: 1 });
    expect((await owner.query(api.audit.findings, {}))[0].status).toBe('verified');
    expect((await owner.query(api.audit.documents, { date: yesterday }))[0].verified).toBe(1);

    await t.mutation(api.services.audit.recordFindings, {
      secret,
      runToken,
      workspaceId,
      date: yesterday,
      findings: [
        {
          employeeId,
          severity: 'low' as const,
          claim: 'The copy misses the workspace standard.',
          evidence: 'Two headings break the house style.',
          requiredAction: 'Rewrite the headings.',
        },
      ],
    });
    const ignored = (await owner.query(api.audit.findings, { status: 'open' }))[0];
    await expect(
      owner.mutation(api.audit.escalate, { id: ignored.id as Id<'auditFindings'> }),
    ).rejects.toThrow('Only an administrator');
    const boss = t.withIdentity(orgIdentity('boss', 'acme', 'org:admin'));
    await boss.mutation(api.audit.escalate, { id: ignored.id as Id<'auditFindings'> });
    expect((await owner.query(api.audit.findings, { status: 'escalated' }))[0].id).toBe(ignored.id);
    // A finding without a task is still an administrator's to address.
    await boss.mutation(api.audit.markAddressed, { id: ignored.id as Id<'auditFindings'> });
    expect((await owner.query(api.audit.findings, { status: 'addressed' }))[0].id).toBe(ignored.id);
  });
});

describe('a hard audit policy', () => {
  it('refuses new work for an instance with open findings, and lets it through once they are addressed', async () => {
    const t = harness();
    const { owner, workspaceId, employeeId, runToken } = await auditedDay(t);
    await t.run(async (ctx) => {
      const settings = await ctx.db
        .query('workspaceSettings')
        .filter((q) => q.eq(q.field('workspaceId'), workspaceId))
        .unique();
      if (settings) await ctx.db.patch(settings._id, { auditPolicy: 'hard' });
    });
    await t.mutation(api.services.audit.recordFindings, {
      secret,
      runToken,
      workspaceId,
      date,
      findings: [
        {
          employeeId,
          severity: 'high' as const,
          claim: 'The report names no file.',
          evidence: 'The journal shows none.',
          requiredAction: 'Name the files or withdraw the claim.',
        },
      ],
    });

    const newWork = () =>
      owner.mutation(api.tasks.create, {
        employeeId,
        title: 'Start the next draft',
        prompt: 'Draft it.',
      });
    await expect(newWork()).rejects.toThrow('audit policy holds its other work');

    const finding = (await owner.query(api.audit.findings, { status: 'open' }))[0];
    const boss = t.withIdentity(orgIdentity('boss', 'acme', 'org:admin'));
    await boss.mutation(api.audit.markAddressed, { id: finding.id as Id<'auditFindings'> });
    expect(await newWork()).toMatchObject({ taskId: expect.anything() });
  });
});
