'use client';

import { useQuery } from 'convex/react';
import { ArrowUpRight, LoaderCircle, MessagesSquare, Send, UserPlus, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import type { Employee, ProjectPost } from '@/lib/contracts';
import { asId, uiApi } from '@/lib/ui-api';
import { EmptyPane } from '../shared/empty';
import { relativeTime, safeHttpsUrl } from '../shared/format';

export type FloorBoardProps = {
  /** Board posts oldest first, or undefined while the subscription loads. */
  posts: ProjectPost[] | undefined;
  /** Employees staffed on this floor, the only valid handoff targets. */
  staff: Employee[];
  /** Whether this viewer can post and decide handoffs on this floor. */
  canPost: boolean;
  onTask: (taskId: string) => void;
  onPost: (text: string) => void;
  onRequestHandoff: (toEmployeeId: string, brief: string) => void;
  onDecideHandoff: (postId: string, accepted: boolean) => void;
};

/** Subscribes to the floor board. Only mount this where a Convex client exists. */
export function LiveFloorBoard({
  projectId,
  ...props
}: { projectId: string } & Omit<FloorBoardProps, 'posts'>) {
  const posts = useQuery(uiApi.projectBoard, { projectId: asId<'projects'>(projectId) });
  return <FloorBoard posts={posts} {...props} />;
}

export function FloorBoard({
  posts,
  staff,
  canPost,
  onTask,
  onPost,
  onRequestHandoff,
  onDecideHandoff,
}: FloorBoardProps) {
  const [text, setText] = useState('');
  const [handoffOpen, setHandoffOpen] = useState(false);
  const streamRef = useRef<HTMLDivElement>(null);
  const postCount = posts?.length ?? 0;

  useEffect(() => {
    const stream = streamRef.current;
    if (stream) stream.scrollTop = stream.scrollHeight;
  }, [postCount]);

  function post() {
    const value = text.trim();
    if (!value || !canPost) return;
    onPost(value);
    setText('');
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    post();
  }

  return (
    <>
      <div className="board-stream" ref={streamRef}>
        {posts === undefined ? (
          <div className="messages-loading">
            <LoaderCircle size={17} className="spin" /> Loading the board
          </div>
        ) : postCount === 0 ? (
          <EmptyPane
            icon={<MessagesSquare size={19} />}
            title="Nothing on the board yet"
            text="Post notes your team should share, watch task updates arrive, and hand work from one employee to another."
          />
        ) : (
          posts.map((post) =>
            post.kind === 'handoff' && post.handoff ? (
              <HandoffPost
                key={post.id}
                post={post}
                handoff={post.handoff}
                canDecide={canPost}
                onTask={onTask}
                onDecide={onDecideHandoff}
              />
            ) : post.kind === 'system' ? (
              <SystemPost key={post.id} post={post} onTask={onTask} />
            ) : (
              <NotePost key={post.id} post={post} />
            ),
          )
        )}
      </div>

      {handoffOpen && (
        <HandoffForm
          staff={staff}
          onClose={() => setHandoffOpen(false)}
          onSubmit={(toEmployeeId, brief) => {
            onRequestHandoff(toEmployeeId, brief);
            setHandoffOpen(false);
          }}
        />
      )}

      <div className="composer board-composer">
        <textarea
          aria-label="Post to the floor board"
          placeholder={canPost ? 'Share an update with this floor…' : 'This floor is read only.'}
          value={text}
          disabled={!canPost}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onComposerKeyDown}
        />
        <div>
          <button
            className="text-button"
            type="button"
            disabled={!canPost || !staff.length}
            onClick={() => setHandoffOpen((open) => !open)}
          >
            <UserPlus size={14} /> Request handoff
          </button>
          <span>Enter to post · Shift + Enter for a new line</span>
          <button
            className="send-button"
            type="button"
            aria-label="Post to board"
            disabled={!canPost || !text.trim()}
            onClick={post}
          >
            <Send size={15} />
          </button>
        </div>
      </div>
    </>
  );
}

function NotePost({ post }: { post: ProjectPost }) {
  return (
    <article className="board-post">
      <header>
        <strong>{post.authorName}</strong>
        <small>{relativeTime(post.createdAt)}</small>
      </header>
      <PostText text={post.text} />
    </article>
  );
}

