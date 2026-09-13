'use client';

import { BadgeCheck, Bot, Eye, FileText, LockKeyhole, Plus, Store } from 'lucide-react';
import { useState } from 'react';
import { EmptyMini } from '../shared/empty';
import { modelName } from '../shared/format';
import { PageIntro } from '../shared/page-intro';
import { relativeTime } from '../shared/time';
import type { DraftInput } from './draft-input';
import { draftPublishIssues, type EditorDraft } from './draft-issues';
import { EmployeeEditor } from './employee-editor';
import { MarketplaceStudioPreview } from './marketplace-studio-preview';
import { groupRegistryTools } from './registry';
import type { Listing, RegistryTool } from '@/lib/contracts';
import { pluralize } from '@/lib/text';
import './admin.css';

export function MarketplaceStudioPage({
  drafts,
  listings,
  registryTools,
  onSave,
  onPublish,
  onRetire,
}: {
  drafts: EditorDraft[];
  listings: Listing[];
  registryTools: RegistryTool[];
  onSave: (draft: DraftInput) => Promise<boolean>;
  onPublish: (id: string) => void;
  onRetire: (id: string) => void;
}) {
  const [editing, setEditing] = useState<EditorDraft | 'new' | null>(null);
  const [previewing, setPreviewing] = useState<EditorDraft | null>(null);
  const registry = groupRegistryTools(registryTools);
  return (
    <div>
      <PageIntro
        title="Marketplace studio"
        description="Write employee definitions and publish versions to the marketplace."
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
          <h2>Drafts</h2>
        </div>
        {drafts.length ? (
          <div className="card data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Draft</th>
                  <th>Model</th>
                  <th>Updated</th>
                  <th>Ready</th>
                  <th aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                {drafts.map((draft) => {
                  const issues = draftPublishIssues(draft, registry);
                  return (
                    <tr key={draft.id} className="row-link" onClick={() => setEditing(draft)}>
                      <td>
                        <span className="who">
                          <span className="draft-avatar" style={{ background: draft.color }}>
                            <Bot size={14} />
                          </span>
                          <span>
                            <b>{draft.name || 'Untitled employee'}</b>
                            <small>{draft.role || 'Role not set'}</small>
                          </span>
                        </span>
                      </td>
                      <td className="dim">{modelName(draft.model)}</td>
                      <td className="dim">{relativeTime(draft.updatedAt)}</td>
                      <td>
                        <span
                          className="work-status"
                          data-tone={issues.length ? 'need' : 'run'}
                          title={issues.join(' ')}
                        >
                          <i />
                          {issues.length ? pluralize(issues.length, 'issue') : 'Ready to publish'}
                        </span>
                      </td>
                      <td className="chev table-actions" onClick={(event) => event.stopPropagation()}>
                        <button className="secondary-button compact" onClick={() => setPreviewing(draft)}>
                          <Eye size={14} />
                          Preview
                        </button>
                        <button
                          className="primary-button compact"
                          disabled={issues.length > 0}
                          onClick={() => onPublish(draft.id)}
                        >
                          <BadgeCheck size={14} />
                          Publish
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
          <h2>Published</h2>
        </div>
        {listings.length ? (
          <div className="card data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Model</th>
                  <th className="num">Hires</th>
                  <th>Published</th>
                  <th aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                {listings.map((listing) => (
                  <tr key={listing.versionId}>
                    <td>
                      <span className="who">
                        <span className="draft-avatar" style={{ background: listing.color }}>
                          <Bot size={14} />
                        </span>
                        <span>
                          <b>{listing.name}</b>
                          <small>
                            {listing.role} · v{listing.currentVersion}
                          </small>
                        </span>
                      </span>
                    </td>
                    <td className="dim">{modelName(listing.model)}</td>
                    <td className="num dim">{listing.hires}</td>
                    <td className="dim">{relativeTime(listing.publishedAt)}</td>
                    <td className="chev table-actions">
                      <button
                        className="secondary-button compact danger"
                        onClick={() => onRetire(listing.versionId)}
                      >
                        Retire version
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyMini
            icon={<Store size={20} />}
            title="Nothing published"
            text="The customer marketplace stays empty until an admin publishes a reviewed draft."
          />
        )}
      </section>
      {previewing && <MarketplaceStudioPreview draft={previewing} onClose={() => setPreviewing(null)} />}
      {editing && (
        <EmployeeEditor
          draft={editing === 'new' ? undefined : editing}
          registry={registry}
          onClose={() => setEditing(null)}
          onSave={async (value) => {
            if (await onSave(value)) setEditing(null);
          }}
        />
      )}
    </div>
  );
}
