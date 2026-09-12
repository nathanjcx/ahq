import { describe, expect, it } from 'vitest';
import { api } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import { ensureAuditRun } from '../convex/lib/audit';
import { harness, identity as orgIdentity, publishEmployee, secret, type Harness } from './support';

const date = '2026-09-12';
const yesterday = '2026-09-11';
const noon = Date.parse(`${yesterday}T12:00:00Z`);

/** A workspace with one finished shift on the audited day, and its nightly auditor run. */
async function auditedDay(t: Harness) {
  const { versionId } = await publishEmployee(t);
  const owner = t.withIdentity(orgIdentity('owner', 'acme'));
  await owner.mutation(api.workspace.bootstrap, { name: 'Acme' });
  const { employeeId } = await owner.mutation(api.marketplace.hire, { versionId });
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
  return { owner, workspaceId, employeeId, taskId, runToken };
}

describe('audit findings', () => {
  it('runs one auditor over the day and records findings once', async () => {
    const t = harness();
    const { owner, workspaceId, employeeId, taskId, runToken } = await auditedDay(t);

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
    expect(await jobKinds(t)).toContain('audit_run');

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

async function jobKinds(t: Harness) {
  return t.run(async (ctx) => (await ctx.db.query('jobs').collect()).map((job) => job.kind));
}
