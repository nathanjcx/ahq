import type { AuditDocument, AuditFinding, Severity } from '../../lib/contracts/audit';
import type { Persona } from '../../lib/contracts/core';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { cleanText, randomToken, type Ctx } from '../shared';
import { employeeName } from './meetings';
import { insertJob } from './tasks';

/** One day back from an ISO date, in the same `YYYY-MM-DD` form the shifts and findings use. */
export function previousDate(date: string) {
  const parsed = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed)) throw new Error('Audit date must be YYYY-MM-DD');
  return new Date(parsed - 86_400_000).toISOString().slice(0, 10);
}

/** The day's bounds in milliseconds, used to select the journal that belongs to one audit. */
export function dateRange(date: string) {
  const startsAt = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(startsAt)) throw new Error('Audit date must be YYYY-MM-DD');
  return { startsAt, endsAt: startsAt + 86_400_000 };
}

export type FindingInput = {
  employeeId: Id<'installations'>;
  taskId?: Id<'tasks'>;
  severity: Severity;
  claim: string;
  evidence: string;
  requiredAction: string;
};

/** A finding names a live employee of the workspace and carries evidence for its claim. */
export async function validateFinding(ctx: Ctx, workspaceId: Id<'workspaces'>, finding: FindingInput) {
  const installation = await ctx.db.get(finding.employeeId);
  if (!installation || installation.workspaceId !== workspaceId) throw new Error('Employee not found');
  if (finding.taskId) {
    const task = await ctx.db.get(finding.taskId);
    if (!task || task.workspaceId !== workspaceId) throw new Error('Task not found');
  }
  return {
    employeeId: installation._id,
    ...(finding.taskId ? { taskId: finding.taskId } : {}),
    severity: finding.severity,
    claim: cleanText(finding.claim, 'Finding claim', 2_000),
    evidence: cleanText(finding.evidence, 'Finding evidence', 5_000),
    requiredAction: cleanText(finding.requiredAction, 'Finding action', 2_000),
  };
}

/** A finding in the shape the interface renders. */
export async function publicFinding(ctx: Ctx, finding: Doc<'auditFindings'>): Promise<AuditFinding> {
  const installation = await ctx.db.get(finding.employeeId);
  return {
    id: finding._id,
    employeeId: finding.employeeId,
    employeeName: installation ? await employeeName(ctx, installation) : 'Employee',
    taskId: finding.taskId,
    auditDate: finding.auditDate,
    severity: finding.severity,
    claim: finding.claim,
    evidence: finding.evidence,
    requiredAction: finding.requiredAction,
    status: finding.status,
    createdAt: finding.createdAt,
    updatedAt: finding.updatedAt,
  };
}

/** One document per instance: the night's findings for that employee, with its running tallies. */
export function groupFindings(findings: AuditFinding[]): AuditDocument[] {
  const documents = new Map<string, AuditDocument>();
  for (const finding of findings) {
    const document = documents.get(finding.employeeId) || {
      employeeId: finding.employeeId,
      employeeName: finding.employeeName,
      auditDate: finding.auditDate,
      findings: [],
      verified: 0,
      escalated: 0,
    };
    document.findings.push(finding);
    if (finding.status === 'verified') document.verified += 1;
    if (finding.status === 'escalated') document.escalated += 1;
    documents.set(finding.employeeId, document);
  }
  return [...documents.values()].sort((a, b) => a.employeeName.localeCompare(b.employeeName));
}

/**
 * The single instance of a reserved kind in a workspace, created with its own employee version on
 * first use. Reserved employees are made by the workspace, never hired, and carry no capabilities.
 */
export async function ensureReservedInstance(
  ctx: MutationCtx,
  workspaceId: Id<'workspaces'>,
  kind: 'janitor' | 'auditor' | 'triage',
  name: string,
  persona: Persona,
) {
  const installations = await ctx.db
    .query('installations')
    .withIndex('by_workspace', (q) => q.eq('workspaceId', workspaceId))
    .collect();
  const existing = installations.find(
    (installation) => installation.kind === kind && installation.status !== 'retired',
  );
  if (existing) return existing;
  const now = Date.now();
  const version = {
    name,
    role: 'Reserved',
    description: `The workspace's ${kind}.`,
    category: 'Reserved',
    strengths: [],
    limitations: [],
    capabilities: [],
    model: 'gpt-5.6-terra' as const,
    color: '#4b5563',
    media: [],
    instructions: `You are ${name}, the ${kind} of this workspace. Work only from the records you are given and report exactly what they support.`,
    skills: [],
    persona,
  };
  const draftId = await ctx.db.insert('employeeDrafts', {
    createdBy: 'system',
    ...version,
    updatedAt: now,
  });
  const versionId = await ctx.db.insert('employeeVersions', {
    draftId,
    version: 1,
    ...version,
    publishedBy: 'system',
    publishedAt: now,
  });
  const employeeId = await ctx.db.insert('installations', {
    workspaceId,
    versionId,
    hiredBy: 'system',
    status: 'ready',
    name,
    kind,
    createdAt: now,
  });
  const installation = await ctx.db.get(employeeId);
  if (!installation) throw new Error('Reserved employee was not created');
  return installation;
}

/** The stern reserved auditor of a workspace. */
export async function ensureAuditor(ctx: MutationCtx, workspaceId: Id<'workspaces'>) {
  return ensureReservedInstance(ctx, workspaceId, 'auditor', 'The Auditor', {
    voice: 'Precise and unsparing. You quote the record and you never soften a finding.',
    traits: ['formal', 'blunt', 'methodical'],
  });
}

/**
 * The auditor's hidden task for one night, and its `audit_run` job. Like a meeting task it carries
 * no `start_task` job: the audit job is its input, and `recordFindings` completes it.
 */
export async function ensureAuditRun(ctx: MutationCtx, workspaceId: Id<'workspaces'>, date: string) {
  dateRange(date);
  const uniqueKey = `audit_run:${workspaceId}:${date}`;
  const existing = await ctx.db
    .query('jobs')
    .withIndex('by_unique_key', (q) => q.eq('uniqueKey', uniqueKey))
    .unique();
  if (existing) return existing.taskId;
  const auditor = await ensureAuditor(ctx, workspaceId);
  const version = await ctx.db.get(auditor.versionId);
  if (!version) throw new Error('Employee version not found');
  const now = Date.now();
  const taskId = await ctx.db.insert('tasks', {
    workspaceId,
    cadence: 'once',
    createdBy: 'system',
    createdByName: 'Audit',
    visibility: 'workspace',
    employeeId: auditor._id,
    versionId: version._id,
    employeeName: auditor.name || version.name,
    title: `Audit: ${date}`,
    prompt: `Audit every shift of ${date} against the workspace standard. Report only what the records support.`,
    status: 'queued',
    model: version.model,
    createdAt: now,
    updatedAt: now,
    runToken: randomToken(),
  });
  await insertJob(ctx, {
    workspaceId,
    taskId,
    uniqueKey,
    kind: 'audit_run',
    payload: JSON.stringify({ workspaceId, date }),
  });
  return taskId;
}
