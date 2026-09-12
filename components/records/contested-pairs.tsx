'use client';

import { Scale } from 'lucide-react';
import { relativeTime } from '../shared/time';
import { kindLabels } from './claim-list';
import type { Memory } from '@/lib/contracts';

type Pair = { claim: Memory; other?: Memory };

/** One line per conflict: a contest marks both sides, so the pair is shown once. */
export function contestedPairs(claims: Memory[]): Pair[] {
  const pairs: Pair[] = [];
  const seen = new Set<string>();
  for (const claim of claims) {
    if (claim.status !== 'contested' || seen.has(claim.id)) continue;
    const other = claims.find((entry) => entry.id === claim.contestedWithId);
    seen.add(claim.id);
    if (other) seen.add(other.id);
    pairs.push({ claim, other });
  }
  return pairs;
}

function Side({ claim, label }: { claim: Memory; label: string }) {
  return (
    <div className="contested-side">
      <span className="eyebrow">{label}</span>
      <span className="claim-kind">{kindLabels[claim.kind]}</span>
      <p>{claim.text}</p>
      <small>
        {claim.authorName} · {relativeTime(claim.createdAt)}
      </small>
    </div>
  );
}

/**
 * The conflicts queue. Neither side of a contested pair reaches a model until a person decides, so
 * this sits above the shelf rather than in it.
 */
export function ContestedPairs({
  pairs,
  canDecide,
  lockedReason,
  onResolve,
}: {
  pairs: Pair[];
  canDecide: boolean;
  lockedReason: string;
  onResolve: (memoryId: string, keep: 'this' | 'other' | 'neither') => void;
}) {
  if (!pairs.length) return null;
  return (
    <section className="contested-queue">
      <div className="section-title">
        <h2>
          <Scale size={16} /> Conflicts waiting on you
        </h2>
      </div>
      <p className="contested-note">
        The janitor never settles a conflict itself. Until you decide, neither claim is compiled into
        anyone&rsquo;s working memory.
      </p>
      {pairs.map(({ claim, other }) => (
        <article key={claim.id} className="contested-pair">
          <div className="contested-sides">
            <Side claim={claim} label="THIS CLAIM" />
            {other ? (
              <Side claim={other} label="CONFLICTS WITH" />
            ) : (
              <div className="contested-side contested-missing">
                <span className="eyebrow">CONFLICTS WITH</span>
                <p>No competing claim was recorded — the janitor contested this one on its own.</p>
              </div>
            )}
          </div>
          {claim.contestReason && <p className="contested-reason">{claim.contestReason}</p>}
          <div className="contested-actions">
            <button
              className="secondary-button compact"
              disabled={!canDecide}
              title={canDecide ? undefined : lockedReason}
              onClick={() => onResolve(claim.id, 'this')}
            >
              Keep this
            </button>
            <button
              className="secondary-button compact"
              disabled={!canDecide || !other}
              title={canDecide ? undefined : lockedReason}
              onClick={() => onResolve(claim.id, 'other')}
            >
              Keep other
            </button>
            <button
              className="text-button danger-text"
              disabled={!canDecide}
              title={canDecide ? undefined : lockedReason}
              onClick={() => onResolve(claim.id, 'neither')}
            >
              Neither
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
