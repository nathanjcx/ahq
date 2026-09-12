'use client';

import { Check, RotateCcw, ShieldCheck, Wrench } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ActionProposal } from '@/lib/contracts';
import { providerName, relativeTime } from '../shared/format';
import { JsonView } from '../shared/json-view';
import { ProviderMark } from '../shared/marks';
import { StateDiff, changedFields } from '../shared/state-diff';

const CANNOT_DECIDE = 'Only the connection owner or a workspace admin can decide';

function shortId(id: string) {
  return id.slice(-6);
}

/** What the viewer can do about a write that already ran, in the words of this tool's correction level. */
function CorrectionFooter({
  proposal,
  onCorrect,
}: {
  proposal: ActionProposal;
  onCorrect: (id: string) => void;
}) {
  const button = (label: string, icon: ReactNode) => (
    <button
      className="secondary-button compact"
      disabled={!proposal.canDecide}
      title={proposal.canDecide ? undefined : CANNOT_DECIDE}
      onClick={() => onCorrect(proposal.id)}
    >
      {icon}
      {label}
    </button>
  );

  if (proposal.correction === 'supported') {
    const fields = changedFields(proposal.beforeState, proposal.afterState);
    return (
      <>
        <p className="correction-note">
          <RotateCcw size={14} />
          <span>
            Restores {fields.length ? fields.join(', ') : 'the changed fields'} to their captured values,
            conditioned on the current version. Downstream effects such as notifications remain.
          </span>
        </p>
        <div className="proposal-actions">{button('Undo this change', <RotateCcw size={14} />)}</div>
      </>
    );
  }
  if (proposal.correction === 'partial' || proposal.correction === 'manual') {
    return (
      <>
        <p className="correction-note">
          <Wrench size={14} />
          <span>{proposal.correctionReason}</span>
        </p>
        <div className="proposal-actions">{button('Prepare correction task', <Wrench size={14} />)}</div>
      </>
    );
  }
  return (
    <p className="correction-note">
      <ShieldCheck size={14} />
      <span>
        {proposal.correctionReason} Handle this directly in {providerName(proposal.provider)}.
      </span>
    </p>
  );
}

export function ProposalCard({
  proposal,
  correctedById,
  onDecide,
  onCorrect,
}: {
  proposal: ActionProposal;
  /** The proposal that corrects this one, when one exists. */
  correctedById?: string;
  onDecide: (id: string, approved: boolean) => void;
  onCorrect: (id: string) => void;
}) {
  return (
    <div className="proposal-card" id={`proposal-${proposal.id}`}>
      <div className="proposal-head">
        <span className="proposal-icon">
          <ShieldCheck size={18} />
        </span>
        <div>
          <span className="eyebrow">ACTION REVIEW · {providerName(proposal.provider).toUpperCase()}</span>
          <h3>{proposal.summary}</h3>
          <p className="proposal-meta">
            <ProviderMark provider={proposal.provider} small />
            <code>{proposal.tool}</code>
            <span>
              {proposal.employeeName} · {relativeTime(proposal.createdAt)}
            </span>
          </p>
        </div>
        <span className={`proposal-status proposal-${proposal.status}`}>
          {proposal.status.replace('_', ' ')}
        </span>
      </div>
      {proposal.approvedByName && proposal.approvedAt && (
        <p className="proposal-decision">
          Approved by {proposal.approvedByName} {relativeTime(proposal.approvedAt)}
        </p>
      )}
      <div className="proposal-body">
        <JsonView label="Arguments" value={proposal.arguments} />
        {proposal.beforeState !== undefined && (
          <StateDiff before={proposal.beforeState} after={proposal.afterState} />
        )}
        {proposal.originalActionId && (
          <p className="proposal-link">
            Corrects proposal{' '}
            <a href={`#proposal-${proposal.originalActionId}`}>{shortId(proposal.originalActionId)}</a>
          </p>
        )}
      </div>
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
      ) : proposal.status === 'succeeded' ? (
        <CorrectionFooter proposal={proposal} onCorrect={onCorrect} />
      ) : proposal.status === 'corrected' ? (
        <p className="correction-note">
          <RotateCcw size={14} />
          <span>
            {correctedById ? (
              <>
                Corrected by proposal <a href={`#proposal-${correctedById}`}>{shortId(correctedById)}</a>.
              </>
            ) : (
              'Corrected by a later proposal.'
            )}
          </span>
        </p>
      ) : proposal.status === 'uncertain' ? (
        <p className="correction-note">
          <ShieldCheck size={14} />
          <span>
            The outcome of this write is unknown. Check {providerName(proposal.provider)} for what actually
            happened before retrying, then correct or repeat the action deliberately.
          </span>
        </p>
      ) : proposal.status === 'failed' && proposal.result ? (
        <p className="correction-note">
          <ShieldCheck size={14} />
          <span>{proposal.result}</span>
        </p>
      ) : null}
    </div>
  );
}
