import type { FixtureQueries } from '@/components/shared/use-ui-query';
import type { AuditDocument, AuditFinding } from '@/lib/contracts';

/**
 * Two nights of audits: the most recent covers two instances and carries an escalation the workspace
 * has already been told about, the one before it shows what a verified finding looks like.
 */

const hour = 3_600_000;
const now = Date.UTC(2026, 2, 17, 14, 30);
const ago = (hours: number) => now - hours * hour;

const findings: AuditFinding[] = [
  {
    id: 'fnd_ada_tests',
    employeeId: 'emp_ada',
    employeeName: 'Ada',
    taskId: 'task_completed',
    auditDate: '2026-03-16',
    severity: 'high',
    claim: 'The report says the migration was tested end to end; the journal shows no test run that day.',
    evidence:
      'report/task_completed: "verified end to end against staging"\njournal/task_completed: 14 tool calls, none of them run_tests or a staging request.',
    requiredAction: 'Run the migration against staging and attach the output, or correct the report.',
    status: 'escalated',
    createdAt: ago(17),
    updatedAt: ago(6),
  },
  {
    id: 'fnd_ada_copy',
    employeeId: 'emp_ada',
    employeeName: 'Ada',
    auditDate: '2026-03-16',
    severity: 'low',
    claim: 'The customer announcement opens with an apology instead of the change.',
    evidence:
      'artifact/art_announcement, first line: "We’re so sorry for the disruption this may cause…"\nworkspace standard: copy says what changed and what the reader has to do, in that order.',
    requiredAction: 'Rewrite the opening so the change comes first.',
    status: 'open',
    createdAt: ago(17),
    updatedAt: ago(17),
  },
  {
    id: 'fnd_bruno_numbers',
    employeeId: 'emp_bruno',
    employeeName: 'Bruno',
    taskId: 'task_running',
    auditDate: '2026-03-16',
    severity: 'medium',
    claim: 'The migration notes quote a row count that appears in no source the journal read.',
    evidence: 'draft: "roughly 240,000 rows"\njournal/task_running: no query returned a count.',
    requiredAction: 'Cite the query that produced the number, or remove it.',
    status: 'addressed',
    createdAt: ago(17),
    updatedAt: ago(9),
  },
  {
    id: 'fnd_bruno_prior',
    employeeId: 'emp_bruno',
    employeeName: 'Bruno',
    auditDate: '2026-03-15',
    severity: 'medium',
    claim: 'Yesterday’s finding about the missing changelog entry was not addressed.',
    evidence: 'finding fnd_bruno_changelog remained open through the whole shift; no journal entry cites it.',
    requiredAction: 'Address the open finding before any new work.',
    status: 'verified',
    createdAt: ago(41),
    updatedAt: ago(18),
  },
  {
    id: 'fnd_mina_tone',
    employeeId: 'emp_mina',
    employeeName: 'Mina',
    auditDate: '2026-03-15',
    severity: 'low',
    claim: 'Two replies in the support queue answered a billing question without escalating first.',
    evidence: 'floor claim: "Anything touching billing is escalated to a person before a reply is sent."',
    requiredAction: 'Escalate both threads and note the correction in the floor channel.',
    status: 'verified',
    createdAt: ago(41),
    updatedAt: ago(20),
  },
];

/** One document per instance for a night, the shape `audit:documents` returns. */
function documentsFor(date: string): AuditDocument[] {
  const nightly = findings.filter((finding) => finding.auditDate === date);
  const byEmployee = new Map<string, AuditDocument>();
  for (const finding of nightly) {
    const document = byEmployee.get(finding.employeeId) ?? {
      employeeId: finding.employeeId,
      employeeName: finding.employeeName,
      auditDate: date,
      findings: [],
      verified: 0,
      escalated: 0,
    };
    document.findings.push(finding);
    if (finding.status === 'verified') document.verified += 1;
    if (finding.status === 'escalated') document.escalated += 1;
    byEmployee.set(finding.employeeId, document);
  }
  return [...byEmployee.values()].sort((a, b) => a.employeeName.localeCompare(b.employeeName));
}

export const auditQueries: FixtureQueries = {
  'audit:findings': (args: { status?: AuditFinding['status']; date?: string }) =>
    findings.filter(
      (finding) =>
        (!args.status || finding.status === args.status) && (!args.date || finding.auditDate === args.date),
    ),
  'audit:documents': (args: { date: string }) => documentsFor(args.date),
};
