'use client';

import { ArrowUpRight, BookMarked, Check } from 'lucide-react';
import { EmptyPane } from '../shared/empty';
import { SkeletonList } from '../shared/skeleton';
import { relativeTime } from '../shared/time';
import { useUiQuery } from '../shared/use-ui-query';
import type { Memory } from '@/lib/contracts';
import { pluralize } from '@/lib/text';
import { uiApi } from '@/lib/ui-api';

const GROUPS: { status: Memory['status']; title: string; note: string }[] = [
  {
    status: 'contested',
    title: 'Contested',
    note: 'Two claims disagree. Neither reaches a model until a person settles it.',
  },
  {
    status: 'proposed',
    title: 'Waiting for approval',
    note: 'Proposed by this floor. Approving puts it into every shift on the floor.',
  },
  { status: 'active', title: 'Active', note: 'What every instance on this floor works from.' },
];

/**
 * The binder on the floor's meeting table: what this floor holds to be true. Approving is the whole
 * decision a person makes here; provenance, supersession, and the janitor's log are in Records.
 */
export function FloorBinder({
  floorId,
  canApprove,
  onApprove,
  onRecords,
}: {
  floorId: string;
  canApprove: boolean;
  onApprove: (id: string) => void;
  onRecords: () => void;
}) {
  const claims = useUiQuery(uiApi.memories, { scope: 'floor', scopeId: floorId });

  return (
    <>
      <div className="section-title">
        <div>
          <span className="eyebrow">FLOOR MEMORY</span>
          <h3>{claims ? pluralize(claims.length, 'claim') : 'The binder'}</h3>
        </div>
        <button className="text-button" onClick={onRecords}>
          Open in Records <ArrowUpRight size={13} />
        </button>
      </div>
      {claims === undefined ? (
        <SkeletonList kind="entry" rows={4} label="Loading the binder" />
      ) : claims.length === 0 ? (
        <EmptyPane
          icon={<BookMarked size={19} />}
          title="The binder is empty"
          text="What this floor learns — decisions, glossary, standing preferences — collects here once the janitor has curated it."
        />
      ) : (
        <div className="binder-groups">
          {GROUPS.map((group) => {
            const rows = claims.filter((claim) => claim.status === group.status);
            if (!rows.length) return null;
            return (
              <section key={group.status} className="binder-group" data-status={group.status}>
                <h4>
                  {group.title} <span>{rows.length}</span>
                </h4>
                <p className="binder-note">{group.note}</p>
                {rows.map((claim) => (
                  <article key={claim.id} className="binder-claim" data-status={claim.status}>
                    <p>{claim.text}</p>
                    <footer>
                      <span className="binder-kind">{claim.kind}</span>
                      <small>
                        {claim.authorName} · {relativeTime(claim.updatedAt)}
                      </small>
                      {claim.status === 'proposed' && (
                        <button
                          className="secondary-button compact"
                          disabled={!canApprove}
                          onClick={() => onApprove(claim.id)}
                        >
                          <Check size={13} /> Approve
                        </button>
                      )}
                    </footer>
                    {claim.status === 'contested' && claim.contestReason && (
                      <p className="binder-contest">{claim.contestReason}</p>
                    )}
                  </article>
                ))}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
