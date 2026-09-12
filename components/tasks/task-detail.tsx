'use client';

import { ShieldCheck, Square } from 'lucide-react';
import { useState } from 'react';
import type { ActionProposal, Task } from '@/lib/contracts';
import { EmptyPane } from '../shared/empty';
import { statusLabel } from '../shared/format';
import { StatusMark } from '../shared/marks';
import { ProposalCard } from './proposal-card';
import { TaskConversation } from './task-conversation';

/** Tabs over one task. The audit workstream adds { id: 'audit', label: 'Audit' } here. */
const TABS = [
  { id: 'conversation', label: 'Conversation' },
  { id: 'actions', label: 'Actions' },
] as const;
type TaskTab = (typeof TABS)[number]['id'];

export function TaskDetail({
  task,
  floorName,
  proposals,
  onSend,
  onCancel,
  onDecide,
  onCorrect,
}: {
  task: Task;
  floorName: string;
  proposals: ActionProposal[];
  onSend: (taskId: string, text: string) => void;
  onCancel: (taskId: string) => void;
  onDecide: (id: string, approved: boolean) => void;
  onCorrect: (id: string) => void;
}) {
  const [tab, setTab] = useState<TaskTab>('conversation');
  const pending = proposals.filter((proposal) => proposal.status === 'pending').length;
  const usage = task.usage;
  return (
    <div className="conversation">
      <div className="conversation-head">
        <div>
          <span className="eyebrow">
            {floorName} · {task.employeeName}
          </span>
          <h2>{task.title}</h2>
          {task.visibility === 'workspace' && (
            <p className="task-sharing">
              {task.isOwner ? 'Shared with the workspace' : `Shared by ${task.createdByName}`}
            </p>
          )}
        </div>
        <div>
          <span className={`task-status status-${task.status}`}>
            <StatusMark status={task.status} />
            {statusLabel(task.status)}
          </span>
          {['queued', 'running', 'awaiting_approval'].includes(task.status) && (
            <button className="icon-button" onClick={() => onCancel(task.id)} aria-label="Cancel task">
              <Square size={14} />
            </button>
          )}
        </div>
      </div>
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
            aria-selected={tab === entry.id}
            data-active={tab === entry.id}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
            {entry.id === 'actions' && pending > 0 && <span className="tab-badge">{pending}</span>}
          </button>
        ))}
      </div>
      {tab === 'conversation' ? (
        <TaskConversation task={task} onSend={onSend} />
      ) : (
        <div className="message-stream">
          {proposals.length ? (
            proposals.map((proposal) => (
              <ProposalCard key={proposal.id} proposal={proposal} onDecide={onDecide} onCorrect={onCorrect} />
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
  );
}
