import { v } from 'convex/values';
import type { Id } from '../_generated/dataModel';
import { mutation, query, type MutationCtx } from '../_generated/server';
import {
  dateRange,
  ensureAuditor,
  groupFindings,
  openFindings,
  previousDate,
  publicFinding,
  validateFinding,
  type FindingInput,
} from '../lib/audit';
import { employeeName } from '../lib/meetings';
import { channelFor, insertPost, type ChannelScope } from '../lib/posts';
import { severity } from '../schema';
import { requireService, untrustedBlock, type Ctx } from '../shared';
import { taskForRunToken } from './context';

/** Audit functions run only under a run token belonging to the workspace's reserved auditor. */
async function requireAuditorRun(ctx: Ctx, runToken: string, workspaceId: Id<'workspaces'>) {
  const task = await taskForRunToken(ctx, runToken);
  if (task.workspaceId !== workspaceId) throw new Error('Audit authorization is for another workspace');
  const installation = await ctx.db.get(task.employeeId);
  if (!installation || installation.kind !== 'auditor') throw new Error('Auditor access required');
  return task;
}

/**
 * The night's findings for one instance, posted where they will be read: the audit channel, and the
 * floor the instance works on, so the day opens with them.
 */
async function postFindings(
  ctx: MutationCtx,
  workspaceId: Id<'workspaces'>,
  date: string,
  employeeId: Id<'installations'>,
  findings: FindingInput[],
) {
  const installation = await ctx.db.get(employeeId);
  if (!installation) return;
  const name = await employeeName(ctx, installation);
  const scopes: ChannelScope[] = [['audit', '']];
  if (installation.floorId) scopes.push(['floor', installation.floorId]);
  const text = [
    `${name} — audit of ${date}`,
    ...findings.map(
      (finding) => `${finding.severity.toUpperCase()}: ${finding.claim} → ${finding.requiredAction}`,
    ),
  ].join('\n');
  for (const [kind, scopeId] of scopes)
    await insertPost(ctx, {
      channel: await channelFor(ctx, workspaceId, kind, scopeId),
      kind: 'finding',
      authorEmployeeId: employeeId,
      authorName: name,
      text,
    });
}

/** Findings of one day in the workspace, newest first. */
async function findingsOn(ctx: Ctx, workspaceId: Id<'workspaces'>, date: string) {
  return ctx.db
    .query('auditFindings')
    .withIndex('by_workspace_date', (q) => q.eq('workspaceId', workspaceId).eq('auditDate', date))
    .collect();
}

/** Everything one night's audit reads: the day's work, its journal, and yesterday's open findings. */
export const auditInputs = query({
  args: {
    secret: v.string(),
    runToken: v.string(),
    workspaceId: v.id('workspaces'),
    date: v.string(),
  },
  handler: async (ctx, args) => {
    requireService(args.secret);
    await requireAuditorRun(ctx, args.runToken, args.workspaceId);
    const { startsAt, endsAt } = dateRange(args.date);
    const [shifts, settings, memories] = await Promise.all([
      ctx.db
        .query('shifts')
        .withIndex('by_workspace_date', (q) => q.eq('workspaceId', args.workspaceId).eq('date', args.date))
        .collect(),
      ctx.db
        .query('workspaceSettings')
        .withIndex('by_workspace', (q) => q.eq('workspaceId', args.workspaceId))
        .unique(),
      ctx.db
        .query('memories')
        .withIndex('by_workspace_status', (q) => q.eq('workspaceId', args.workspaceId))
        .take(1_000),
    ]);
    const work = [];
    for (const shift of shifts.filter((one) => one.endedAt !== undefined)) {
      const task = await ctx.db.get(shift.taskId);
      if (!task || task.workspaceId !== args.workspaceId) continue;
      const [reports, events, toolCalls, artifacts, installation] = await Promise.all([
        ctx.db
          .query('reports')
          .withIndex('by_task', (q) => q.eq('taskId', task._id))
          .collect(),
        ctx.db
          .query('events')
          .withIndex('by_task', (q) => q.eq('taskId', task._id))
          .take(1_000),
        ctx.db
          .query('toolCalls')
          .withIndex('by_task', (q) => q.eq('taskId', task._id))
          .take(500),
        ctx.db
          .query('artifacts')
          .withIndex('by_task', (q) => q.eq('taskId', task._id))
          .take(100),
        ctx.db.get(shift.employeeId),
      ]);
      const report = shift.reportId
        ? reports.find((one) => one._id === shift.reportId)
        : reports.find((one) => one.createdAt >= startsAt && one.createdAt < endsAt);
      work.push({
        taskId: task._id,
        title: task.title,
        status: task.status,
        employeeId: shift.employeeId,
        employeeName: installation ? await employeeName(ctx, installation) : task.employeeName,
        shift: {
          id: shift._id,
          kind: shift.kind,
          model: shift.model,
          startedAt: shift.startedAt,
          endedAt: shift.endedAt,
        },
        // Reports are the employee's own words about its work, so the auditor reads them as claims.
        report: report
          ? {
              done: report.done,
              inProgress: report.inProgress,
              blockedOn: report.blockedOn,
              next: report.next,
              risks: report.risks,
              deadlineConfidence: report.deadlineConfidence,
              inferred: report.inferred,
            }
          : undefined,
        eventCount: events.length,
        toolCalls: toolCalls
          .filter((call) => call.createdAt >= startsAt && call.createdAt < endsAt)
          .map((call) => ({ tool: call.tool, outcome: call.outcome, reason: call.reason })),
        artifactIds: artifacts.map((artifact) => artifact._id),
        memoryWrites: memories.filter((memory) => memory.sourceTaskId === task._id).length,
      });
    }
    const yesterday = await findingsOn(ctx, args.workspaceId, previousDate(args.date));
    return {
      date: args.date,
      // The standard is written by an administrator, so it is instruction, not material.
      standards: settings?.standards || '',
      work,
      openFindings: await Promise.all(
        yesterday
          .filter((finding) => finding.status !== 'verified')
          .map((finding) => publicFinding(ctx, finding)),
      ),
    };
  },
});

