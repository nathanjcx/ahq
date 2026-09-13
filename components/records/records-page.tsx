'use client';

import { Archive, Gauge, Notebook } from 'lucide-react';
import { useState } from 'react';
import type { PageProps } from '../app/page-props';
import { EmptyPane } from '../shared/empty';
import { MasterDetail, useMasterDetail } from '../shared/master-detail';
import { scopeBudget, tokenEstimate } from '../shared/memory';
import { PageIntro } from '../shared/page-intro';
import { useUiQuery } from '../shared/use-ui-query';
import { BudgetsSheet } from './budgets-sheet';
import { ClaimComposer } from './claim-composer';
import { ClaimList } from './claim-list';
import { ContestedPairs, contestedPairs } from './contested-pairs';
import { JanitorLog } from './janitor-log';
import { RecordsBasement } from './records-basement';
import { TaskDossier } from './task-dossier';
import { defaultWorkspaceSettings, type Memory, type MemoryScope } from '@/lib/contracts';
import { pluralize } from '@/lib/text';
import { asId, uiApi } from '@/lib/ui-api';
import './records.css';

const tabs: { scope: MemoryScope; label: string }[] = [
  { scope: 'workspace', label: 'Workspace' },
  { scope: 'project', label: 'Projects' },
  { scope: 'floor', label: 'Floors' },
  { scope: 'agent', label: 'Notebooks' },
  { scope: 'task', label: 'Task summaries' },
];

/** The scopes the server can summarise in one query; the rest are counted from their own claims. */
function isSummaryScope(scope: MemoryScope): scope is 'workspace' | 'project' | 'floor' {
  return scope === 'workspace' || scope === 'project' || scope === 'floor';
}

type Target = { id: string; name: string; note: string };

/** Counts and fill for one shelf, read off the claims the viewer can see. */
function ShelfMeter({ claims, budget }: { claims: Memory[]; budget: number }) {
  const count = (status: Memory['status']) => claims.filter((claim) => claim.status === status).length;
  const tokens = claims
    .filter((claim) => claim.status === 'active')
    .reduce((total, claim) => total + tokenEstimate(claim.text), 0);
  const fill = budget ? Math.min(100, Math.round((tokens / budget) * 100)) : 0;
  return (
    <div className="shelf-meter">
      <div className="shelf-counts">
        <span>
          <strong>{count('active')}</strong> active
        </span>
        <span>
          <strong>{count('proposed')}</strong> proposed
        </span>
        <span data-alert={count('contested') > 0}>
          <strong>{count('contested')}</strong> contested
        </span>
        <span>
          <strong>{count('archived')}</strong> archived
        </span>
      </div>
      {budget > 0 ? (
        <div className="shelf-fill">
          <div className="shelf-bar" data-over={tokens > budget}>
            <i style={{ width: `${fill}%` }} />
          </div>
          <small>
            {tokens.toLocaleString()} of {budget.toLocaleString()} tokens
            {tokens > budget ? ' · over budget, the compiler will drop the oldest' : ''}
          </small>
        </div>
      ) : (
        <small className="shelf-unbudgeted">Task claims live with their task and are not budgeted.</small>
      )}
    </div>
  );
}

