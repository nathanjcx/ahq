'use client';

import { useQuery } from 'convex/react';
import { LoaderCircle, Send, Square } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { ActionProposal, Task } from '@/lib/contracts';
import { uiApi } from '@/lib/ui-api';
import { statusLabel } from '../shared/format';
import { StatusMark } from '../shared/marks';
import { MessageBubble } from './message-bubble';
import { ProposalCard } from './proposal-card';

export function TaskConversation({
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
  const messages = useQuery(uiApi.messages, { taskId: task.id });
  const [text, setText] = useState('');
  function submit(event: FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    onSend(task.id, value);
    setText('');
  }
  return (
    <div className="conversation">
      <div className="conversation-head">
        <div>
          <span className="eyebrow">
            {floorName} · {task.employeeName}
          </span>
          <h2>{task.title}</h2>
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
      <div className="message-stream">
        {task.projectContext && (
          <details className="task-project-context">
            <summary>Project brief at task start</summary>
            <p>{task.projectContext.brief}</p>
          </details>
        )}
        {task.prompt &&
          !messages?.some((message) => message.role === 'user' && message.text === task.prompt) && (
            <MessageBubble
              message={{
                id: 'prompt',
                taskId: task.id,
                role: 'user',
                text: task.prompt,
                createdAt: task.createdAt,
              }}
            />
          )}
        {messages === undefined ? (
          <div className="messages-loading">
            <LoaderCircle size={17} className="spin" />
            Loading conversation
          </div>
        ) : (
          messages.map((message) => <MessageBubble key={message.id} message={message} />)
        )}
        {proposals.map((proposal) => (
          <ProposalCard key={proposal.id} proposal={proposal} onDecide={onDecide} onCorrect={onCorrect} />
        ))}
        {task.status === 'running' && (
          <div className="working-line">
            <span>
              <i />
              <i />
              <i />
            </span>
            {task.employeeName} is working
          </div>
        )}
      </div>
      <form className="composer" onSubmit={submit}>
        <textarea
          aria-label="Message employee"
          placeholder={`Message ${task.employeeName}…`}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <div>
          <span>Shift + Enter for a new line</span>
          <button className="send-button" disabled={!text.trim()} aria-label="Send message">
            <Send size={16} />
          </button>
        </div>
      </form>
    </div>
  );
}
