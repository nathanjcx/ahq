'use client';

import { Archive, Check, History } from 'lucide-react';
import { useState } from 'react';
import { EmptyMini } from '../shared/empty';
import { relativeTime, shortDate } from '../shared/time';
import type { Memory, MemoryAuthor, MemoryKind, MemoryStatus } from '@/lib/contracts';

export const kindLabels: Record<MemoryKind, string> = {
  fact: 'Fact',
  decision: 'Decision',
  preference: 'Preference',
  procedure: 'Procedure',
  glossary: 'Glossary',
  status: 'Status',
};

const statusLabels: Record<MemoryStatus, string> = {
  proposed: 'Proposed',
  active: 'Active',
  contested: 'Contested',
  archived: 'Archived',
};

const authorLabels: Record<MemoryAuthor, string> = {
  agent: 'filed by an employee',
  person: 'filed by a person',
  janitor: 'filed by the janitor',
};

/** Claims this one replaced, newest first: the archived entry points at whatever superseded it. */
export function chainFor(claim: Memory, claims: Memory[]) {
  const chain: Memory[] = [];
  let current = claim;
  for (let depth = 0; depth < 10; depth += 1) {
    const previous = claims.find((entry) => entry.supersedesId === current.id);
    if (!previous) break;
    chain.push(previous);
    current = previous;
  }
  return chain;
}

function ClaimCard({
  claim,
  claims,
  canDecide,
  lockedReason,
  onApprove,
  onArchive,
}: {
  claim: Memory;
  claims: Memory[];
  canDecide: boolean;
  lockedReason: string;
  onApprove: (id: string) => void;
  onArchive: (id: string) => void;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const chain = chainFor(claim, claims);
  return (
    <article className="claim" data-status={claim.status}>
      <div className="claim-head">
        <span className="claim-kind">{kindLabels[claim.kind]}</span>
        <span className="claim-status">{statusLabels[claim.status]}</span>
        <span className="claim-confidence">{Math.round(claim.confidence * 100)}% sure</span>
      </div>
      <p>{claim.text}</p>
      <div className="claim-meta">
        <span>
          {claim.authorName} · {authorLabels[claim.author]}
        </span>
        <span>{relativeTime(claim.createdAt)}</span>
        {claim.expiresAt !== undefined && <span>Expires {shortDate(claim.expiresAt)}</span>}
        {claim.tags.map((tag) => (
          <span key={tag} className="claim-tag">
            {tag}
          </span>
        ))}
      </div>
      <div className="claim-actions">
        {claim.status === 'proposed' && (
          <button
            className="text-button"
            disabled={!canDecide}
            title={canDecide ? undefined : lockedReason}
            onClick={() => onApprove(claim.id)}
          >
            <Check size={14} /> Approve
          </button>
        )}
        {claim.status !== 'archived' && (
          <button
            className="text-button"
            disabled={!canDecide}
            title={canDecide ? undefined : lockedReason}
            onClick={() => onArchive(claim.id)}
          >
            <Archive size={14} /> Archive
          </button>
        )}
        {chain.length > 0 && (
          <button
            className="text-button"
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen((open) => !open)}
          >
            <History size={14} /> {historyOpen ? 'Hide history' : `History · ${chain.length}`}
          </button>
        )}
      </div>
      {historyOpen && (
        <ol className="claim-chain">
          {chain.map((previous) => (
            <li key={previous.id}>
              <span>{kindLabels[previous.kind]}</span>
              <p>{previous.text}</p>
              <small>
                Replaced · {previous.authorName} · {relativeTime(previous.createdAt)}
              </small>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

/** Every claim filed against one scope, whatever its status, newest first. */
export function ClaimList({
  claims,
  related,
  canDecide,
  lockedReason,
  onApprove,
  onArchive,
}: {
  claims: Memory[];
  /** Every claim of the scope, including those shown elsewhere, so a chain can be walked. */
  related: Memory[];
  canDecide: boolean;
  lockedReason: string;
  onApprove: (id: string) => void;
  onArchive: (id: string) => void;
}) {
  if (!claims.length)
    return (
      <EmptyMini
        icon={<Archive size={18} />}
        title="Nothing on the shelf yet"
        text="Claims filed against this scope appear here as employees work and the janitor curates."
      />
    );
  return (
    <div className="claim-list">
      {claims.map((claim) => (
        <ClaimCard
          key={claim.id}
          claim={claim}
          claims={related}
          canDecide={canDecide}
          lockedReason={lockedReason}
          onApprove={onApprove}
          onArchive={onArchive}
        />
      ))}
    </div>
  );
}
