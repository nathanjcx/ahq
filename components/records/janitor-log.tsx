'use client';

import { Brush } from 'lucide-react';
import { EmptyMini } from '../shared/empty';
import { relativeTime } from '../shared/time';
import type { JanitorAction, JanitorLogEntry, MemoryScope } from '@/lib/contracts';

const actionLabels: Record<JanitorAction, string> = {
  merged: 'Merged',
  promoted: 'Promoted',
  contested: 'Contested',
};

const scopeLabels: Record<MemoryScope, string> = {
  workspace: 'Workspace',
  project: 'Project',
  floor: 'Floor',
  agent: 'Notebook',
  task: 'Task',
};

/** What the janitor's curation runs changed, newest first. */
export function JanitorLog({ entries }: { entries: JanitorLogEntry[] }) {
  return (
    <section className="janitor-log card">
      <div className="section-title">
        <h2>
          <Brush size={16} /> Janitor log
        </h2>
      </div>
      {entries.length ? (
        <ol>
          {entries.map((entry) => (
            <li key={`${entry.action}-${entry.id}`}>
              <span className="janitor-action" data-action={entry.action}>
                {actionLabels[entry.action]}
              </span>
              <div>
                <p>{entry.text}</p>
                <small>
                  {scopeLabels[entry.scope]} · {entry.detail}
                </small>
              </div>
              <time>{relativeTime(entry.at)}</time>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyMini
          icon={<Brush size={18} />}
          title="The janitor has not been down here yet"
          text="Curation runs after hours, and again whenever twenty claims are waiting."
        />
      )}
    </section>
  );
}
