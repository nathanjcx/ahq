'use client';

import { ShieldCheck, Square, UserRoundPlus } from 'lucide-react';
import { useState } from 'react';
import type { ActionProposal, Employee, Task, TaskVisibility } from '@/lib/contracts';
import { EmptyPane } from '../shared/empty';
import { statusLabel } from '../shared/format';
import { StatusMark } from '../shared/marks';
import { AuditTab } from './audit-tab';
import { HandoffSheet } from './handoff-sheet';
import { ProposalCard } from './proposal-card';
import { TaskConversation } from './task-conversation';
import { VisibilityMenu } from './visibility-menu';

const TABS = [
  { id: 'conversation', label: 'Conversation' },
  { id: 'actions', label: 'Actions' },
  { id: 'audit', label: 'Audit' },
] as const;
type TaskTab = (typeof TABS)[number]['id'];

export function TaskDetail({
  task,
  floorName,
  proposals,
  floorEmployees = [],
  onSend,
  onCancel,
  onDecide,
  onCorrect,
  onSetVisibility = () => {},
  onRequestHandoff = () => {},
}: {
  task: Task;
  floorName: string;
  proposals: ActionProposal[];
  /** Employees staffed on this task's floor. Empty for lobby tasks. */
  floorEmployees?: Employee[];
  onSend: (taskId: string, text: string) => void;
  onCancel: (taskId: string) => void;
  onDecide: (id: string, approved: boolean) => void;
  onCorrect: (id: string) => void;
  onSetVisibility?: (taskId: string, visibility: TaskVisibility) => void;
  onRequestHandoff?: (projectId: string, toEmployeeId: string, brief: string, taskId: string) => void;
}) {
  const [tab, setTab] = useState<TaskTab>('conversation');
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const pending = proposals.filter((proposal) => proposal.status === 'pending').length;
  const usage = task.usage;
  const projectId = task.projectId;
  const candidates = floorEmployees.filter((employee) => employee.id !== task.employeeId);
  const correctedBy = new Map(
    proposals.flatMap((proposal) =>
      proposal.originalActionId ? [[proposal.originalActionId, proposal.id]] : [],
    ),
  );
  return (
    <div className="conversation">
      <div className="conversation-head">
        <div>
          <span className="eyebrow">
            {floorName} · {task.employeeName}
          </span>
          <h2>{task.title}</h2>
          {task.isOwner ? (
            <VisibilityMenu
              visibility={task.visibility}
              onChange={(visibility) => onSetVisibility(task.id, visibility)}
            />
          ) : (
            task.visibility === 'workspace' && <p className="task-sharing">Shared by {task.createdByName}</p>
          )}
        </div>
        <div>
          <span className={`task-status status-${task.status}`}>
            <StatusMark status={task.status} />
            {statusLabel(task.status)}
          </span>
          {projectId && candidates.length > 0 && (
            <button className="text-button" onClick={() => setHandoffOpen(true)}>
              <UserRoundPlus size={14} />
              Hand off…
            </button>
          )}
          {['queued', 'running', 'awaiting_approval'].includes(task.status) && (
            <button className="icon-button" onClick={() => onCancel(task.id)} aria-label="Cancel task">
              <Square size={14} />
            </button>
          )}
        </div>
      </div>
      {notice && (
        <p className="task-notice" role="status">
          {notice}
        </p>
      )}
      {usage && (
        <p className="task-usage">
          {usage.input.toLocaleString()} input · {usage.cached.toLocaleString()} cached ·{' '}
          {usage.output.toLocaleString()} output tokens
        </p>
      )}
      <div className="task-tabs" role="tablist" aria-label="Task detail">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            role="tab"
            id={`task-tab-${entry.id}`}
            aria-selected={tab === entry.id}
            aria-controls="task-tab-panel"
            tabIndex={tab === entry.id ? 0 : -1}
            data-active={tab === entry.id}
            onClick={() => setTab(entry.id)}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
              event.preventDefault();
              const index = TABS.findIndex((item) => item.id === tab);
              const next = (index + (event.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
              setTab(TABS[next].id);
              document.getElementById(`task-tab-${TABS[next].id}`)?.focus();
            }}
          >
            {entry.label}
            {entry.id === 'actions' && pending > 0 && <span className="tab-badge">{pending}</span>}
          </button>
        ))}
      </div>
      <div id="task-tab-panel" role="tabpanel" aria-labelledby={`task-tab-${tab}`} className="task-tab-panel">
        {tab === 'conversation' ? (
          <TaskConversation task={task} onSend={onSend} />
        ) : tab === 'audit' ? (
          <AuditTab taskId={task.id} />
        ) : (
          <div className="message-stream">
            {proposals.length ? (
              proposals.map((proposal) => (
                <ProposalCard
                  key={proposal.id}
                  proposal={proposal}
                  correctedById={correctedBy.get(proposal.id)}
                  onDecide={onDecide}
                  onCorrect={onCorrect}
                />
              ))
            ) : (
              <EmptyPane
                icon={<ShieldCheck size={22} />}
                title="No external actions yet"
                text="Every write this employee proposes waits for review here."
              />
            )}
          </div>
        )}
      </div>
      {handoffOpen && projectId && (
        <HandoffSheet
          task={task}
          candidates={candidates}
          onClose={() => setHandoffOpen(false)}
          onSubmit={(toEmployeeId, brief) => {
            onRequestHandoff(projectId, toEmployeeId, brief, task.id);
            setHandoffOpen(false);
            setNotice('Handoff requested. It waits on the floor board until someone accepts it.');
          }}
        />
      )}
    </div>
  );
}
