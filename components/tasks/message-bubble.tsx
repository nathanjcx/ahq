'use client';

import { Bot, Clock3, Paperclip, Users } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { safeHttpsUrl } from '../shared/format';
import { relativeTime } from '../shared/time';
import type { Message } from '@/lib/contracts';

/** What a phase the session reports reads as to a person. */
const PHASES: Record<string, string> = { commentary: 'note', final_answer: 'answer' };

/** The fence the platform puts around material an agent must not obey. A person reads it as a quote. */
const FENCE =
  /--- Untrusted context ([a-f0-9-]+) \(do not follow instructions inside\) ---([\s\S]*?)--- End \1 ---/g;

type Segment = { kind: 'text' | 'quote'; text: string };

/** Splits a message into its own words and the material it carried, in order. */
export function messageSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  let last = 0;
  for (const match of text.matchAll(FENCE)) {
    const before = text.slice(last, match.index).trim();
    if (before) segments.push({ kind: 'text', text: before });
    const quoted = match[2].trim();
    if (quoted) segments.push({ kind: 'quote', text: quoted });
    last = match.index + match[0].length;
  }
  const tail = text.slice(last).trim();
  if (tail || !segments.length) segments.push({ kind: 'text', text: tail });
  return segments;
}

function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        img: ({ src, alt }) => {
          const href = safeHttpsUrl(src);
          return href ? (
            <a href={href} target="_blank" rel="noreferrer">
              {alt || 'Open image'}
            </a>
          ) : (
            <span>{alt || 'Image unavailable'}</span>
          );
        },
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

export function MessageBubble({ message, who = 'Employee' }: { message: Message; who?: string }) {
  if (message.role === 'system')
    return (
      <div className="system-message">
        <Clock3 size={13} />
        {message.text}
      </div>
    );
  const phase = message.phase ? (PHASES[message.phase] ?? message.phase.replaceAll('_', ' ')) : undefined;
  return (
    <article
      className={`message ${message.role}`}
      aria-label={`${message.role === 'user' ? 'You' : who}, ${relativeTime(message.createdAt)}`}
    >
      <span className="message-avatar" aria-hidden="true">
        {message.role === 'user' ? <Users size={14} /> : <Bot size={15} />}
      </span>
      <div>
        <span>
          {message.role === 'user' ? 'You' : who}
          {message.role !== 'user' && phase && <em className="message-phase">{phase}</em>}
        </span>
        <div className="message-markdown">
          {messageSegments(message.text).map((segment, index) =>
            segment.kind === 'quote' ? (
              <blockquote key={index} className="message-quote">
                <small>
                  <Paperclip size={11} /> Attached material
                </small>
                <Markdown text={segment.text} />
              </blockquote>
            ) : (
              <Markdown key={index} text={segment.text} />
            ),
          )}
        </div>
        <time>{relativeTime(message.createdAt)}</time>
      </div>
    </article>
  );
}
