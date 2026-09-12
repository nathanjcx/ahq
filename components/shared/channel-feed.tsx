'use client';

import {
  AlertTriangle,
  ArrowUpRight,
  AtSign,
  Bot,
  ClipboardList,
  MessagesSquare,
  Scale,
  Send,
  UserRound,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { ChannelsActions } from '../app/actions/channels';
import type { CoreActions } from '../app/actions/core';
import { EmptyPane } from './empty';
import { safeHttpsUrl } from './format';
import { SkeletonList } from './skeleton';
import { shortTime } from './time';
import { useUiQuery } from './use-ui-query';
import type { Post, PostKind } from '@/lib/contracts';
import { asId, uiApi } from '@/lib/ui-api';
import '../channels/channels.css';

/** How many posts a page of the feed holds, and how far back "earlier posts" will reach. */
const PAGE = 40;
const MAX_POSTS = 200;

/** An instance a post can be addressed to. Addressing one turns the note into work for it. */
export interface Mentionable {
  id: string;
  name: string;
  role: string;
}

/** What the feed needs to act: the channel mutations, plus the handoff decision a person makes. */
export type ChannelFeedActions = ChannelsActions & Pick<CoreActions, 'decideHandoff'>;

const KIND_LABEL: Record<Exclude<PostKind, 'note' | 'system'>, string> = {
  report: 'Shift report',
  feedback: 'Review',
  alert: 'Incident',
  finding: 'Finding',
  decision: 'Decision',
  handoff: 'Handoff',
};

const KIND_ICON: Partial<Record<PostKind, ReactNode>> = {
  report: <ClipboardList size={13} />,
  alert: <AlertTriangle size={13} />,
  finding: <AlertTriangle size={13} />,
  decision: <Scale size={13} />,
};

/**
 * A claim the janitor contested is written as a decision whose first line names it. Contested claims
 * never reach a model until a person settles them, so the feed has to make one impossible to miss.
 */
function isContested(post: Post) {
  return post.kind === 'decision' && post.text.startsWith('Contested:');
}

function message(failure: unknown) {
  return failure instanceof Error ? failure.message : 'That did not work. Please try again.';
}

function dayKey(at: number) {
  return new Date(at).toDateString();
}

function dayLabel(at: number) {
  const today = dayKey(Date.now());
  const yesterday = dayKey(Date.now() - 86_400_000);
  const key = dayKey(at);
  if (key === today) return 'Today';
  if (key === yesterday) return 'Yesterday';
  return new Date(at).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

/**
 * A channel's posts with a composer, rendered wherever a channel belongs: a floor board, a project
 * page, an employee's feed. Newest posts sit at the bottom, the day they were written separates
 * them, and the line where this viewer stopped reading holds its place until they leave.
 */
export function ChannelFeed({
  channelId,
  actions,
  compact = false,
  onTask,
  mentionable = [],
  canPost = true,
}: {
  channelId: string;
  actions: ChannelFeedActions;
  /** Compact rows for a side column; the default is the full feed. */
  compact?: boolean;
  onTask?: (taskId: string) => void;
  /** Instances a post may be addressed to, usually the staff of the channel's scope. */
  mentionable?: Mentionable[];
  canPost?: boolean;
}) {
  const [limit, setLimit] = useState(PAGE);
  const [error, setError] = useState<string | null>(null);
  const posts = useUiQuery(uiApi.channelPosts, { channelId: asId<'channels'>(channelId), limit });
  const channels = useUiQuery(uiApi.channels, {});
  const streamRef = useRef<HTMLDivElement>(null);
  const newestId = posts?.[posts.length - 1]?.id;

  // The unread count the channel had when this viewer arrived. It is held across renders because
  // marking the channel read is the next thing this component does, and that would otherwise erase
  // the line it is about to draw. Opening a different channel takes a fresh count.
  const [arrival, setArrival] = useState<{ channelId: string; unread: number } | null>(null);
  const unread = channels?.find((channel) => channel.id === channelId)?.unread;
  if (unread !== undefined && arrival?.channelId !== channelId) setArrival({ channelId, unread });
  const unreadFrom =
    posts && arrival?.channelId === channelId && arrival.unread ? posts.length - arrival.unread : -1;

  const { markChannelRead } = actions;
  useEffect(() => {
    if (newestId) void markChannelRead(channelId);
  }, [channelId, newestId, markChannelRead]);

  useEffect(() => {
    const stream = streamRef.current;
    if (stream) stream.scrollTop = stream.scrollHeight;
  }, [newestId]);

  const decideHandoff = (postId: string, accepted: boolean) => {
    actions
      .decideHandoff(postId, accepted)
      .then((result) => {
        setError(null);
        if (result?.taskId) onTask?.(result.taskId);
      })
      .catch((failure: unknown) => setError(message(failure)));
  };

  return (
    <div className="channel-feed" data-compact={compact}>
      <div className="channel-stream" ref={streamRef}>
        {posts === undefined ? (
          <SkeletonList kind="post" rows={3} label="Loading the channel" />
        ) : posts.length === 0 ? (
          <EmptyPane
            icon={<MessagesSquare size={19} />}
            title="Nothing posted here yet"
            text="Shift reports, findings, incidents, and handoffs land here as the work happens. Post a note to start the thread."
          />
        ) : (
          <>
            {posts.length >= limit && limit < MAX_POSTS && (
              <button
                className="channel-older"
                onClick={() => setLimit((current) => Math.min(current + PAGE, MAX_POSTS))}
              >
                Load earlier posts
              </button>
            )}
            {posts.map((post, index) => (
              <div key={post.id} className="channel-slot">
                {(index === 0 || dayKey(posts[index - 1].createdAt) !== dayKey(post.createdAt)) && (
                  <DaySeparator at={post.createdAt} />
                )}
                {index === unreadFrom && <p className="channel-unread-line">New</p>}
                <PostView
                  post={post}
                  compact={compact}
                  canDecide={canPost}
                  onTask={onTask}
                  onDecideHandoff={decideHandoff}
                />
              </div>
            ))}
          </>
        )}
      </div>
      {error && <p className="channel-error">{error}</p>}
      <Composer
        channelId={channelId}
        actions={actions}
        mentionable={mentionable}
        canPost={canPost}
        compact={compact}
        onFailure={setError}
      />
    </div>
  );
}

function DaySeparator({ at }: { at: number }) {
  return (
    <p className="channel-day">
      <span>{dayLabel(at)}</span>
    </p>
  );
}

/** One post in whichever shape its kind asks for: a line, a handoff card, or a titled note. */
export function PostView({
  post,
  compact = false,
  canDecide = false,
  onTask,
  onDecideHandoff,
}: {
  post: Post;
  compact?: boolean;
  canDecide?: boolean;
  onTask?: (taskId: string) => void;
  onDecideHandoff?: (postId: string, accepted: boolean) => void;
}) {
  const taskId = post.taskId;
  if (post.kind === 'system')
    return (
      <p className="channel-system">
        <i />
        <span>
          {post.authorName} · {post.text}
        </span>
        {taskId && onTask && (
          <button className="text-button" onClick={() => onTask(taskId)}>
            Open task <ArrowUpRight size={13} />
          </button>
        )}
        <small>{shortTime(post.createdAt)}</small>
      </p>
    );

  if (post.kind === 'handoff' && post.handoff)
    return <HandoffPost post={post} canDecide={canDecide} onTask={onTask} onDecide={onDecideHandoff} />;

  const contested = isContested(post);
  return (
    <article className="channel-post" data-kind={post.kind} data-contested={contested}>
      <header>
        <AuthorMark post={post} />
        <strong>{post.authorName}</strong>
        {post.kind !== 'note' && (
          <span className="channel-kind">
            {KIND_ICON[post.kind]}
            {contested ? 'Contested claim' : KIND_LABEL[post.kind]}
          </span>
        )}
        <small>{shortTime(post.createdAt)}</small>
      </header>
      <PostText text={post.text} clamp={compact} />
      {taskId && onTask && (
        <button className="text-button" onClick={() => onTask(taskId)}>
          Open the task <ArrowUpRight size={13} />
        </button>
      )}
    </article>
  );
}

/** Who wrote it: a person, an employee instance, or the workspace itself. */
function AuthorMark({ post }: { post: Post }) {
  const who = post.authorSubject ? 'person' : post.authorEmployeeId ? 'employee' : 'workspace';
  return (
    <span className="channel-author" data-who={who} aria-hidden="true">
      {who === 'person' ? <UserRound size={13} /> : <Bot size={13} />}
    </span>
  );
}

function HandoffPost({
  post,
  canDecide,
  onTask,
  onDecide,
}: {
  post: Post;
  canDecide: boolean;
  onTask?: (taskId: string) => void;
  onDecide?: (postId: string, accepted: boolean) => void;
}) {
  const handoff = post.handoff;
  if (!handoff) return null;
  const acceptedTaskId = handoff.status === 'accepted' ? handoff.taskId : undefined;
  return (
    <article className="channel-handoff" data-status={handoff.status}>
      <header>
        <span className="eyebrow">HANDOFF REQUEST</span>
        <span className="handoff-pill" data-status={handoff.status}>
          {handoff.status}
        </span>
        <small>{shortTime(post.createdAt)}</small>
      </header>
      <p>
        <strong>{post.authorName}</strong> asks <strong>{handoff.toEmployeeName}</strong> to: {handoff.brief}
      </p>
      {handoff.status === 'pending' ? (
        <div className="handoff-actions">
          <button
            className="primary-button compact"
            disabled={!canDecide || !onDecide}
            onClick={() => onDecide?.(post.id, true)}
          >
            Accept
          </button>
          <button
            className="secondary-button compact"
            disabled={!canDecide || !onDecide}
            onClick={() => onDecide?.(post.id, false)}
          >
            Decline
          </button>
        </div>
      ) : (
        acceptedTaskId &&
        onTask && (
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

/**
 * The composer. A post addressed to an instance with `@Name` becomes work for it rather than another
 * line on the board, so the addressee is shown back before the post goes anywhere.
 */
function Composer({
  channelId,
  actions,
  mentionable,
  canPost,
  compact,
  onFailure,
}: {
  channelId: string;
  actions: ChannelFeedActions;
  mentionable: Mentionable[];
  canPost: boolean;
  compact: boolean;
  onFailure: (text: string | null) => void;
}) {
  const [text, setText] = useState('');
  const [mentionOpen, setMentionOpen] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const addressed = useMemo(
    () => mentionable.find((person) => text.includes(`@${person.name}`)),
    [mentionable, text],
  );

  function post() {
    const value = text.trim();
    if (!value || !canPost) return;
    actions
      .postToChannel(channelId, value, 'note', addressed?.id)
      .then(() => onFailure(null))
      .catch((failure: unknown) => onFailure(message(failure)));
    setText('');
    setMentionOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    post();
  }

  function mention(person: Mentionable) {
    setText((current) => `${current.replace(/@$/, '')}@${person.name} `);
    setMentionOpen(false);
    fieldRef.current?.focus();
  }

  return (
    <div className="composer channel-composer">
      {mentionOpen && (
        <div className="channel-mentions" role="listbox" aria-label="Address this post to an instance">
          {mentionable.map((person) => (
            <button key={person.id} role="option" aria-selected="false" onClick={() => mention(person)}>
              <strong>{person.name}</strong>
              <small>{person.role}</small>
            </button>
          ))}
        </div>
      )}
      <textarea
        ref={fieldRef}
        aria-label="Post to this channel"
        placeholder={canPost ? 'Share an update, or @name an instance to give it work…' : 'Read only.'}
        value={text}
        disabled={!canPost}
        rows={compact ? 2 : 3}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div>
        <button
          className="text-button"
          type="button"
          aria-expanded={mentionOpen}
          disabled={!canPost || !mentionable.length}
          onClick={() => setMentionOpen((open) => !open)}
        >
          <AtSign size={14} /> Address
        </button>
        {addressed ? (
          <span className="channel-addressed">Starts work for {addressed.name}</span>
        ) : (
          <span>Enter to post</span>
        )}
        <button
          className="send-button"
          type="button"
          aria-label="Post to this channel"
          disabled={!canPost || !text.trim()}
          onClick={post}
        >
          <Send size={15} />
        </button>
      </div>
    </div>
  );
}

const LINK = /\[([^\]\n]{1,160})\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s)]+)/g;

/** Markdown-lite: paragraphs and links, nothing else. */
export function PostText({ text, clamp = false }: { text: string; clamp?: boolean }) {
  const paragraphs = text.split(/\n{2,}/).filter((paragraph) => paragraph.trim());
  return (
    <div className="post-text" data-clamp={clamp}>
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
