import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  CheckCheck,
  ChevronRight,
  Cloud,
  Database as DatabaseIcon,
  FileText,
  Flag,
  FolderOpen,
  Leaf,
  Link2,
  LoaderCircle,
  Megaphone,
  MessageCircle,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
} from 'lucide-react';
import type {
  AppState,
  Approval,
  CloudSettings,
  Commitment,
  Employee,
  LocalFileEntry,
  WorkspaceFolder,
} from '../../shared/types';
import type { UpdateState } from '../App';
import { clockTime, dueLabel, employeeById, timeNow, uid } from '../lib/store';
import Avatar from './Avatar';
import Modal from './Modal';
import './office-chat.css';
type Common = { state: AppState; update: UpdateState; notify: (message: string) => void };

export function FilesPage({ state, notify }: { state: AppState; notify: (message: string) => void }) {
  const [files, setFiles] = useState<LocalFileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    if (!window.ahq) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setFiles(await window.ahq.listFiles());
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not read local files.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  const documents = files.filter((file) => file.kind === 'document');
  const assets = files.filter((file) => file.kind === 'asset');
  const database = files.find((file) => file.kind === 'database');
  const show = async (filePath: string) => {
    if (!window.ahq || busy) return;
    setBusy(true);
    try {
      await window.ahq.showFileInFinder(filePath);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not open that file in Finder.');
    } finally {
      setBusy(false);
    }
  };
  const size = (bytes: number) =>
    bytes < 1024
      ? `${bytes} B`
      : bytes < 1024 * 1024
        ? `${Math.round(bytes / 1024)} KB`
        : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return (
    <div className="files-page">
      <div className="page-toolbar">
        <div className="tab-bar">
          <button className="selected">
            Local files <span>{files.length}</span>
          </button>
        </div>
        <div className="button-group">
          <button
            className="button secondary"
            disabled={!window.ahq || loading}
            onClick={() => void refresh()}
          >
            <RefreshCw size={14} className={loading ? 'spin' : undefined} /> Refresh
          </button>
          <button
            className="button primary"
            disabled={!window.ahq || busy}
            onClick={() =>
              void window
                .ahq!.showStorageInFinder()
                .catch((error) =>
                  notify(error instanceof Error ? error.message : 'Could not open local storage.'),
                )
            }
          >
            <FolderOpen size={14} /> Open storage folder
          </button>
        </div>
      </div>
      <section className="surface files-section">
        <div className="section-heading">
          <h2>
            <DatabaseIcon size={18} /> Workspace objects
          </h2>
          {database && <span className="muted">{database.relativePath}</span>}
        </div>
        <div className="files-object-list">
          {database && (
            <div className="file-row">
              <DatabaseIcon size={19} />
              <div>
                <strong>Office database</strong>
                <small>
                  {database.relativePath} · {size(database.size)}
                </small>
              </div>
              <button className="button secondary" onClick={() => void show(database.path)}>
                Show in Finder
              </button>
            </div>
          )}
          {state.folders.map((folder) => (
            <div className="file-row" key={folder.id}>
              <FolderOpen size={19} />
              <div>
                <strong>{folder.name}</strong>
                <small>{folder.files.length} source files · local working copy</small>
              </div>
              <button className="button secondary" onClick={() => void window.ahq?.showStorageInFinder()}>
                Storage folder
              </button>
            </div>
          ))}
          {assets.map((file) => (
            <div className="file-row" key={file.path}>
              <FolderOpen size={19} />
              <div>
                <strong>{file.name}</strong>
                <small>
                  {file.relativePath} · {size(file.size)}
                </small>
              </div>
              <button className="button secondary" onClick={() => void show(file.path)}>
                Show in Finder
              </button>
            </div>
          ))}
          {!database && !state.folders.length && !assets.length && (
            <p className="muted">No local workspace objects yet.</p>
          )}
        </div>
      </section>
      <section className="surface files-section">
        <div className="section-heading">
          <h2>
            <FileText size={18} /> Generated documents
          </h2>
          <span className="muted">{documents.length} saved</span>
        </div>
        {loading ? (
          <p className="muted">Reading your local workspace…</p>
        ) : documents.length ? (
          <div className="files-object-list">
            {documents.map((file) => (
              <div className="file-row" key={file.path}>
                <FileText size={19} />
                <div>
                  <strong>{file.name}</strong>
                  <small>
                    {file.relativePath} · {size(file.size)}
                  </small>
                </div>
                <button className="button secondary" onClick={() => void show(file.path)}>
                  Show in Finder
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">Generated employee documents will appear here as they are saved.</p>
        )}
      </section>
    </div>
  );
}
export function EmployeesPage({
  state,
  onCreate,
  onSelect,
}: Common & { onCreate: () => void; onSelect: (e: Employee) => void }) {
  const [query, setQuery] = useState('');
  const employees = state.employees.filter((e) =>
    `${e.name} ${e.jobTitle} ${e.skills}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <div className="page-toolbar">
        <div className="tab-bar">
          <button className="selected">
            Everyone <span>{state.employees.length}</span>
          </button>
        </div>
        <div className="inline-search">
          <Search size={16} />
          <input
            aria-label="Find a teammate"
            placeholder="Find a teammate…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      <div className="employee-grid">
        {employees.map((e) => (
          <button className="employee-card" key={e.id} onClick={() => onSelect(e)}>
            <div className="employee-card-top">
              <Avatar employee={e} size={62} />
              <MoreHorizontal size={19} />
            </div>
            <h2>{e.name}</h2>
            <p className="employee-title">{e.jobTitle}</p>
            <p className="employee-personality">{e.personality}</p>
            <div className="skill-tags">
              {e.skills
                .split(',')
                .slice(0, 3)
                .map((skill) => (
                  <span key={skill}>{skill.trim()}</span>
                ))}
            </div>
            <div className="employee-card-footer">
              <span className={e.status === 'review' ? 'amber-dot' : 'status-dot'} />
              <span>{e.sessionId ? e.activity : 'Ready for an assignment'}</span>
              <ArrowRight size={14} />
            </div>
          </button>
        ))}
        <button className="employee-card new-employee-card" onClick={onCreate}>
          <span className="new-employee-circle">
            <Plus size={26} />
          </span>
          <h3>Good company starts here.</h3>
          <p>Make room for another great teammate.</p>
          <span className="text-button">
            New employee <ArrowRight size={14} />
          </span>
        </button>
      </div>
      {query && employees.length === 0 && <p className="muted">No teammates match “{query}”.</p>}
      <div className="wide-note">
        <Leaf size={20} />
        <div>
          <strong>A role gives direction. A connection makes it possible.</strong>
          <p>
            Each employee has their own Astra session when assigned work. Sign in with ChatGPT in settings to
            get started.
          </p>
        </div>
      </div>
    </>
  );
}
export function AnnouncePage({
  state,
  notify,
  onEditGoal,
  onBroadcast,
}: Common & { onEditGoal: () => void; onBroadcast: (s: string) => Promise<void> }) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  async function send() {
    if (!message.trim() || sending) return;
    setSending(true);
    try {
      await onBroadcast(message.trim());
      setMessage('');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Announcement failed.');
    } finally {
      setSending(false);
    }
  }
  return (
    <div className="two-column-page">
      <div>
        <div className="north-star-card">
          <span className="goal-icon">
            <Target size={25} />
          </span>
          <div>
            <span className="eyebrow">OUR NORTH STAR</span>
            <h2>{state.goal}</h2>
            <button className="text-button" onClick={onEditGoal}>
              Refine our direction <ArrowRight size={14} />
            </button>
          </div>
          <span className="star-decoration">✳</span>
        </div>
        <section className="surface announce-composer">
          <div className="section-heading">
            <h2>
              <Megaphone size={18} />A word to the whole team
            </h2>
          </div>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={12000}
            rows={4}
            placeholder="A new direction, a little context, or something worth sharing…"
            aria-label="Announcement"
          />
          <div className="composer-footer">
            <span>Shared context for every new assignment</span>
            <button
              className="button primary"
              onClick={send}
              disabled={!message.trim() || !state.employees.length}
            >
              <Megaphone size={15} />
              Announce
            </button>
          </div>
        </section>
        <div className="list-heading">
          <h2>The shared story</h2>
          <span>{state.messages.filter((m) => m.channel === 'announce').length} announcements</span>
        </div>
        {state.messages
          .filter((m) => m.channel === 'announce')
          .slice()
          .reverse()
          .map((m) => (
            <article className="surface announcement" key={m.id}>
              <div className="announcement-top">
                <Avatar size={37} />
                <div>
                  <strong>
                    You <span className="muted">to everyone</span>
                  </strong>
                  <small>
                    {new Date(m.time).toLocaleDateString([], { month: 'short', day: 'numeric' })} at{' '}
                    {clockTime(m.time)}
                  </small>
                </div>
                <Megaphone size={17} />
              </div>
              <p>{m.text}</p>
              <div className="announcement-receipt">
                {m.acknowledgmentIds?.length ? (
                  <>
                    <CheckCheck size={15} />
                    <span>Example · acknowledged by {m.acknowledgmentIds.length} teammates</span>
                  </>
                ) : (
                  <>
                    <BookOpen size={15} />
                    <span>Saved for new assignments · no delivery acknowledgments yet</span>
                  </>
                )}
              </div>
            </article>
          ))}
      </div>
      <aside className="surface sidebar-info">
        <span className="illustration-orbit">
          <Megaphone size={34} />
          <i>✳</i>
        </span>
        <h3>A little alignment goes a long way.</h3>
        <p>Announce is the place for direction that belongs to everyone.</p>
        <div className="info-divider" />
        <h4>Everyone has a seat.</h4>
        <div className="team-roster">
          {state.employees.map((e) => (
            <div key={e.id}>
              <Avatar employee={e} size={30} />
              <span>
                {e.name}
                <small>{e.jobTitle}</small>
              </span>
              <span className="subtle-dot" />
            </div>
          ))}
        </div>
        <p className="small-note">Saved announcements are included as context when a new session starts.</p>
      </aside>
    </div>
  );
}
function commitmentSignal(c: Commitment, all: Commitment[]) {
  if (c.status === 'done') return { text: 'Promise kept', className: 'ready' };
  if (new Date(c.deadline).getTime() < Date.now()) return { text: 'Past its deadline', className: 'overdue' };
  if (c.status === 'review') return { text: 'Needs your perspective', className: 'review' };
  if (c.dependencies.some((id) => all.find((item) => item.id === id)?.status !== 'done'))
    return { text: 'Waiting for a handoff', className: 'waiting' };
  return { text: 'A clear next step', className: 'ready' };
}
export function CommitmentsPage({
  state,
  onSelect,
  onCreate,
}: Common & { onSelect: (c: Commitment) => void; onCreate: () => void }) {
  const [filter, setFilter] = useState('open');
  const open = state.commitments.filter((c) => c.status !== 'done');
  const commitments = state.commitments.filter(
    (c) => filter === 'all' || (filter === 'done' ? c.status === 'done' : c.status !== 'done'),
  );
  return (
    <>
      <div className="commitment-stats">
        <div>
          <span className="stat-icon">
            <Flag size={20} />
          </span>
          <span>
            <strong>{open.length}</strong>
            <small>Promises in motion</small>
          </span>
        </div>
        <div>
          <span className="stat-icon warm">
            <Sparkles size={20} />
          </span>
          <span>
            <strong>{open.filter((c) => c.status === 'review').length}</strong>
            <small>Ready for your perspective</small>
          </span>
        </div>
        <div>
          <span className="stat-icon">
            <CheckCheck size={20} />
          </span>
          <span>
            <strong>{state.commitments.filter((c) => c.status === 'done').length}</strong>
            <small>Promises kept</small>
          </span>
        </div>
        <div className="stat-quote">
          A clear next step.
          <br />
          <em>A little peace of mind.</em>
        </div>
      </div>
      <div className="page-toolbar">
        <div className="tab-bar">
          {[
            { id: 'open', name: 'In motion' },
            { id: 'done', name: 'Completed' },
            { id: 'all', name: 'Everything' },
          ].map((f) => (
            <button key={f.id} onClick={() => setFilter(f.id)} className={filter === f.id ? 'selected' : ''}>
              {f.name}
            </button>
          ))}
        </div>
        <span className="muted">
          <CalendarDays size={14} />
          Organized by the promises you’ve made
        </span>
      </div>
      <div className="commitment-list">
        {commitments
          .sort((a, b) => a.deadline.localeCompare(b.deadline))
          .map((c) => {
            const signal = commitmentSignal(c, state.commitments);
            return (
              <button className="commitment-card" key={c.id} onClick={() => onSelect(c)}>
                <div className="commitment-leading">
                  {c.status === 'done' ? <CheckCheck size={22} /> : <Flag size={22} />}
                </div>
                <div className="commitment-card-main">
                  <span className={`status-pill ${signal.className}`}>{signal.text}</span>
                  <h2>{c.title}</h2>
                  <p>{c.description}</p>
                  <div className="commitment-next">
                    <ArrowRight size={14} />
                    <span>{c.nextStep}</span>
                  </div>
                </div>
                <div className="commitment-card-side">
                  <span className="commitment-due">
                    <CalendarDays size={14} />
                    {dueLabel(c.deadline)}
                    <small>{c.firm ? 'Firm promise' : 'Flexible target'}</small>
                  </span>
                  <div className="owner-line">
                    <Avatar employee={employeeById(state.employees, c.ownerId)} size={27} />
                    {employeeById(state.employees, c.ownerId)?.name}
                  </div>
                  <div className="progress-line">
                    <div style={{ width: `${c.progress}%` }} />
                  </div>
                  <small>
                    {c.progress}% ·{' '}
                    {c.source === 'Example assignment' ? 'sample progress' : 'recorded progress'}
                  </small>
                </div>
                <ChevronRight size={20} />
              </button>
            );
          })}
        {commitments.length === 0 && (
          <div className="surface empty-state">
            <Flag size={34} />
            <h3>
              {filter === 'done' ? 'Good things take a few steps.' : 'A little room for what comes next.'}
            </h3>
            <p>
              {filter === 'done'
                ? 'Your completed commitments will find a home here.'
                : 'Start with an outcome you want to make real.'}
            </p>
            {filter !== 'done' && (
              <button className="button primary" onClick={onCreate}>
                New commitment <Plus size={15} />
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
export function ConversationsPage({
  state,
  update,
  notify,
  initialChannel = 'team',
  onBroadcast,
  compact = false,
  onChannelChange,
}: Common & {
  initialChannel?: string;
  onBroadcast: (text: string) => Promise<void>;
  compact?: boolean;
  onChannelChange?: (channel: string) => void;
}) {
  const [channel, setChannel] = useState(initialChannel);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const messageList = useRef<HTMLDivElement>(null);
  const followMessages = useRef(true);
  useEffect(() => {
    setChannel(initialChannel);
    setSendError('');
    followMessages.current = true;
  }, [initialChannel]);
  useEffect(() => {
    if (channel !== 'team' && channel !== 'announce' && !state.employees.some((e) => e.id === channel)) {
      setChannel('team');
      onChannelChange?.('team');
    }
  }, [channel, state.employees, onChannelChange]);
  function chooseChannel(next: string) {
    setChannel(next);
    setSendError('');
    followMessages.current = true;
    onChannelChange?.(next);
  }
  const draft = drafts[channel] ?? '';
  const announcement = channel === 'announce';
  const person = employeeById(state.employees, channel);
  const messages = state.messages.filter((m) => m.channel === channel);
  useEffect(() => {
    if (messageList.current && followMessages.current) {
      messageList.current.scrollTop = messageList.current.scrollHeight;
    }
  }, [channel, messages.length]);
  async function send() {
    if (!draft.trim() || sending || (announcement && !state.employees.length)) return;
    setSendError('');
    if (announcement) {
      setSending(true);
      try {
        await onBroadcast(draft.trim());
        setDrafts((current) => ({ ...current, [channel]: '' }));
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'The announcement could not be sent. Try again.';
        setSendError(message);
        notify(message);
      } finally {
        setSending(false);
      }
      return;
    }
    update((s) => ({
      ...s,
      messages: [...s.messages, { id: uid(), authorId: 'you', channel, text: draft.trim(), time: timeNow() }],
    }));
    setDrafts((current) => ({ ...current, [channel]: '' }));
    notify('Message saved locally for your team’s context.');
  }
  return (
    <div className={`conversation-layout surface${compact ? ' office-chat' : ''}`}>
      {!compact && (
        <aside className="conversation-channels">
          <span className="eyebrow">SHARED SPACES</span>
          <button
            className={channel === 'team' ? 'selected' : ''}
            aria-pressed={channel === 'team'}
            disabled={sending}
            onClick={() => chooseChannel('team')}
          >
            <MessageCircle size={18} />
            <span>
              team-lounge<small>The whole team, together</small>
            </span>
          </button>
          <button
            className={announcement ? 'selected' : ''}
            aria-pressed={announcement}
            disabled={sending}
            onClick={() => chooseChannel('announce')}
          >
            <Megaphone size={18} />
            <span>
              Announcements<small>Direction for every employee</small>
            </span>
          </button>
          <span className="eyebrow">A LITTLE ONE-ON-ONE</span>
          {state.employees.map((e) => (
            <button
              className={channel === e.id ? 'selected' : ''}
              aria-pressed={channel === e.id}
              disabled={sending}
              key={e.id}
              onClick={() => chooseChannel(e.id)}
            >
              <Avatar employee={e} size={33} />
              <span>
                {e.name}
                <small>{e.jobTitle}</small>
              </span>
            </button>
          ))}
        </aside>
      )}
      <section className="conversation-main" aria-label={compact ? 'Office chat' : undefined}>
        {compact ? (
          <header className="office-chat-header">
            <h2>Chat</h2>
            <select
              aria-label="Chat channel"
              value={channel}
              disabled={sending}
              onChange={(event) => chooseChannel(event.target.value)}
            >
              <option value="team">Team</option>
              <option value="announce">Announcements</option>
              {state.employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.name} · {employee.jobTitle}
                </option>
              ))}
            </select>
          </header>
        ) : (
          <header>
            <div>
              {person ? (
                <Avatar employee={person} size={37} />
              ) : (
                <span className="channel-avatar">
                  {announcement ? <Megaphone size={22} /> : <Users size={22} />}
                </span>
              )}
              <div>
                <h2>{announcement ? 'Announcements' : (person?.name ?? 'team-lounge')}</h2>
                <p>
                  {announcement
                    ? 'Send direction to every employee’s session. Voice announcements appear here too.'
                    : (person?.jobTitle ?? 'A space for the little things that move work forward.')}
                </p>
              </div>
            </div>
            <span className="mode-badge">
              {announcement ? 'To everyone' : person?.sessionId ? 'Assignment context' : 'Local workspace'}
            </span>
          </header>
        )}
        <div
          className="conversation-messages"
          ref={messageList}
          role="log"
          aria-label={announcement ? 'Announcements' : `${person?.name ?? 'Team'} messages`}
          aria-live="polite"
          onScroll={(event) => {
            const list = event.currentTarget;
            followMessages.current = list.scrollHeight - list.scrollTop - list.clientHeight < 64;
          }}
        >
          {messages.length === 0 && (
            <div className="empty-state">
              {!compact && (announcement ? <Megaphone size={32} /> : <MessageCircle size={32} />)}
              <h3>
                {compact
                  ? 'No messages yet'
                  : announcement
                    ? 'Give everyone the same direction.'
                    : 'Every good thing starts somewhere.'}
              </h3>
              <p>
                {announcement
                  ? state.employees.length
                    ? 'Type an announcement below, or hold Announce beneath the office to speak.'
                    : 'Add your first employee, then share a direction with the whole office.'
                  : compact
                    ? 'Messages are saved as context for new assignments.'
                    : `Leave ${person?.name ?? 'your team'} a little context for their next assignment.`}
              </p>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={m.id}>
              {(i === 0 ||
                new Date(messages[i - 1].time).toDateString() !== new Date(m.time).toDateString()) && (
                <div className="conversation-date">
                  <span>
                    {new Date(m.time).toLocaleDateString([], {
                      weekday: compact ? undefined : 'long',
                      month: compact ? 'short' : 'long',
                      day: 'numeric',
                    })}
                  </span>
                </div>
              )}
              <div className={`chat-message full ${m.authorId === 'you' ? 'from-you' : ''}`}>
                <Avatar employee={employeeById(state.employees, m.authorId)} size={compact ? 28 : 36} />
                <div>
                  <div className="message-byline">
                    <strong>{employeeById(state.employees, m.authorId)?.name ?? 'You'}</strong>
                    <time>{clockTime(m.time)}</time>
                    {m.id.startsWith('m') && <span className="sample-label">EXAMPLE</span>}
                  </div>
                  <p>{m.text}</p>
                  {announcement && (
                    <div className="announcement-receipt">
                      {m.acknowledgmentIds?.length ? <CheckCheck size={15} /> : <BookOpen size={15} />}
                      <span>
                        {m.acknowledgmentIds?.length
                          ? `${m.id.startsWith('m') ? 'Example · ' : ''}Delivered to ${new Set(m.acknowledgmentIds).size} employee${new Set(m.acknowledgmentIds).size === 1 ? '' : 's'}`
                          : 'Saved · no delivery receipts yet'}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
        <form
          className="conversation-compose"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            value={draft}
            maxLength={12000}
            onChange={(e) => setDrafts((current) => ({ ...current, [channel]: e.target.value }))}
            placeholder={
              compact
                ? announcement
                  ? 'Announce to everyone…'
                  : `Message ${person?.name ?? 'the team'}…`
                : announcement
                  ? 'A new direction, changed priority, or guidance for everyone…'
                  : `A little note for ${person?.name ?? 'the team'}…`
            }
            aria-label={announcement ? 'Announcement to every employee' : 'Message'}
            disabled={sending || (announcement && !state.employees.length)}
            rows={2}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div>
            <span>
              {announcement
                ? state.employees.length
                  ? compact
                    ? 'Starts or redirects work'
                    : 'Starts or redirects every employee’s work'
                  : 'Add an employee to make an announcement.'
                : compact
                  ? 'Context for new assignments'
                  : 'Saved locally · included with new assignments'}
            </span>
            <button
              type="submit"
              className="button primary"
              disabled={!draft.trim() || sending || (announcement && !state.employees.length)}
            >
              {sending ? (
                <LoaderCircle size={15} className="spin" />
              ) : announcement ? (
                <Megaphone size={15} />
              ) : (
                <Send size={15} />
              )}
              {sending ? 'Sending…' : announcement ? (compact ? 'Announce' : 'Announce to everyone') : 'Send'}
            </button>
          </div>
        </form>
        {sendError && (
          <p className="office-chat-error" role="alert">
            {sendError}
          </p>
        )}
      </section>
    </div>
  );
}
export function NeedsYouPage({ state, onReview }: Common & { onReview: (a: Approval) => void }) {
  const [filter, setFilter] = useState('pending');
  const approvals = state.approvals.filter((a) =>
    filter === 'pending' ? a.status === 'pending' : a.status !== 'pending',
  );
  return (
    <>
      <div className="review-intro">
        <span className="illustration-orbit">
          <Sparkles size={28} />
        </span>
        <div>
          <h2>Your perspective is part of the process.</h2>
          <p>See the work, check the sources, and make the call. Every decision has a record.</p>
        </div>
        <span className="review-total">
          {state.approvals.filter((a) => a.status === 'pending').length}
          <small>WAITING FOR YOU</small>
        </span>
      </div>
      <div className="page-toolbar">
        <div className="tab-bar">
          <button className={filter === 'pending' ? 'selected' : ''} onClick={() => setFilter('pending')}>
            Needs a look <span>{state.approvals.filter((a) => a.status === 'pending').length}</span>
          </button>
          <button className={filter === 'reviewed' ? 'selected' : ''} onClick={() => setFilter('reviewed')}>
            Your decisions
          </button>
        </div>
      </div>
      <div className="review-grid">
        {approvals.map((a) => (
          <button className="review-card surface" key={a.id} onClick={() => onReview(a)}>
            <div className="review-card-top">
              <Avatar employee={employeeById(state.employees, a.employeeId)} size={40} />
              <div>
                <strong>{employeeById(state.employees, a.employeeId)?.name ?? 'Your workspace'}</strong>
                <small>
                  {clockTime(a.createdAt)} · Version {a.version}
                </small>
              </div>
              <span className={`status-pill ${a.status === 'pending' ? 'review' : 'ready'}`}>
                {a.status.replaceAll('-', ' ')}
              </span>
            </div>
            <h2>{a.title}</h2>
            <p>{a.summary}</p>
            <div className="review-card-source">
              <BookOpen size={14} />
              {a.sources.length} sources included<span>·</span>
              {a.sessionId
                ? a.sessionId.startsWith('chatgpt-')
                  ? 'ChatGPT plan output'
                  : 'Astra cloud output'
                : a.employeeId === 'you'
                  ? 'Local source brief'
                  : 'Example deliverable'}
            </div>
            <div className="review-card-bottom">
              <span>{a.status === 'pending' ? 'Take a thoughtful look' : 'View your decision'}</span>
              <ArrowRight size={18} />
            </div>
          </button>
        ))}
      </div>
      {approvals.length === 0 && (
        <div className="surface empty-state">
          <CheckCheck size={38} />
          <h3>
            {filter === 'pending' ? 'A little breathing room.' : 'Your decisions will have a home here.'}
          </h3>
          <p>
            {filter === 'pending'
              ? 'You’re all caught up. Good things can keep moving.'
              : 'Review a deliverable to start the story.'}
          </p>
        </div>
      )}
    </>
  );
}
export function SettingsPage({
  state,
  update,
  notify,
  cloud,
  setCloud,
  onSelectFolder,
  onBrief,
  onReset,
}: Common & {
  cloud: CloudSettings;
  setCloud: (s: CloudSettings) => void;
  onSelectFolder: () => void;
  onBrief: (f: WorkspaceFolder) => void;
  onReset: () => void;
}) {
  const [name, setName] = useState(state.workspaceName);
  const [endpoint, setEndpoint] = useState(cloud.endpoint);
  const [token, setToken] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const [reset, setReset] = useState(false);
  async function connect() {
    if (!window.ahq) return;
    setConnecting(true);
    setError('');
    try {
      const settings = await window.ahq.configureCloud({ endpoint, token });
      setCloud(settings);
      setToken('');
      notify('Your Astra cloud gateway is connected.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not connect to that gateway.');
    } finally {
      setConnecting(false);
    }
  }
  return (
    <div className="settings-layout">
      <div className="settings-primary">
        <section className="surface settings-section">
          <div className="section-heading">
            <h2>
              <Settings size={18} />A space of your own
            </h2>
          </div>
          <form
            className="workspace-name-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) {
                update((s) => ({ ...s, workspaceName: name.trim() }));
                notify('Workspace name updated.');
              }
            }}
          >
            <label>
              Workspace name
              <input value={name} required maxLength={40} onChange={(e) => setName(e.target.value)} />
            </label>
            <button className="button secondary" type="submit">
              Save name
            </button>
          </form>
          <div className="setting-row">
            <div>
              <strong>A quieter kind of motion</strong>
              <p>Reduce animation throughout your office.</p>
            </div>
            <button
              role="switch"
              aria-checked={state.reducedMotion}
              aria-label="Reduced motion"
              className={`toggle ${state.reducedMotion ? 'on' : ''}`}
              onClick={() => update((s) => ({ ...s, reducedMotion: !s.reducedMotion }))}
            >
              <span />
            </button>
          </div>
        </section>
        <section className="surface settings-section">
          <div className="section-heading">
            <h2>
              <FolderOpen size={18} />
              The context behind the work
            </h2>
            <button className="text-button" onClick={onSelectFolder}>
              <Plus size={14} />
              Add folder
            </button>
          </div>
          <p className="muted">Local working copies. Your original files stay in place.</p>
          {state.folders.length === 0 ? (
            <button className="folder-drop-area" onClick={onSelectFolder}>
              <span>
                <FolderOpen size={30} />
              </span>
              <strong>Bring a little context.</strong>
              <p>Choose a project folder to give your team a starting point.</p>
              <span className="button secondary">
                Choose a folder <Plus size={14} />
              </span>
            </button>
          ) : (
            <div className="folder-list">
              {state.folders.map((folder) => (
                <div key={folder.id}>
                  <span className="folder-list-icon">
                    <FolderOpen size={22} />
                  </span>
                  <span>
                    <strong>{folder.name}</strong>
                    <small>
                      {folder.files.length} files · Local copy · {folder.excludedCount} excluded
                    </small>
                  </span>
                  <button className="button secondary" onClick={() => onBrief(folder)}>
                    <FileText size={14} />
                    Prepare brief
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="permission-note">
            <ShieldCheck size={16} />
            <p>
              Cloud sharing is a separate choice when you assign work. File access does not grant permission
              to change originals.
            </p>
          </div>
        </section>
        <section className="surface settings-section">
          <div className="section-heading">
            <h2>
              <Cloud size={18} />
              Employee connection
            </h2>
            <span className={`status-pill ${cloud.connected ? 'ready' : 'waiting'}`}>
              {cloud.connected ? 'Connected' : 'Not connected'}
            </span>
          </div>
          <p className="muted">
            Employee work uses your selected connection. The optional gateway below is for organizations
            running their own service.
          </p>
          {!window.ahq && (
            <div className="info-note">
              <Cloud size={18} />
              <span>
                Cloud connections run through the desktop companion. This browser preview keeps work on this
                device.
              </span>
            </div>
          )}
          <details>
            <summary>Use a separate Astra gateway instead</summary>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void connect();
              }}
            >
              <label>
                Gateway endpoint
                <input
                  type="url"
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  placeholder="https://your-astra-gateway.example.com"
                  disabled={!window.ahq || connecting}
                  required
                />
              </label>
              <label>
                Access token
                <input
                  type="password"
                  autoComplete="new-password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder={
                    cloud.configured ? 'Leave blank to keep the saved token' : 'Your gateway access token'
                  }
                  disabled={!window.ahq || connecting}
                  required={!cloud.configured}
                />
              </label>
              <p className="form-hint">
                Tokens are encrypted by macOS and never exposed to the office interface.
              </p>
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <div className="button-group">
                <button type="submit" className="button primary" disabled={!window.ahq || connecting}>
                  {connecting ? <LoaderCircle size={15} className="spin" /> : <Link2 size={15} />}
                  {cloud.configured ? 'Update connection' : 'Connect Astra cloud'}
                </button>
                {cloud.provider === 'gateway' && cloud.configured && (
                  <button
                    type="button"
                    className="button secondary"
                    onClick={async () => {
                      try {
                        const next = await window.ahq!.disconnectCloud();
                        setCloud(next);
                        notify('Astra gateway disconnected on this device.');
                      } catch {
                        notify('Could not disconnect. Please try again.');
                      }
                    }}
                  >
                    Disconnect
                  </button>
                )}
              </div>
            </form>
          </details>
        </section>
      </div>
      <aside>
        <section className="surface settings-section privacy-card">
          <ShieldCheck size={28} />
          <h3>Your space. Your say.</h3>
          <p>
            Assignments have a clear owner. Documents have a review step. External actions need a specific
            decision.
          </p>
          <span className="text-button">
            Built around your trust <Leaf size={15} />
          </span>
        </section>
        <section className="settings-section reset-section">
          <h3>A fresh look at the sample</h3>
          <p>
            Restore the example office, people, and deliverables. This replaces your saved workspace data.
          </p>
          <button className="text-button danger" onClick={() => setReset(true)}>
            Restore sample workspace
          </button>
        </section>
      </aside>
      {reset && (
        <Modal
          title="Start fresh with the sample?"
          subtitle="This replaces your profiles, messages, commitments, and decisions on this device. Export anything you want to keep first."
          onClose={() => setReset(false)}
        >
          <div className="modal-footer">
            <button className="button secondary" onClick={() => setReset(false)}>
              Keep my workspace
            </button>
            <button
              className="button danger-button"
              onClick={() => {
                onReset();
                setReset(false);
              }}
            >
              Restore sample
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
