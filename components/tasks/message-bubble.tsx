'use client';

import { Bot, Clock3, Users } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message } from '@/lib/contracts';
import { relativeTime, safeHttpsUrl } from '../shared/format';

export function MessageBubble({ message }: { message: Message }) {
  if (message.role === 'system')
    return (
      <div className="system-message">
        <Clock3 size={13} />
        {message.text}
      </div>
    );
  return (
    <div className={`message ${message.role}`}>
      <span className="message-avatar">
        {message.role === 'user' ? <Users size={14} /> : <Bot size={15} />}
      </span>
      <div>
        <span>{message.role === 'user' ? 'You' : message.phase || 'Employee'}</span>
        <div className="message-markdown">
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
            {message.text}
          </ReactMarkdown>
        </div>
        <time>{relativeTime(message.createdAt)}</time>
      </div>
    </div>
  );
}
