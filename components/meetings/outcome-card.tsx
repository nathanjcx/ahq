'use client';

import { ArrowUpRight, Check, X } from 'lucide-react';
import type { OutcomeResult } from '../app/actions/meetings';
import type { MeetingTurn, OutcomeKind } from '@/lib/contracts';

const KIND_LABEL: Record<OutcomeKind, string> = {
  task: 'Task',
  deadline: 'Deadline change',
  meeting: 'Next meeting',
  note: 'Note',
};

/**
 * One thing a wrap-up proposed. Nothing here has happened until a person confirms it; once it has,
 * the card says where it went so the meeting is not the last place the decision exists.
 */
export function OutcomeCard({
  turn,
  result,
  onConfirm,
  onDismiss,
  onOpenTask,
  onOpenMeeting,
}: {
  turn: MeetingTurn;
  /** Where this outcome landed, once confirmed in this session. */
  result?: OutcomeResult;
  onConfirm: () => void;
  onDismiss: () => void;
  onOpenTask: (taskId: string) => void;
  onOpenMeeting: (entryId: string) => void;
}) {
  const outcome = turn.outcome;
  if (!outcome) return null;
  return (
    <article className="meeting-outcome" data-status={outcome.status}>
      <div>
        <span className="meeting-outcome-kind">{KIND_LABEL[outcome.kind]}</span>
        <p>{turn.text}</p>
        <small>Proposed by {turn.authorName}</small>
      </div>
      {outcome.status === 'proposed' ? (
        <div className="meeting-outcome-actions">
          <button className="primary-button" onClick={onConfirm}>
            <Check size={14} />
            Confirm
          </button>
          <button className="secondary-button" onClick={onDismiss}>
            <X size={14} />
            Dismiss
          </button>
        </div>
      ) : outcome.status === 'dismissed' ? (
        <span className="meeting-outcome-state">Dismissed</span>
      ) : result?.taskId ? (
        <button className="text-button" onClick={() => onOpenTask(result.taskId ?? '')}>
          Open the task
          <ArrowUpRight size={14} />
        </button>
      ) : result?.entryId ? (
        <button className="text-button" onClick={() => onOpenMeeting(result.entryId ?? '')}>
          Open the meeting
          <ArrowUpRight size={14} />
        </button>
      ) : (
        <span className="meeting-outcome-state">Confirmed</span>
      )}
    </article>
  );
}
