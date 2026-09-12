'use client';

import { BadgeCheck, Bot, FileText, LockKeyhole, Plus, Store } from 'lucide-react';
import { useState } from 'react';
import type { Listing } from '@/lib/contracts';
import type { AdminToolRegistry } from '@/lib/ui-api';
import { EmptyMini } from '../shared/empty';
import { modelName, relativeTime } from '../shared/format';
import { PageIntro } from '../shared/page-intro';
import { draftPublishIssues, type EditorDraft } from './draft-issues';
import { EmployeeEditor } from './employee-editor';

export function MarketplaceStudioPage({
  drafts,
  listings,
  toolRegistry,
  onSave,
  onPublish,
  onRetire,
}: {
  drafts: EditorDraft[];
  listings: Listing[];
  toolRegistry: AdminToolRegistry;
  onSave: (draft: Record<string, unknown>) => Promise<boolean>;
  onPublish: (id: string) => void;
  onRetire: (id: string) => void;
}) {
  const [editing, setEditing] = useState<EditorDraft | 'new' | null>(null);
  return (
    <div>
      <PageIntro
        eyebrow="PLATFORM ADMIN"
        title="Marketplace studio"
        description="Author private employee definitions and publish immutable versions for customer workspaces."
        action={
          <button className="primary-button" onClick={() => setEditing('new')}>
            <Plus size={16} />
            New employee
          </button>
        }
      />
      <div className="admin-summary">
        <span>
          <FileText size={18} />
          <strong>{drafts.length}</strong>
          <small>drafts</small>
        </span>
        <span>
          <BadgeCheck size={18} />
          <strong>{listings.length}</strong>
          <small>published versions</small>
        </span>
        <span>
          <LockKeyhole size={18} />
          <strong>Private</strong>
          <small>instructions stay server-side</small>
        </span>
      </div>
      <section className="admin-section">
        <div className="section-title">
          <div>
            <span className="eyebrow">WORK IN PROGRESS</span>
            <h2>Drafts</h2>
          </div>
        </div>
        {drafts.length ? (
          <div className="admin-list">
            {drafts.map((draft) => {
              const issues = draftPublishIssues(draft, toolRegistry);
              return (
                <article className="card" key={draft.id}>
                  <span className="draft-avatar" style={{ background: draft.color }}>
                    <Bot size={18} />
                  </span>
                  <div>
                    <h3>{draft.name || 'Untitled employee'}</h3>
                    <p>
                      {draft.role || 'Role not set'} · Updated {relativeTime(draft.updatedAt)}
                    </p>
                  </div>
                  <span className="model-pill">{modelName(draft.model)}</span>
                  <button className="secondary-button" onClick={() => setEditing(draft)}>
                    Edit
                  </button>
                  <button
                    className="primary-button"
                    disabled={issues.length > 0}
                    title={issues.join(' ')}
                    onClick={() => onPublish(draft.id)}
                  >
                    <BadgeCheck size={15} />
                    {issues.length ? 'Not ready' : 'Publish'}
                  </button>
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyMini
            icon={<FileText size={20} />}
            title="No drafts"
            text="Create an employee definition to start the review and publishing process."
          />
        )}
      </section>
      <section className="admin-section">
        <div className="section-title">
          <div>
            <span className="eyebrow">CUSTOMER CATALOG</span>
            <h2>Published</h2>
          </div>
        </div>
        {listings.length ? (
          <div className="admin-list">
            {listings.map((listing) => (
              <article className="card" key={listing.versionId}>
                <span className="draft-avatar" style={{ background: listing.color }}>
                  <Bot size={18} />
                </span>
                <div>
                  <h3>{listing.name}</h3>
                  <p>
                    {listing.role} · Published {relativeTime(listing.publishedAt)}
                  </p>
                </div>
                <span className="model-pill">{modelName(listing.model)}</span>
                <button className="secondary-button danger" onClick={() => onRetire(listing.versionId)}>
                  Retire version
                </button>
              </article>
            ))}
          </div>
        ) : (
          <EmptyMini
            icon={<Store size={20} />}
            title="Nothing published"
            text="The customer marketplace stays empty until an admin publishes a reviewed draft."
          />
        )}
      </section>
      {editing && (
        <EmployeeEditor
          draft={editing === 'new' ? undefined : editing}
          toolRegistry={toolRegistry}
          onClose={() => setEditing(null)}
          onSave={async (value) => {
            if (await onSave(value)) setEditing(null);
          }}
        />
      )}
    </div>
  );
}
