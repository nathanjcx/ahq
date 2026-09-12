'use client';

import { Check, RotateCcw, ShieldCheck } from 'lucide-react';
import type { ActionProposal } from '@/lib/contracts';
import { correctionLabel, providerName, safeJson } from '../shared/format';

export function ProposalCard({
  proposal,
  onDecide,
  onCorrect,
}: {
  proposal: ActionProposal;
  onDecide: (id: string, approved: boolean) => void;
  onCorrect: (id: string) => void;
}) {
  const args = safeJson(proposal.arguments);
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
        <pre>{args}</pre>
      </div>
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
      {proposal.status === 'pending' ? (
        <div className="proposal-actions">
          <button className="secondary-button danger" onClick={() => onDecide(proposal.id, false)}>
            Reject
          </button>
          <button className="primary-button" onClick={() => onDecide(proposal.id, true)}>
            <Check size={15} />
            Approve action
          </button>
        </div>
      ) : proposal.status === 'succeeded' && !['irreversible', 'unknown'].includes(proposal.correction) ? (
        <button className="text-button correction-button" onClick={() => onCorrect(proposal.id)}>
          <RotateCcw size={14} />
          Request correction
        </button>
      ) : null}
    </div>
  );
}
