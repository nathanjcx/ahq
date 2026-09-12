'use client';

import { useQuery } from 'convex/react';
import { Send } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { Task } from '@/lib/contracts';
import { asId, uiApi } from '@/lib/ui-api';
import { SkeletonList } from '../shared/skeleton';
import { MessageBubble } from './message-bubble';

export function TaskConversation({
  task,
  onSend,
}: {
  task: Task;
  onSend: (taskId: string, text: string) => void;
}) {
  const messages = useQuery(uiApi.messages, { taskId: asId<'tasks'>(task.id) });
  const [text, setText] = useState('');
  function submit(event: FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    onSend(task.id, value);
    setText('');
  }
  return (
    <>
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
          <SkeletonList kind="message" rows={3} label="Loading conversation" />
        ) : (
          messages.map((message) => <MessageBubble key={message.id} message={message} />)
        )}
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
    </>
  );
}
