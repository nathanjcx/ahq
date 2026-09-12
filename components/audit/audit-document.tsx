'use client';

import { FindingCard, isOutstanding } from './finding-card';
import type { AuditFinding } from '@/lib/contracts';
import { pluralize } from '@/lib/text';

/** One night's findings against one instance, in the order the employee will work through them. */
export function AuditDocument({
  employeeName,
  floorName,
  findings,
  hardPolicy,
  taskTitles,
  canDecide,
  canEscalate,
  onOpenTask,
  onAddress,
  onEscalate,
}: {
  employeeName: string;
  floorName: string;
  findings: AuditFinding[];
  /** Under the hard policy new work is blocked; under the soft policy it only waits behind findings. */
  hardPolicy: boolean;
  taskTitles: Map<string, string>;
  canDecide: (finding: AuditFinding) => boolean;
  canEscalate: boolean;
  onOpenTask: (taskId: string) => void;
  onAddress: (findingId: string) => void;
  onEscalate: (findingId: string) => void;
}) {
  const outstanding = findings.filter(isOutstanding);
  const verified = findings.filter((finding) => finding.status === 'verified').length;
  return (
    <section className="audit-document">
      <header>
        <div>
          <h3>{employeeName}</h3>
          <small>{floorName}</small>
        </div>
        <span className="document-tally">
          {pluralize(findings.length, 'finding')}
          {verified ? ` · ${verified} verified` : ''}
        </span>
      </header>
      {outstanding.length > 0 && (
        <p className="document-effect" data-hard={hardPolicy}>
          {employeeName} starts the next shift on {pluralize(outstanding.length, 'finding')}.{' '}
          {hardPolicy
            ? 'Under the hard policy, no other work runs until they are addressed.'
            : 'Other work waits behind them for that day only.'}
        </p>
      )}
      {findings.map((finding) => (
        <FindingCard
          key={finding.id}
          finding={finding}
          taskTitle={finding.taskId ? taskTitles.get(finding.taskId) : undefined}
          canDecide={canDecide(finding)}
          canEscalate={canEscalate}
          onOpenTask={onOpenTask}
          onAddress={onAddress}
          onEscalate={onEscalate}
        />
      ))}
    </section>
  );
}
