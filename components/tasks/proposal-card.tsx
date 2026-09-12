'use client';

import { Check, RotateCcw, ShieldCheck } from 'lucide-react';
import type { ActionProposal } from '@/lib/contracts';
import { correctionLabel, providerName, relativeTime, safeJson } from '../shared/format';

const CANNOT_DECIDE = 'Only the owner of this connection, or a workspace owner or admin, can decide it.';

export function ProposalCard({
  proposal,
  onDecide,
  onCorrect,
}: {
  proposal: ActionProposal;
  onDecide: (id: string, approved: boolean) => void;
  onCorrect: (id: string) => void;
}) {
  const correctable =
    proposal.status === 'succeeded' && !['irreversible', 'unknown'].includes(proposal.correction);
  return (
    <div className="proposal-card">
      <div className="proposal-head">
        <span className="proposal-icon">
          <ShieldCheck size={18} />
        </span>
        <div>
          <span className="eyebrow">ACTION REVIEW · {providerName(proposal.provider).toUpperCase()}</span>
          <h3>{proposal.summary}</h3>
        </div>
        <span className={`proposal-status proposal-${proposal.status}`}>
          {proposal.status.replace('_', ' ')}
        </span>
      </div>
      <div className="proposal-diff">
        <span>Proposed change</span>
        <pre>{safeJson(proposal.arguments)}</pre>
      </div>
      {proposal.beforeState && (
        <div className="proposal-diff">
          <span>Before</span>
          <pre>{safeJson(proposal.beforeState)}</pre>
        </div>
      )}
      {proposal.afterState && (
        <div className="proposal-diff">
          <span>After</span>
          <pre>{safeJson(proposal.afterState)}</pre>
        </div>
      )}
      {proposal.result && (
        <div className="proposal-diff">
          <span>Result</span>
          <pre>{safeJson(proposal.result)}</pre>
        </div>
      )}
      <p className="correction-note">
        <RotateCcw size={14} />
        <span>
          <strong>{correctionLabel(proposal.correction)}</strong> {proposal.correctionReason}
        </span>
      </p>
      {proposal.approvedByName && proposal.approvedAt && (
        <p className="proposal-decision">
          Approved by {proposal.approvedByName} · {relativeTime(proposal.approvedAt)}
        </p>
      )}
      {proposal.status === 'pending' ? (
        <div className="proposal-actions">
          {!proposal.canDecide && <p className="proposal-locked">{CANNOT_DECIDE}</p>}
          <button
            className="secondary-button danger"
            disabled={!proposal.canDecide}
            title={proposal.canDecide ? undefined : CANNOT_DECIDE}
            onClick={() => onDecide(proposal.id, false)}
          >
            Reject
          </button>
          <button
            className="primary-button"
            disabled={!proposal.canDecide}
            title={proposal.canDecide ? undefined : CANNOT_DECIDE}
            onClick={() => onDecide(proposal.id, true)}
          >
            <Check size={15} />
            Approve action
          </button>
        </div>
      ) : correctable ? (
        <>
          {!proposal.canDecide && <p className="proposal-locked">{CANNOT_DECIDE}</p>}
          <button
            className="text-button correction-button"
            disabled={!proposal.canDecide}
            title={proposal.canDecide ? undefined : CANNOT_DECIDE}
            onClick={() => onCorrect(proposal.id)}
          >
            <RotateCcw size={14} />
            Request correction
          </button>
        </>
      ) : null}
    </div>
  );
}
