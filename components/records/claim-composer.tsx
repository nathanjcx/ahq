'use client';

import { PenLine } from 'lucide-react';
import { useState } from 'react';
import type { ClaimDraft } from '../app/actions/memory';
import { kindLabels } from './claim-list';
import type { MemoryKind, MemoryScope } from '@/lib/contracts';

const kinds = Object.keys(kindLabels) as MemoryKind[];

/** One claim is one sentence, so the composer says so and holds the person to it. */
export function ClaimComposer({
  scope,
  scopeId,
  scopeName,
  disabled,
  disabledReason,
  onPropose,
}: {
  scope: MemoryScope;
  scopeId: string;
  scopeName: string;
  disabled: boolean;
  disabledReason: string;
  onPropose: (draft: ClaimDraft) => Promise<boolean>;
}) {
  const [kind, setKind] = useState<MemoryKind>('fact');
  const [text, setText] = useState('');
  const [tags, setTags] = useState('');

  return (
    <form
      className="claim-composer"
      onSubmit={async (event) => {
        event.preventDefault();
        const filed = await onPropose({
          scope,
          scopeId,
          kind,
          text: text.trim(),
          tags: tags
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean),
          confidence: 1,
        });
        if (filed) {
          setText('');
          setTags('');
        }
      }}
    >
      <div className="section-title">
        <h2>
          <PenLine size={16} /> File a claim on {scopeName}
        </h2>
      </div>
      <div className="composer-row">
        <label>
          <span className="sr-only">Kind</span>
          <select value={kind} onChange={(event) => setKind(event.target.value as MemoryKind)}>
            {kinds.map((option) => (
              <option key={option} value={option}>
                {kindLabels[option]}
              </option>
            ))}
          </select>
        </label>
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="One sentence the whole scope should work from"
          maxLength={400}
          required
        />
      </div>
      <div className="composer-row">
        <input
          value={tags}
          onChange={(event) => setTags(event.target.value)}
          placeholder="Tags, comma separated (at most five)"
        />
        <button className="primary-button compact" type="submit" disabled={disabled || !text.trim()}>
          File claim
        </button>
      </div>
      <small className="field-hint">
        {disabled
          ? disabledReason
          : 'Your claim is active immediately; an employee’s claim waits for the janitor.'}
      </small>
    </form>
  );
}
