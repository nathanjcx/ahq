import type { AuditDocument, AuditFinding, Severity } from '../../lib/contracts/audit';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { cleanText, type Ctx } from '../shared';
import { employeeName } from './meetings';
import { ensureReservedInstance } from './reserved';
import { openSessionTask } from './tasks';

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

/** The stern reserved auditor of a workspace. */
export async function ensureAuditor(ctx: MutationCtx, workspaceId: Id<'workspaces'>) {
  return ensureReservedInstance(ctx, workspaceId, 'auditor', 'The Auditor', {
    voice: 'Precise and unsparing. You quote the record and you never soften a finding.',
    traits: ['formal', 'blunt', 'methodical'],
  });
}

/** Findings an employee still owes work on, oldest first. These lead its next working day. */
export async function openFindings(ctx: Ctx, employeeId: Id<'installations'>) {
  const findings: Doc<'auditFindings'>[] = [];
  for (const status of ['open', 'escalated'] as const)
    findings.push(
      ...(await ctx.db
        .query('auditFindings')
        .withIndex('by_employee_status', (q) => q.eq('employeeId', employeeId).eq('status', status))
        .collect()),
    );
  return findings.sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * The auditor's hidden task for one night. Like a meeting task it carries no `start_task` job: the
 * scheduler's `audit_run` job is its input, and `recordFindings` completes it.
 */
export async function ensureAuditRun(ctx: MutationCtx, workspaceId: Id<'workspaces'>, date: string) {
  dateRange(date);
  const workspace = await ctx.db.get(workspaceId);
  if (!workspace) throw new Error('Workspace not found');
  const { installation, version } = await ensureAuditor(ctx, workspaceId);
  return openSessionTask(ctx, {
    workspace,
    employeeId: installation._id,
    version,
    kind: 'audit',
    key: date,
    title: `Audit: ${date}`,
    prompt: `Audit every shift of ${date} against the workspace standard. Report only what the records support.`,
  });
}
