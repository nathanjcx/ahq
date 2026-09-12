'use client';

import { ArrowUpRight, Check, Siren } from 'lucide-react';
import type { AuditFinding, FindingStatus, Severity } from '@/lib/contracts';

export const severityLabels: Record<Severity, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

const statusLabels: Record<FindingStatus, string> = {
  open: 'Open',
  addressed: 'Addressed',
  verified: 'Verified',
  escalated: 'Escalated',
};

const statusNotes: Record<FindingStatus, string> = {
  open: 'Leads the employee’s next shift.',
  addressed: 'Tonight’s audit re-checks it against the record.',
  verified: 'The auditor confirmed the fix against the record.',
  escalated: 'In the workspace channel and on the next meeting’s agenda.',
};

/** A finding still owes work when it is open or escalated; that is what delays the day. */
export function isOutstanding(finding: AuditFinding) {
  return finding.status === 'open' || finding.status === 'escalated';
}

export function FindingCard({
  finding,
  taskTitle,
  canDecide,
  canEscalate,
  onOpenTask,
  onAddress,
  onEscalate,
}: {
  finding: AuditFinding;
  taskTitle?: string;
  canDecide: boolean;
  canEscalate: boolean;
  onOpenTask: (taskId: string) => void;
  onAddress: (findingId: string) => void;
  onEscalate: (findingId: string) => void;
}) {
  const taskId = finding.taskId;
  return (
    <article className="finding" data-status={finding.status}>
      <div className="finding-head">
        <span className="finding-severity" data-severity={finding.severity}>
          {severityLabels[finding.severity]}
        </span>
        <span className="finding-status">{statusLabels[finding.status]}</span>
        <small>{statusNotes[finding.status]}</small>
      </div>
      <p className="finding-claim">{finding.claim}</p>
      <blockquote className="finding-evidence">{finding.evidence}</blockquote>
      <p className="finding-action">
        <span className="eyebrow">REQUIRED</span>
        {finding.requiredAction}
      </p>
      <div className="finding-actions">
        {taskId && (
          <button className="text-button" onClick={() => onOpenTask(taskId)}>
            {taskTitle ?? 'Open the task'} <ArrowUpRight size={14} />
          </button>
        )}
        {isOutstanding(finding) && (
          <button
            className="text-button"
            disabled={!canDecide}
            title={canDecide ? undefined : 'Only the task owner or an administrator can address this.'}
            onClick={() => onAddress(finding.id)}
          >
            <Check size={14} /> Mark addressed
          </button>
        )}
        {finding.status !== 'verified' && finding.status !== 'escalated' && (
          <button
            className="text-button danger-text"
            disabled={!canEscalate}
            title={canEscalate ? undefined : 'Only an administrator can escalate a finding.'}
            onClick={() => onEscalate(finding.id)}
          >
            <Siren size={14} /> Escalate
          </button>
        )}
      </div>
    </article>
  );
}