/** The night's findings. Re-running the same audit adds nothing: a claim is recorded once per day. */
export const recordFindings = mutation({
  args: {
    secret: v.string(),
    runToken: v.string(),
    workspaceId: v.id('workspaces'),
    date: v.string(),
    findings: v.array(
      v.object({
        employeeId: v.id('installations'),
        taskId: v.optional(v.id('tasks')),
        severity,
        claim: v.string(),
        evidence: v.string(),
        requiredAction: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    requireService(args.secret);
    await requireAuditorRun(ctx, args.runToken, args.workspaceId);
    dateRange(args.date);
    const existing = await findingsOn(ctx, args.workspaceId, args.date);
    const seen = new Set(existing.map((finding) => `${finding.employeeId}:${finding.claim}`));
    const added = new Map<Id<'installations'>, FindingInput[]>();
    for (const input of args.findings.slice(0, 200)) {
      const fields = await validateFinding(ctx, args.workspaceId, input);
      const key = `${fields.employeeId}:${fields.claim}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const now = Date.now();
      await ctx.db.insert('auditFindings', {
        workspaceId: args.workspaceId,
        ...fields,
        auditDate: args.date,
        status: 'open',
        createdAt: now,
        updatedAt: now,
      });
      added.set(fields.employeeId, [...(added.get(fields.employeeId) ?? []), fields]);
    }
    const findings = await Promise.all(
      (await findingsOn(ctx, args.workspaceId, args.date)).map((finding) => publicFinding(ctx, finding)),
    );
    // Only what this run added is posted, so re-running the same audit does not repeat itself.
    for (const [employeeId, fresh] of added)
      await postFindings(ctx, args.workspaceId, args.date, employeeId, fresh);
    return groupFindings(findings);
  },
});

/**
 * Yesterday's addressed findings become verified when the record shows the action: a report written
 * on the finding's task after it was addressed names the finding.
 */
export const verifyFindings = mutation({
  args: { secret: v.string(), runToken: v.string(), workspaceId: v.id('workspaces'), date: v.string() },
  returns: v.object({ verified: v.number() }),
  handler: async (ctx, args) => {
    requireService(args.secret);
    await requireAuditorRun(ctx, args.runToken, args.workspaceId);
    const findings = await findingsOn(ctx, args.workspaceId, previousDate(args.date));
    let verified = 0;
    for (const finding of findings) {
      if (finding.status !== 'addressed' || !finding.taskId) continue;
      const reports = await ctx.db
        .query('reports')
        .withIndex('by_task', (q) => q.eq('taskId', finding.taskId as Id<'tasks'>))
        .collect();
      const mentioned = reports.some(
        (report) =>
          report.createdAt >= finding.updatedAt &&
          [...report.done, ...report.inProgress, ...report.next].some((line) => line.includes(finding._id)),
      );
      if (!mentioned) continue;
      await ctx.db.patch(finding._id, { status: 'verified', updatedAt: Date.now() });
      verified += 1;
    }
    return { verified };
  },
});

/** Unresolved findings for one employee. The shift planner runs these before any other work. */
export const openFindingsFor = query({
  args: { secret: v.string(), employeeId: v.id('installations') },
  handler: async (ctx, args) => {
    requireService(args.secret);
    return Promise.all(
      (await openFindings(ctx, args.employeeId)).map(async (finding) => ({
        ...(await publicFinding(ctx, finding)),
        // The claim and the required action were written by the auditor, another agent.
        prompt: untrustedBlock(`${finding.claim}\nRequired action: ${finding.requiredAction}`),
      })),
    );
  },
});

/** The system marks a finding addressed when a remediation shift ends. */
export const markAddressed = mutation({
  args: { secret: v.string(), findingId: v.id('auditFindings') },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireService(args.secret);
    const finding = await ctx.db.get(args.findingId);
    if (!finding) throw new Error('Finding not found');
    if (finding.status === 'open' || finding.status === 'escalated')
      await ctx.db.patch(finding._id, { status: 'addressed', updatedAt: Date.now() });
    return null;
  },
});

/** Creates the workspace's single auditor instance on first use. */
export const ensureAuditors = mutation({
  args: { secret: v.string(), workspaceId: v.id('workspaces') },
  returns: v.object({ employeeId: v.id('installations') }),
  handler: async (ctx, args) => {
    requireService(args.secret);
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) throw new Error('Workspace not found');
    const { installation } = await ensureAuditor(ctx, args.workspaceId);
    return { employeeId: installation._id };
  },
});
