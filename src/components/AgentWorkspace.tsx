import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  Brain,
  Check,
  FileText,
  Inbox,
  LoaderCircle,
  RefreshCw,
  Save,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import type { Employee } from '../../shared/types';
import { resolveAgentConfig, type MemoryKind, type MemoryScope } from '../../shared/agent-config';
import type { AgentArtifact, AgentInspection, AgentMemory } from '../../shared/agent-inspection';
import './agent-workspace.css';

const panels = [
  { id: 'session', label: 'Session', icon: Activity },
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'inbox', label: 'Inbox', icon: Inbox },
  { id: 'artifacts', label: 'Artifacts', icon: FileText },
] as const;
const stamp = (time: string) =>
  new Date(time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

type AgentWorkspaceProps = { employee: Employee; employees: Employee[] };
export function AgentWorkspace(props: AgentWorkspaceProps) {
  return <EmployeeWorkspace key={props.employee.id} {...props} />;
}

function EmployeeWorkspace({ employee, employees }: AgentWorkspaceProps) {
  const workspaceId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const actionPending = useRef(false);
  const inspectionRequest = useRef(0);
  const [tab, setTab] = useState<(typeof panels)[number]['id']>('session');
  const [data, setData] = useState<AgentInspection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [inspectionError, setInspectionError] = useState('');
  const [loading, setLoading] = useState(!!window.ahq);
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<AgentMemory | null>(null);
  const [content, setContent] = useState('');
  const config = resolveAgentConfig(employee.agent);
  const [kind, setKind] = useState<MemoryKind>(config.memory.kinds[0] ?? 'semantic');
  const [scope, setScope] = useState<MemoryScope>(config.memory.scopes[0] ?? 'employee');
  const [artifact, setArtifact] = useState<AgentArtifact | null>(null);
  const refresh = useCallback(async () => {
    if (!window.ahq) return;
    const request = ++inspectionRequest.current;
    const result = await window.ahq.inspectAgent(employee.id);
    if (request !== inspectionRequest.current) return;
    setData(result);
    setInspectionError('');
    setLoading(false);
  }, [employee.id]);
  useEffect(() => {
    let active = true;
    let polling = false;
    const poll = async () => {
      if (!window.ahq || polling || actionPending.current) return;
      polling = true;
      const request = ++inspectionRequest.current;
      try {
        const result = await window.ahq.inspectAgent(employee.id);
        if (active && request === inspectionRequest.current) {
          setData(result);
          setInspectionError('');
        }
      } catch (e) {
        if (active && request === inspectionRequest.current)
          setInspectionError(e instanceof Error ? e.message : 'The workspace could not be loaded.');
      } finally {
        polling = false;
        if (active && request === inspectionRequest.current) setLoading(false);
      }
    };
    void poll();
    const timer = setInterval(poll, 2500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [employee.id]);
  useEffect(() => {
    if (editing) {
      contentRef.current?.focus();
      contentRef.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [editing?.id]);
  async function action(fn: () => Promise<unknown>, success = '') {
    if (actionPending.current) return;
    actionPending.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
      setNotice(success);
      try {
        await refresh();
      } catch (e) {
        setInspectionError(e instanceof Error ? e.message : 'Updated records could not be loaded.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'This action could not be completed.');
    } finally {
      actionPending.current = false;
      setBusy(false);
    }
  }
  const session = data?.session;
  const active = !!session && ['queued', 'running', 'waiting_for_approval'].includes(session.status);
  const name = (id: string) => employees.find((person) => person.id === id)?.name ?? 'Former teammate';
  const memorySessionId = editing?.sessionId ?? session?.id;
  const memoryDisabledReason = !window.ahq
    ? 'Open the desktop app to save memory.'
    : loading
      ? 'Wait for the employee workspace to load.'
      : !data
        ? 'Load the employee workspace before saving memory.'
        : !config.memory.enabled
          ? 'Enable memory in the employee configuration to save an entry.'
          : !config.memory.kinds.includes(kind)
            ? 'Choose a memory kind enabled in the employee configuration.'
            : !config.memory.scopes.includes(scope)
              ? 'Choose a memory scope enabled in the employee configuration.'
              : scope === 'session' && !memorySessionId
                ? 'Start a session before adding session memory.'
                : '';
  const canSaveMemory = !memoryDisabledReason;
  const unread =
    data?.messages.filter((message) => message.toEmployeeId === employee.id && message.status === 'queued')
      .length ?? 0;
  const saveMemory = () => {
    if (!canSaveMemory || !content.trim() || busy) return;
    void action(
      async () => {
        await window.ahq!.saveAgentMemory({
          employeeId: employee.id,
          id: editing?.id,
          memory: {
            kind,
            scope,
            content: content.trim(),
            ...(scope === 'session' ? { sessionId: memorySessionId } : {}),
          },
        });
        setEditing(null);
        setContent('');
      },
      editing ? 'Memory updated.' : 'Memory saved.',
    );
  };
  return (
    <section className="agent-workspace" aria-label={`${employee.name} agent workspace`}>
      <header className="aw-heading">
        <div className="aw-emblem">
          <Brain size={21} />
        </div>
        <div>
          <span className="aw-eyebrow">EMPLOYEE OPERATING SYSTEM</span>
          <h3>A mind with a workspace.</h3>
        </div>
        <span className={`aw-state ${active ? 'active' : ''}`}>
          <i />
          {!window.ahq
            ? 'Desktop required'
            : loading
              ? 'Loading workspace'
              : inspectionError
                ? 'Refresh needed'
                : session
                  ? session.status.replaceAll('_', ' ')
                  : data
                    ? 'No session started'
                    : 'Workspace unavailable'}
        </span>
      </header>
      <div className="aw-tabs" role="tablist" aria-label="Employee workspace">
        {panels.map(({ id, label, icon: Icon }, index) => (
          <button
            type="button"
            key={id}
            role="tab"
            id={`${workspaceId}-tab-${id}`}
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            tabIndex={tab === id ? 0 : -1}
            aria-selected={tab === id}
            aria-controls={`${workspaceId}-panel`}
            onClick={() => setTab(id)}
            onKeyDown={(event) => {
              const next =
                event.key === 'ArrowRight'
                  ? (index + 1) % panels.length
                  : event.key === 'ArrowLeft'
                    ? (index + panels.length - 1) % panels.length
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? panels.length - 1
                        : undefined;
              if (next === undefined) return;
              event.preventDefault();
              setTab(panels[next].id);
              tabRefs.current[next]?.focus();
            }}
          >
            <Icon size={15} aria-hidden="true" />
            {label}
            {id === 'memory' && !!data?.memories.length && <b>{data.memories.length}</b>}
            {id === 'inbox' && unread > 0 && <b aria-label={`${unread} unread messages`}>{unread}</b>}
          </button>
        ))}
      </div>
      <div
        className="aw-body"
        id={`${workspaceId}-panel`}
        role="tabpanel"
        aria-labelledby={`${workspaceId}-tab-${tab}`}
        tabIndex={0}
        aria-busy={loading}
      >
        {!window.ahq && (
          <div className="aw-note">
            Open Astra HQ desktop to run real sessions and inspect saved memory, messages, and artifacts.
          </div>
        )}
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        {inspectionError && (
          <div className="aw-load-error" role="alert">
            <p>
              {inspectionError} {data ? 'Showing the last loaded records.' : 'Saved records are unavailable.'}
            </p>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => void action(async () => undefined)}
            >
              Try again
            </button>
          </div>
        )}
        {loading && (
          <p className="aw-note" role="status">
            <LoaderCircle size={14} className="spin" aria-hidden="true" /> Loading saved workspace…
          </p>
        )}
        {notice && (
          <p className="aw-feedback" role="status">
            {notice}
          </p>
        )}
        {tab === 'session' && (
          <>
            <div className="aw-brain">
              <div>
                <span className="aw-eyebrow">BRAIN</span>
                <strong>GPT-6 Astra</strong>
                <small>
                  {session?.config?.reasoning ?? config.reasoning} reasoning · configuration v
                  {session?.configRevision ?? config.revision}
                </small>
              </div>
              <Brain size={34} strokeWidth={1.2} />
            </div>
            <div className="aw-metrics">
              <div>
                <strong>
                  {session?.usage?.turns ?? '—'}
                  <small> / {session?.config?.limits.maxTurns ?? config.limits.maxTurns}</small>
                </strong>
                <span>Agent turns</span>
              </div>
              <div>
                <strong>
                  {session?.usage?.toolCalls ?? '—'}
                  <small> / {session?.config?.limits.maxToolCalls ?? config.limits.maxToolCalls}</small>
                </strong>
                <span>Tool calls</span>
              </div>
              <div>
                <strong>{session?.usage ? session.usage.totalTokens.toLocaleString() : '—'}</strong>
                <span>Tokens used</span>
              </div>
            </div>
            {session ? (
              <>
                <div className="aw-session-id">
                  <code>{session.id}</code>
                  <button
                    type="button"
                    title="Refresh session"
                    aria-label="Refresh session"
                    disabled={busy}
                    onClick={() => void action(async () => undefined)}
                  >
                    <RefreshCw size={14} />
                  </button>
                </div>
                <p className="aw-note">{session.activity}</p>
                {session.configRevision !== undefined && session.configRevision !== config.revision && (
                  <p className="aw-note">
                    This run uses configuration v{session.configRevision}. Your saved configuration v
                    {config.revision} applies on the next manager turn.
                  </p>
                )}
                <div className="aw-section-title">
                  Observed tool activity <small>{session.toolCalls?.length ?? 0} receipts</small>
                </div>
                {session.toolCalls?.length ? (
                  <div className="aw-timeline">
                    {session.toolCalls
                      .slice(-12)
                      .reverse()
                      .map((call) => (
                        <div className={`aw-tool ${call.status}`} key={call.id}>
                          <span className="aw-tool-dot">
                            {call.status === 'completed' ? <Check size={11} /> : <X size={11} />}
                          </span>
                          <div>
                            <strong>{call.name.replaceAll('_', ' ')}</strong>
                            <p>{call.summary}</p>
                            <small>
                              {stamp(call.time)} · {call.status}
                            </small>
                          </div>
                        </div>
                      ))}
                  </div>
                ) : (
                  <p className="aw-empty">Tool receipts appear here when Astra actually uses a tool.</p>
                )}
                {active && (
                  <button
                    type="button"
                    className="button secondary aw-stop"
                    disabled={busy}
                    onClick={() => void action(() => window.ahq!.cancelSession(session.id))}
                  >
                    <Square size={12} />
                    Stop this run
                  </button>
                )}
              </>
            ) : data ? (
              <div className="aw-empty">
                <Activity size={24} />
                <strong>The first assignment starts a real session.</strong>
                <p>
                  Conversation history continues between assignments. Tools, memory, and communication follow
                  the settings you choose.
                </p>
              </div>
            ) : null}
          </>
        )}
        {tab === 'memory' && (
          <>
            <div className="aw-section-title">
              What {employee.name} remembers <small>{config.memory.write} writes</small>
            </div>
            <p className="aw-note">
              Session memory stays with one conversation. Employee memory stays private. Workspace memory is
              shared with permitted teammates. Proposed memories are inactive until approved.
            </p>
            {!config.memory.enabled && (
              <p className="aw-note">
                Memory is disabled. Existing entries remain inspectable; enable memory in configuration to use
                them.
              </p>
            )}
            <div className="aw-memory-list">
              {data?.memories.map((memory) => (
                <article className="aw-memory" key={memory.id}>
                  <div className="aw-tags">
                    <span>{memory.kind}</span>
                    <span>{memory.scope}</span>
                    <span className={memory.status}>{memory.status}</span>
                  </div>
                  <p>{memory.content}</p>
                  <small>
                    {memory.provenance.actor === 'user'
                      ? 'Added by you'
                      : `From agent turn ${memory.provenance.turn ?? '—'}`}{' '}
                    · expires {stamp(memory.expiresAt)}
                  </small>
                  <div className="aw-actions">
                    {memory.status === 'proposed' && (
                      <button
                        type="button"
                        disabled={
                          busy ||
                          !config.memory.enabled ||
                          !config.memory.kinds.includes(memory.kind) ||
                          !config.memory.scopes.includes(memory.scope)
                        }
                        onClick={() =>
                          void action(
                            () => window.ahq!.approveAgentMemory({ employeeId: employee.id, id: memory.id }),
                            'Memory approved.',
                          )
                        }
                      >
                        <Check size={13} />
                        Approve
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setEditing(memory);
                        setKind(memory.kind);
                        setScope(memory.scope);
                        setContent(memory.content);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          await window.ahq!.forgetAgentMemory({ employeeId: employee.id, id: memory.id });
                          if (editing?.id === memory.id) {
                            setEditing(null);
                            setContent('');
                          }
                        }, 'Memory removed.')
                      }
                    >
                      <Trash2 size={13} />
                      Forget
                    </button>
                  </div>
                </article>
              ))}
            </div>
            {data && !data.memories.length && (
              <p className="aw-empty">
                A clean slate. Add a preference or let your employee propose a memory during work.
              </p>
            )}
            <div
              className="aw-memory-editor"
              role="group"
              aria-label={editing ? 'Edit memory' : 'Add memory'}
            >
              <div className="aw-section-title">
                {editing ? 'Edit memory' : 'Give them something to remember'}
              </div>
              <div className="aw-memory-fields">
                <label>
                  Kind
                  <select
                    disabled={busy || !window.ahq}
                    value={kind}
                    onChange={(event) => setKind(event.target.value as MemoryKind)}
                  >
                    {[...new Set([...config.memory.kinds, kind])].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Scope
                  <select
                    disabled={busy || !window.ahq}
                    value={scope}
                    onChange={(event) => setScope(event.target.value as MemoryScope)}
                  >
                    {[...new Set([...config.memory.scopes, scope])].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="aw-memory-content">
                Memory
                <textarea
                  ref={contentRef}
                  disabled={busy || !window.ahq}
                  aria-describedby={`${workspaceId}-memory-help`}
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  rows={3}
                  maxLength={30000}
                  placeholder="For example: keep client updates under 200 words and lead with the decision."
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                      event.preventDefault();
                      saveMemory();
                    }
                  }}
                />
              </label>
              <p className="aw-note" id={`${workspaceId}-memory-help`}>
                {memoryDisabledReason ||
                  'Save with the button or ⌘/Ctrl + Enter. Memory added by you is active immediately.'}
              </p>
              <div className="aw-actions">
                {editing && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setEditing(null);
                      setContent('');
                    }}
                  >
                    Cancel edit
                  </button>
                )}
                <button
                  type="button"
                  className="button primary"
                  disabled={busy || !content.trim() || !canSaveMemory}
                  onClick={saveMemory}
                >
                  {busy ? <LoaderCircle size={14} className="spin" /> : <Save size={14} />}Save memory
                </button>
              </div>
            </div>
          </>
        )}
        {tab === 'inbox' && (
          <>
            <div className="aw-section-title">
              Conversations between teammates{' '}
              <small>{data ? `${data.messages.length} messages` : 'Not loaded'}</small>
            </div>
            <p className="aw-note">
              {!config.communication.receiveMessages
                ? 'Receiving messages is disabled in this employee’s configuration.'
                : config.communication.receiveMessages &&
                    config.communication.autoRespond &&
                    config.autonomy.initiative === 'on-message'
                  ? 'New messages can wake this employee automatically within your handoff limit.'
                  : 'Incoming messages wait for the next assignment. Enable automatic responses and on-message initiative to allow wakeups.'}
            </p>
            {data?.messages
              .slice()
              .reverse()
              .map((message) => (
                <article className="aw-letter" key={message.id}>
                  <div className="aw-letter-heading">
                    {message.toEmployeeId === employee.id ? (
                      <ArrowDownLeft size={16} />
                    ) : (
                      <ArrowUpRight size={16} />
                    )}
                    <strong>
                      {name(message.fromEmployeeId)} → {name(message.toEmployeeId)}
                    </strong>
                    <span className={`aw-delivery ${message.status}`}>{message.status}</span>
                  </div>
                  <p>{message.text}</p>
                  <small>
                    {stamp(message.createdAt)} · handoff {message.depth}
                    {message.acknowledgedAt ? ` · acknowledged ${stamp(message.acknowledgedAt)}` : ''}
                  </small>
                </article>
              ))}
            {data && !data.messages.length && (
              <div className="aw-empty">
                <Inbox size={24} />
                <strong>No internal messages yet.</strong>
                <p>
                  Astra can ask teammates for help using its communication tools. Each message has a delivery
                  receipt.
                </p>
              </div>
            )}
          </>
        )}
        {tab === 'artifacts' && (
          <>
            <div className="aw-section-title">
              Work that stays <small>{data ? `${data.artifacts.length} artifacts` : 'Not loaded'}</small>
            </div>
            <p className="aw-note">
              Documents saved by this employee, with the session and tool call that created them.
            </p>
            {data?.artifacts.map((item) => (
              <button
                type="button"
                disabled={busy}
                className="aw-artifact"
                key={item.id}
                onClick={() =>
                  void action(async () =>
                    setArtifact(
                      await window.ahq!.readAgentArtifact({ employeeId: employee.id, id: item.id }),
                    ),
                  )
                }
              >
                <FileText size={22} />
                <span>
                  <strong>{item.title}</strong>
                  <small>
                    {stamp(item.createdAt)} · {item.mediaType}
                  </small>
                </span>
                <ArrowUpRight size={16} />
              </button>
            ))}
            {data && !data.artifacts.length && (
              <div className="aw-empty">
                <FileText size={24} />
                <strong>The work has a home.</strong>
                <p>
                  Enable artifact writing and ask Astra to save a brief, a plan, or an analysis. Saved
                  documents appear here.
                </p>
              </div>
            )}
            {artifact && (
              <article className="aw-artifact-preview">
                <div className="aw-section-title">
                  {artifact.title}
                  <button type="button" aria-label="Close artifact" onClick={() => setArtifact(null)}>
                    <X size={15} />
                  </button>
                </div>
                <pre>{artifact.content}</pre>
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() =>
                    void action(() =>
                      window.ahq!.exportDocument({ title: artifact.title, content: artifact.content }),
                    )
                  }
                >
                  <FileText size={14} />
                  Export document
                </button>
              </article>
            )}
          </>
        )}
      </div>
    </section>
  );
}
