'use client';

import { useQuery } from 'convex/react';
import { MessageCircleQuestion, Send, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { SkeletonList } from '../shared/skeleton';
import { MessageBubble } from './message-bubble';
import type { Task } from '@/lib/contracts';
import { asId, uiApi } from '@/lib/ui-api';

/**
 * The thread: a log that scrolls on its own and follows the newest line, and a footer that stays
 * put with whatever the person owes the employee: the question it stopped on, the actions it is
 * holding for, or simply the next message.
 */
export function TaskConversation({
  task,
  pendingActions,
  onSend,
  onReviewActions,
}: {
  task: Task;
  /** Proposals waiting for a decision, which the footer points at. */
  pendingActions: number;
  onSend: (taskId: string, text: string) => void;
  onReviewActions: () => void;
}) {
  const messages = useQuery(uiApi.messages, { taskId: asId<'tasks'>(task.id) });
  const [text, setText] = useState('');
  const log = useRef<HTMLDivElement>(null);
  const asking = task.status === 'needs_input' && task.question;
  const count = messages?.length ?? 0;

  // The log opens at its newest line and keeps following it while the employee works.
  useEffect(() => {
    const element = log.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [count, task.status, task.id]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    onSend(task.id, value);
    setText('');
  }
  return (
    <>
      <div ref={log} className="message-stream" role="log" aria-label="Conversation" tabIndex={0}>
        {task.floorContext && (
          <details className="task-floor-context">
            <summary>Floor brief at task start</summary>
            <p>{task.floorContext.brief}</p>
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
          messages.map((message) => (
            <MessageBubble key={message.id} message={message} who={task.employeeName} />
          ))
        )}
        {task.status === 'running' && (
          <div className="working-line" role="status">
            <span aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            {task.employeeName} is working
          </div>
        )}
      </div>
      <div className="thread-footer">
        {asking && (
          <section
            className="thread-ask"
            aria-label={`Question from ${task.employeeName}`}
            aria-live="polite"
          >
            <MessageCircleQuestion size={16} aria-hidden="true" />
            <div>
              <strong>{task.employeeName} needs an answer to continue</strong>
              <p>{task.question!.text}</p>
            </div>
          </section>
        )}
        {task.status === 'awaiting_approval' && pendingActions > 0 && (
          <section className="thread-ask thread-ask-review" aria-label="Actions waiting for review">
            <ShieldCheck size={16} aria-hidden="true" />
            <div>
              <strong>
                {task.employeeName} is holding{' '}
                {pendingActions === 1 ? 'an action' : `${pendingActions} actions`} until you decide
              </strong>
            </div>
            <button type="button" className="secondary-button compact" onClick={onReviewActions}>
              Review
            </button>
          </section>
        )}
        <form className="composer" onSubmit={submit}>
          <textarea
            aria-label={asking ? `Answer ${task.employeeName}` : `Message ${task.employeeName}`}
            placeholder={asking ? `Answer ${task.employeeName}…` : `Message ${task.employeeName}…`}
            value={text}
            autoFocus={Boolean(asking)}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <div>
            <span>Enter to send · Shift + Enter for a new line</span>
            <button
              className="send-button"
              disabled={!text.trim()}
              aria-label={asking ? 'Send answer' : 'Send message'}
            >
              <Send size={16} />
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