export function RecordsPage({ dashboard, actions, canManageWorkspace, run, onSelectTask, go }: PageProps) {
  const [scope, setScope] = useState<MemoryScope>('workspace');
  const [chosen, setChosen] = useState<Partial<Record<MemoryScope, string>>>({});
  const [budgetsOpen, setBudgetsOpen] = useState(false);
  const { open, openDetail, closeDetail } = useMasterDetail();

  const summaries = useUiQuery(uiApi.memorySummaries, isSummaryScope(scope) ? { scope } : 'skip') ?? [];
  const settings = useUiQuery(uiApi.workspaceSettings, {});
  const budgets = settings?.memoryBudgets ?? defaultWorkspaceSettings.memoryBudgets;
  const janitorEntries = useUiQuery(uiApi.janitorLog, {}) ?? [];

  const targets: Target[] = isSummaryScope(scope)
    ? summaries.map((summary) => ({
        id: summary.scopeId,
        name: summary.name,
        note: `${summary.active} active · ${summary.proposed} proposed${
          summary.contested ? ` · ${summary.contested} contested` : ''
        }`,
      }))
    : scope === 'agent'
      ? dashboard.employees.map((employee) => ({
          id: employee.id,
          name: employee.name,
          note: employee.role,
        }))
      : dashboard.tasks.map((task) => ({
          id: task.id,
          name: task.title,
          note: `${task.employeeName} · ${task.status.replace('_', ' ')}`,
        }));

  const target = targets.find((entry) => entry.id === chosen[scope]) ?? targets[0];
  const selectedId = target?.id;

  const claims: Memory[] =
    useUiQuery(uiApi.memories, selectedId ? { scope, scopeId: selectedId } : 'skip') ?? [];
  const dossier = useUiQuery(
    uiApi.taskSummary,
    scope === 'task' && selectedId ? { taskId: asId<'tasks'>(selectedId) } : 'skip',
  );

  const adminOnly = scope === 'workspace';
  const canDecide = !adminOnly || canManageWorkspace;
  const lockedReason = 'Workspace claims are the tower’s standing orders. An administrator decides them.';

  return (
    <div>
      <PageIntro
        eyebrow="MEMORY"
        title="Records"
        description="The basement: every claim the workspace works from, who filed it, what it replaced, and what is still in dispute."
        action={
          <button
            className="secondary-button"
            disabled={!canManageWorkspace}
            title={canManageWorkspace ? undefined : 'An administrator sets the memory budgets.'}
            onClick={() => setBudgetsOpen(true)}
          >
            <Gauge size={16} />
            Budgets
          </button>
        }
      />

      <RecordsBasement employees={dashboard.employees} tasks={dashboard.tasks} />

      <div className="segmented records-scopes" role="tablist" aria-label="Memory scopes">
        {tabs.map((tab) => (
          <button
            key={tab.scope}
            role="tab"
            aria-selected={scope === tab.scope}
            data-active={scope === tab.scope}
            onClick={() => setScope(tab.scope)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <MasterDetail
        className="records-layout card"
        open={open}
        backLabel="Shelves"
        onBack={closeDetail}
        list={
          <div className="shelf-list">
            <div className="pane-toolbar">
              <strong>{pluralize(targets.length, 'shelf', 'shelves')}</strong>
            </div>
            {targets.map((entry) => (
              <button
                key={entry.id}
                data-active={entry.id === selectedId}
                onClick={() => {
                  setChosen({ ...chosen, [scope]: entry.id });
                  openDetail();
                }}
              >
                <strong>{entry.name}</strong>
                <small>{entry.note}</small>
              </button>
            ))}
            {!targets.length && (
              <EmptyPane
                icon={<Notebook size={22} />}
                title="No shelves in this scope"
                text="Create a project, a floor, or a task and its records appear here."
              />
            )}
          </div>
        }
        detail={
          target ? (
            <div className="shelf-detail">
              <div className="shelf-head">
                <span className="eyebrow">{tabs.find((tab) => tab.scope === scope)?.label}</span>
                <h2>{target.name}</h2>
              </div>
              <ShelfMeter claims={claims} budget={scopeBudget(budgets, scope)} />
              <ContestedPairs
                pairs={contestedPairs(claims)}
                canDecide={canDecide}
                lockedReason={lockedReason}
                onResolve={(memoryId, keep) =>
                  void run(
                    () => actions.resolveMemoryContest(memoryId, keep),
                    keep === 'neither' ? 'Both claims archived' : 'Conflict settled',
                  )
                }
              />
              {scope === 'task' && (
                <TaskDossier
                  summary={dossier ?? null}
                  artifacts={dashboard.artifacts}
                  onOpenTask={() => {
                    onSelectTask(target.id);
                    go('tasks');
                  }}
                />
              )}
              <ClaimList
                claims={claims.filter((claim) => claim.status !== 'contested')}
                related={claims}
                canDecide={canDecide}
                lockedReason={lockedReason}
                onApprove={(id) => void run(() => actions.approveMemory(id), 'Claim approved')}
                onArchive={(id) => void run(() => actions.archiveMemory(id), 'Claim archived')}
              />
              <ClaimComposer
                scope={scope}
                scopeId={target.id}
                scopeName={target.name}
                disabled={!canDecide}
                disabledReason={lockedReason}
                onPropose={(draft) => run(() => actions.proposeMemory(draft), 'Claim filed')}
              />
            </div>
          ) : (
            <EmptyPane
              icon={<Archive size={24} />}
              title="Choose a shelf"
              text="Its claims, conflicts, and history appear here."
            />
          )
        }
      />

      <JanitorLog entries={janitorEntries} />

      {budgetsOpen && (
        <BudgetsSheet
          budgets={budgets}
          onClose={() => setBudgetsOpen(false)}
          onSave={(next) => run(() => actions.setMemoryBudgets(next), 'Memory budgets saved')}
        />
      )}
    </div>
  );
}
