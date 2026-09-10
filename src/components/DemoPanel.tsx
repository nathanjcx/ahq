import { useEffect, useRef, useState } from 'react';
import { Bell, Calendar, ChevronDown, ChevronUp, Mail, MessageSquare, Radio } from 'lucide-react';
import type { AppState, CloudSession } from '../../shared/types';
import type { DemoSnapshot, DemoTrigger } from '../../shared/demo';
import Modal from './Modal';
import Markdown from './Markdown';
import LaunchPanel from './LaunchPanel';
import './demo-panel.css';

const suggestedGoal =
  'Analyze sales.csv and support.csv in parallel, then synthesize both findings into an executive report with recommendations and source evidence.';
const activeSession = (session: CloudSession) => ['queued', 'running'].includes(session.status);
const imageTypes = new Set(['image/png', 'image/jpeg']);

function AttachmentPreview({ file }: { file: DemoSnapshot['notifications'][number]['attachments'][number] }) {
  const isImage = 'encoding' in file && file.encoding === 'base64' && imageTypes.has(file.mediaType);
  if (isImage) {
    return <img className="demo-attachment-image" src={`data:${file.mediaType};base64,${file.content}`} alt={file.name} />;
  }
  return <pre>{file.content}</pre>;
}

export default function DemoPanel({
  state,
  onCreateGoal,
  onWorkUpdate,
  notify,
  selectedSessionId,
  onSelectSession,
}: {
  state: AppState;
  onCreateGoal: (goal: string) => Promise<void>;
  onWorkUpdate: () => Promise<void>;
  notify: (message: string) => void;
  selectedSessionId: string | null;
  onSelectSession: (id: string | null) => void;
}) {
  const [snapshot, setSnapshot] = useState<DemoSnapshot>({ notifications: [], sessions: [] });
  const [expanded, setExpanded] = useState(true);
  const [goal, setGoal] = useState(suggestedGoal);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pollError, setPollError] = useState('');
  const [selected, setSelected] = useState<CloudSession | null>(null);
  const [streamError, setStreamError] = useState('');
  const [notice, setNotice] = useState(() => localStorage.getItem('ahq-demo-notice') !== 'seen');
  const seen = useRef<Set<string> | null>(null);
  const refreshRef = useRef(onWorkUpdate);
  refreshRef.current = onWorkUpdate;
  const workVersion = useRef('');
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const supported = !!window.ahq?.demoSnapshot;

  useEffect(() => {
    if (!supported) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await window.ahq!.demoSnapshot();
        if (disposed) return;
        if (seen.current) {
          for (const item of next.notifications) {
            if (!seen.current.has(item.id))
              notifyRef.current(
                `${item.kind === 'meeting' ? 'Upcoming meeting' : item.kind === 'email' ? 'New email' : 'New Slack message'}: ${item.title}`,
              );
          }
        }
        seen.current = new Set(next.notifications.map((item) => item.id));
        setSnapshot(next);
        const version = JSON.stringify([
          next.notifications.map((item) => [item.id, item.status, item.employeeId, item.sessionId]),
          next.sessions.map((session) => [session.id, session.status, session.employeeId]),
        ]);
        if (version !== workVersion.current) {
          await refreshRef.current();
          if (disposed) return;
          workVersion.current = version;
        }
        setPollError('');
      } catch (e) {
        if (!disposed) setPollError(e instanceof Error ? e.message : 'Could not refresh live work.');
      }
      if (!disposed) timer = setTimeout(poll, 1000);
    }
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [supported]);

  useEffect(() => {
    setSelected(null);
    setStreamError('');
    if (!selectedSessionId || !window.ahq) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const session = await window.ahq!.getSession(selectedSessionId!);
        if (disposed) return;
        setSelected(session);
        setStreamError('');
      } catch (e) {
        if (!disposed) setStreamError(e instanceof Error ? e.message : 'Could not load this session.');
      }
      if (!disposed) timer = setTimeout(poll, 1000);
    }
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [selectedSessionId]);

  async function action(run: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await run();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The request failed.');
    } finally {
      setBusy(false);
    }
  }
  function trigger(kind: DemoTrigger['kind']) {
    void action(() => window.ahq!.triggerDemo({ kind }));
  }
  const active = snapshot.sessions.filter(activeSession);
  const name = (session: CloudSession) =>
    session.title || state.employees.find((e) => e.id === session.employeeId)?.name || 'AI session';
  const messages = selected?.messages;

  return (
    <>
      <LaunchPanel
        notify={notify}
        onWorkUpdate={onWorkUpdate}
        onSelectSession={onSelectSession}
      />
      <aside className="demo-dock" aria-label="Demo controls and live work">
        <button className="demo-heading" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
          <span>
            <Radio size={16} /> Live office <span className="demo-count">{active.length} active</span>
          </span>
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {expanded && (
          <div className="demo-body">
            <details className="demo-tools">
              <summary>Custom tools</summary>
              {notice && (
                <div className="demo-notice">
                  <p>
                    Sample notifications start real AI work and use your connected account allowance. PRs are
                    simulated. Roadmap steps in this demo continue automatically.
                  </p>
                  <button
                    className="text-button"
                    onClick={() => {
                      localStorage.setItem('ahq-demo-notice', 'seen');
                      setNotice(false);
                    }}
                  >
                    Got it
                  </button>
                </div>
              )}
              <div className="demo-triggers">
                <button className="button" disabled={!supported || busy} onClick={() => trigger('meeting')}>
                  <Calendar size={15} /> Meeting
                </button>
                <button className="button" disabled={!supported || busy} onClick={() => trigger('email')}>
                  <Mail size={15} /> Email
                </button>
                <button className="button" disabled={!supported || busy} onClick={() => trigger('slack')}>
                  <MessageSquare size={15} /> Slack
                </button>
              </div>
              <form
                className="demo-goal"
                onSubmit={(e) => {
                  e.preventDefault();
                  void action(async () => {
                    await onCreateGoal(goal.trim());
                    notify('Planning your goal. Independent steps will run together.');
                  });
                }}
              >
                <label htmlFor="demo-goal">Give the team a goal</label>
                <textarea
                  id="demo-goal"
                  rows={3}
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  maxLength={500}
                  required
                />
                <button
                  className="button primary"
                  disabled={!supported || busy || !goal.trim() || state.roadmap?.status === 'planning'}
                >
                  Create roadmap &amp; start
                </button>
              </form>
            </details>
            {!supported && <p>Open the desktop app to start live work.</p>}
            {(error || pollError) && (
              <p className="demo-error" role="alert">
                {error || pollError}
              </p>
            )}
            <div className="demo-active" aria-label="Active AI work">
              <strong>Active AI work</strong>
              {active.length === 0 && (
                <p>
                  {state.roadmap?.status === 'planning'
                    ? 'The planner is preparing your roadmap…'
                    : 'Ready for a notification or goal.'}
                </p>
              )}
              {active.map((session) => (
                <button className="demo-session" key={session.id} onClick={() => onSelectSession(session.id)}>
                  <span>{name(session)}</span>
                  <small>
                    {session.taskKind || 'Task'} · {session.activity || session.status}
                  </small>
                </button>
              ))}
            </div>
            <details className="demo-history">
              <summary>
                <Bell size={14} /> Notifications &amp; saved work ({snapshot.notifications.length})
              </summary>
              {snapshot.triggerAddress && (
                <p className="demo-address">
                  External trigger: <code>{snapshot.triggerAddress}</code>
                </p>
              )}
              {[...snapshot.notifications].reverse().map((item) => (
                <article className="demo-source" key={item.id}>
                  <strong>{item.title}</strong>
                  <small>
                    {item.kind} · {item.status} · {new Date(item.receivedAt).toLocaleTimeString()}
                  </small>
                  <p>{item.content}</p>
                  {item.attachments.map((file, index) => (
                    <details key={`${file.name}-${index}`}>
                      <summary>{file.name}</summary>
                      <AttachmentPreview file={file} />
                    </details>
                  ))}
                  <div className="demo-source-actions">
                    {item.triageSessionId && (
                      <button className="text-button" onClick={() => onSelectSession(item.triageSessionId!)}>
                        View triage
                      </button>
                    )}
                    {item.sessionId && (
                      <button className="text-button" onClick={() => onSelectSession(item.sessionId!)}>
                        View work
                      </button>
                    )}
                    {item.status === 'failed' && (
                      <button
                        className="button"
                        disabled={busy}
                        onClick={() => void action(() => window.ahq!.retryDemo(item.id))}
                      >
                        Retry
                      </button>
                    )}
                  </div>
                  {item.error && <p className="demo-error">{item.error}</p>}
                </article>
              ))}
              <strong>Session history</strong>
              {[...snapshot.sessions]
                .reverse()
                .filter((session) => !activeSession(session))
                .map((session) => (
                  <button
                    className="demo-session"
                    key={session.id}
                    onClick={() => onSelectSession(session.id)}
                  >
                    <span>{name(session)}</span>
                    <small>{session.status}</small>
                  </button>
                ))}
            </details>
          </div>
        )}
      </aside>
      {selectedSessionId && (
        <Modal
          title={selected ? name(selected) : 'Employee work'}
          subtitle={selected ? `${selected.taskKind || 'Session'} · ${selected.status}` : 'Loading session…'}
          wide
          onClose={() => onSelectSession(null)}
        >
          <div className="demo-stream">
            {streamError && (
              <p className="demo-error" role="alert">
                {streamError}
              </p>
            )}
            {selected && (
              <>
                <p>{selected.activity}</p>
                <h3>Messages</h3>
                {messages?.length ? (
                  messages.map((message) => (
                    <article className="demo-message" key={message.id}>
                      <small>
                        {new Date(message.timestamp).toLocaleTimeString()} ·{' '}
                        {message.complete ? 'Saved message' : 'Streaming'}
                      </small>
                      <Markdown content={message.text} />
                    </article>
                  ))
                ) : selected.events.length ? (
                  selected.events.map((event) => (
                    <article className="demo-message" key={event.id}>
                      <small>{event.time}</small>
                      <Markdown content={event.text} />
                    </article>
                  ))
                ) : (
                  <p>Waiting for the first message.</p>
                )}
                {selected.output && (
                  <details open>
                    <summary>Deliverable</summary>
                    <Markdown content={selected.output.content} />
                  </details>
                )}
                {!!selected.artifacts?.length && (
                  <>
                    <h3>Files</h3>
                    {selected.artifacts.map((artifact) => (
                      <article className="demo-message" key={artifact.id}>
                        <strong>
                          {artifact.title}
                          {artifact.simulated ? ' · simulated' : ''}
                        </strong>
                        <button
                          className="button"
                          onClick={() =>
                            void window
                              .ahq!.openLocalArtifact({ sessionId: selected.id, artifactId: artifact.id })
                              .catch((e) =>
                                setStreamError(e instanceof Error ? e.message : 'Could not open artifact.'),
                              )
                          }
                        >
                          Open file
                        </button>
                        <details>
                          <summary>Preview</summary>
                          <Markdown content={artifact.content} />
                        </details>
                      </article>
                    ))}
                  </>
                )}
              </>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