function SystemPost({ post, onTask }: { post: ProjectPost; onTask: (taskId: string) => void }) {
  const taskId = post.taskId;
  return (
    <p className="board-system">
      <i />
      <span>
        {post.authorName} · {post.text}
      </span>
      {taskId && (
        <button className="text-button" onClick={() => onTask(taskId)}>
          Open task <ArrowUpRight size={13} />
        </button>
      )}
      <small>{relativeTime(post.createdAt)}</small>
    </p>
  );
}

function HandoffPost({
  post,
  handoff,
  canDecide,
  onTask,
  onDecide,
}: {
  post: ProjectPost;
  handoff: NonNullable<ProjectPost['handoff']>;
  canDecide: boolean;
  onTask: (taskId: string) => void;
  onDecide: (postId: string, accepted: boolean) => void;
}) {
  const acceptedTaskId = handoff.status === 'accepted' ? handoff.taskId : undefined;
  return (
    <article className="board-handoff" data-status={handoff.status}>
      <header>
        <span className="eyebrow">HANDOFF REQUEST</span>
        <span className="handoff-pill" data-status={handoff.status}>
          {handoff.status}
        </span>
        <small>{relativeTime(post.createdAt)}</small>
      </header>
      <p>
        <strong>{post.authorName}</strong> asks <strong>{handoff.toEmployeeName}</strong> to: {handoff.brief}
      </p>
      {handoff.status === 'pending' ? (
        <div className="handoff-actions">
          <button
            className="primary-button compact"
            disabled={!canDecide}
            onClick={() => onDecide(post.id, true)}
          >
            Accept
          </button>
          <button
            className="secondary-button compact"
            disabled={!canDecide}
            onClick={() => onDecide(post.id, false)}
          >
            Decline
          </button>
        </div>
      ) : (
        acceptedTaskId && (
          <div className="handoff-actions">
            <button className="text-button" onClick={() => onTask(acceptedTaskId)}>
              Open the task <ArrowUpRight size={13} />
            </button>
          </div>
        )
      )}
    </article>
  );
}

function HandoffForm({
  staff,
  onClose,
  onSubmit,
}: {
  staff: Employee[];
  onClose: () => void;
  onSubmit: (toEmployeeId: string, brief: string) => void;
}) {
  const [toEmployeeId, setToEmployeeId] = useState(staff[0]?.id ?? '');
  const [brief, setBrief] = useState('');

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = brief.trim();
    if (!toEmployeeId || !value) return;
    onSubmit(toEmployeeId, value);
  }

  return (
    <form className="handoff-form" onSubmit={submit}>
      <header>
        <strong>Request a handoff</strong>
        <button className="icon-button" type="button" aria-label="Close handoff request" onClick={onClose}>
          <X size={15} />
        </button>
      </header>
      <label>
        Employee
        <select value={toEmployeeId} onChange={(event) => setToEmployeeId(event.target.value)} required>
          {staff.map((employee) => (
            <option key={employee.id} value={employee.id}>
              {employee.name} · {employee.role}
            </option>
          ))}
        </select>
      </label>
      <label>
        What should they pick up?
        <textarea
          value={brief}
          maxLength={5000}
          placeholder="Draft the follow-up summary for the client thread."
          onChange={(event) => setBrief(event.target.value)}
          required
        />
      </label>
      <button className="primary-button compact" disabled={!toEmployeeId || !brief.trim()}>
        Post the request
      </button>
    </form>
  );
}

const LINK = /\[([^\]\n]{1,160})\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s)]+)/g;

/** Markdown-lite: paragraphs and links, nothing else. */
function PostText({ text }: { text: string }) {
  const paragraphs = text.split(/\n{2,}/).filter((paragraph) => paragraph.trim());
  return (
    <div className="post-text">
      {paragraphs.map((paragraph, index) => (
        <p key={index}>{withLinks(paragraph)}</p>
      ))}
    </div>
  );
}

function withLinks(paragraph: string) {
  const nodes: ReactNode[] = [];
  let plainFrom = 0;
  for (const match of paragraph.matchAll(LINK)) {
    const href = safeHttpsUrl(match[2] ?? match[3]);
    if (!href) continue;
    if (match.index > plainFrom) nodes.push(paragraph.slice(plainFrom, match.index));
    nodes.push(
      <a key={match.index} href={href} target="_blank" rel="noreferrer">
        {match[1] ?? href}
      </a>,
    );
    plainFrom = match.index + match[0].length;
  }
  nodes.push(paragraph.slice(plainFrom));
  return nodes;
}
