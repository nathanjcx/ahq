'use client';

import { Bot } from 'lucide-react';
import { useState } from 'react';
import { modelName, providerName } from '../shared/format';
import { ProviderMark } from '../shared/marks';
import { Sheet } from '../shared/sheet';
import { relativeTime } from '../shared/time';
import { useUiQuery } from '../shared/use-ui-query';
import type { EditorDraft } from './draft-issues';
import { pluralize } from '@/lib/text';
import { uiApi } from '@/lib/ui-api';

const TABS = ['Listing', 'Instructions', 'Changes'] as const;
type Tab = (typeof TABS)[number];

/** The draft as the marketplace would show it, before anyone outside this workspace can read it. */
function ListingPreview({ draft }: { draft: EditorDraft }) {
  return (
    <article className="studio-preview-card">
      <span className="draft-avatar" style={{ background: draft.color }}>
        <Bot size={20} />
      </span>
      <span className="category-pill">{draft.category || 'No category'}</span>
      <h3>{draft.name || 'Untitled employee'}</h3>
      <p className="studio-role">{draft.role || 'Role not set'}</p>
      <p className="studio-description">{draft.description || 'No description yet.'}</p>
      <div className="studio-columns">
        <section>
          <h4>Strengths</h4>
          <ul>
            {draft.strengths.length ? (
              draft.strengths.map((item) => <li key={item}>{item}</li>)
            ) : (
              <li className="muted">None listed</li>
            )}
          </ul>
        </section>
        <section>
          <h4>Limits</h4>
          <ul>
            {draft.limitations.length ? (
              draft.limitations.map((item) => <li key={item}>{item}</li>)
            ) : (
              <li className="muted">None listed</li>
            )}
          </ul>
        </section>
      </div>
      <section>
        <h4>Integration access</h4>
        {draft.capabilities.length ? (
          <div className="studio-capabilities">
            {draft.capabilities.map((capability) => (
              <span key={capability.provider}>
                <ProviderMark provider={capability.provider} small />
                {providerName(capability.provider)} · {pluralize(capability.tools.length, 'tool')}
                {capability.optional ? ' · optional' : ''}
              </span>
            ))}
          </div>
        ) : (
          <p className="muted">No integrations required</p>
        )}
      </section>
      {draft.persona && (
        <section>
          <h4>Character</h4>
          <p className="studio-description">{draft.persona.voice}</p>
          <div className="studio-traits">
            {draft.persona.traits.map((trait) => (
              <span key={trait}>{trait}</span>
            ))}
          </div>
        </section>
      )}
      <p className="studio-model">Runs on {modelName(draft.model)}</p>
    </article>
  );
}

/** The instruction block a session would receive, persona and memory placeholder included. */
function InstructionPreview({ draft }: { draft: EditorDraft }) {
  const instructions = useUiQuery(uiApi.previewInstructions, { draftId: draft.draftId });
  if (instructions === undefined) return <p className="muted">Composing…</p>;
  return <pre className="studio-instructions">{instructions}</pre>;
}

/** What publishing would change, field by field, against the version customers can hire today. */
function PublishDiff({ draft }: { draft: EditorDraft }) {
  const diff = useUiQuery(uiApi.versionDiff, { draftId: draft.draftId });
  if (diff === undefined) return <p className="muted">Comparing…</p>;
  return (
    <div className="studio-diff">
      <p className="muted">
        {diff.currentVersion
          ? `Against version ${diff.currentVersion}, published ${relativeTime(diff.publishedAt ?? 0)}.`
          : 'Nothing published yet, so every field is new.'}
      </p>
      {diff.fields.length ? (
        diff.fields.map((field) => (
          <section key={field.field}>
            <h4>{field.field}</h4>
            <div className="diff-pair">
              <pre data-side="before">{field.before || 'not set'}</pre>
              <pre data-side="after">{field.after || 'not set'}</pre>
            </div>
          </section>
        ))
      ) : (
        <p className="muted">This draft matches the published version field for field.</p>
      )}
    </div>
  );
}

/** Read a draft the way a customer and a session would, and what publishing it would change. */
export function MarketplaceStudioPreview({ draft, onClose }: { draft: EditorDraft; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('Listing');
  return (
    <Sheet
      wide
      title={draft.name || 'Untitled employee'}
      subtitle="Preview before publishing"
      onClose={onClose}
    >
      <div className="studio-tabs" role="tablist" aria-label="Draft preview">
        {TABS.map((entry) => (
          <button
            key={entry}
            role="tab"
            id={`studio-tab-${entry}`}
            aria-selected={tab === entry}
            aria-controls="studio-tab-panel"
            tabIndex={tab === entry ? 0 : -1}
            data-active={tab === entry}
            onClick={() => setTab(entry)}
          >
            {entry}
          </button>
        ))}
      </div>
      <div id="studio-tab-panel" role="tabpanel" aria-labelledby={`studio-tab-${tab}`}>
        {tab === 'Listing' && <ListingPreview draft={draft} />}
        {tab === 'Instructions' && <InstructionPreview draft={draft} />}
        {tab === 'Changes' && <PublishDiff draft={draft} />}
      </div>
    </Sheet>
  );
}
