'use client';

import { ArrowUpRight, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ActionProposal } from '@/lib/contracts';
import { Sheet } from '../shared/sheet';
import { DecideButtons, ProposalEvidence, ProposalHeading } from '../tasks/proposal-card';

/** Proposals this viewer is the one to decide. */
export function reviewable(proposals: ActionProposal[]) {
  return proposals.filter((proposal) => proposal.status === 'pending' && proposal.canDecide);
}

/**
 * The one thing a person has to do, kept in reach: a bar above the bottom of a phone screen and a
 * banner under the top bar on a desktop, opening a sheet that decides each pending action in place.
 */
export function ReviewBar({
  proposals,
  onDecide,
  onOpenTask,
}: {
  proposals: ActionProposal[];
  onDecide: (id: string, approved: boolean) => void;
  onOpenTask: (taskId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const pending = reviewable(proposals);
  // Decisions land while the sheet is open; the last one closes it.
  useEffect(() => {
    if (!pending.length) setOpen(false);
  }, [pending.length]);
  if (!pending.length) return null;
  return (
    <>
      <div className="review-bar" role="status">
        <span className="review-bar-mark" aria-hidden="true">
          <ShieldCheck size={16} />
        </span>
        <span>
          <strong>
            {pending.length} {pending.length === 1 ? 'action needs' : 'actions need'} your review
          </strong>
          <small>Nothing is written to a connected service until you approve it.</small>
        </span>
        <button className="primary-button compact" onClick={() => setOpen(true)}>
          Review
        </button>
      </div>
      {open && (
        <ReviewSheet
          proposals={pending}
          onClose={() => setOpen(false)}
          onDecide={onDecide}
          onOpenTask={(taskId) => {
            setOpen(false);
            onOpenTask(taskId);
          }}
        />
      )}
    </>
  );
}

function ReviewSheet({
  proposals,
  onClose,
  onDecide,
  onOpenTask,
}: {
  proposals: ActionProposal[];
  onClose: () => void;
  onDecide: (id: string, approved: boolean) => void;
  onOpenTask: (taskId: string) => void;
}) {
  const [chosenId, setChosenId] = useState(proposals[0].id);
  const active = proposals.find((proposal) => proposal.id === chosenId) ?? proposals[0];

  return (
    <Sheet
      title="Actions to review"
      subtitle={`${proposals.length} external ${proposals.length === 1 ? 'write is' : 'writes are'} waiting on your decision.`}
      onClose={onClose}
      footer={
        <>
          <p className="review-target">{active.summary}</p>
          <div className="review-decide">
            <DecideButtons proposal={active} onDecide={onDecide} />
          </div>
        </>
      }
    >
      <div className="review-list">
        {proposals.map((proposal) => (
          <article key={proposal.id} className="review-card" data-active={proposal.id === active.id}>
            {proposals.length > 1 ? (
              <label className="review-pick">
                <input
                  type="radio"
                  name="ahq-review-choice"
                  checked={proposal.id === active.id}
                  aria-label={`Decide: ${proposal.summary}`}
                  onChange={() => setChosenId(proposal.id)}
                />
                <ProposalHeading proposal={proposal} />
              </label>
            ) : (
              <ProposalHeading proposal={proposal} />
            )}
            <details className="review-evidence">
              <summary>Arguments and captured state</summary>
              <ProposalEvidence proposal={proposal} />
            </details>
            <button className="text-button" onClick={() => onOpenTask(proposal.taskId)}>
              Open the task <ArrowUpRight size={13} />
            </button>
          </article>
        ))}
      </div>
    </Sheet>
  );
}
