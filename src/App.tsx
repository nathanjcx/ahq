import sampleSales from "../demo-data/custom-arrival/sales.csv?raw";
import { messageDemoAction } from './shared/demo-labels';
import { AI_NEWS_ACCOUNTS } from './shared/news';
import {
  AlertCircle,
  Archive,
  Bell,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clock3,
  Code2,
  ExternalLink,
  FileText,
  Gauge,
  History as HistoryIcon,
  Inbox,
  LogIn,
  LogOut,
  Mail,
  MessageCircle,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Repeat2,
  RotateCcw,
  Save,
  Search,
  Send,
  Settings as SettingsIcon,
  Slack,
  Sparkles,
  Trash2,
  UserCircle,
  Volume2,
  VolumeX,
  X,
  Zap,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { bridge } from "./client";
import OfficeCanvas from "./components/OfficeCanvas";
import type {
  Agent,
  Artifact,
  CalendarEvent,
  Command,
  Routine,
  ReplayEntry,
  Snapshot,
  Source,
  SourceItem,
  SourceAttachment,
  WorkItem,
} from "./shared/types";

type Tab = "office" | "tasks" | "inbox" | "calendar" | "routines" | "history" | "settings";
type Composer = { kind: "simulation" | "calendar" } | { kind: "message"; templateId?: string };
type Toast = { id: number; message: string; tone: "error" | "success" };

const NAV: { id: Tab; label: string; icon: typeof Building2 }[] = [
  { id: "office", label: "Office", icon: Building2 },
  { id: "inbox", label: "Inbox", icon: Inbox },
  { id: "tasks", label: "Tasks", icon: CheckCircle2 },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "routines", label: "Routines", icon: Repeat2 },
  { id: "history", label: "History", icon: HistoryIcon },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

const SOURCES: {
  id: Source;
  label: string;
  short: string;
  icon: typeof Mail;
}[] = [
  { id: "gmail", label: "Gmail", short: "G", icon: Mail },
  { id: "calendar", label: "Calendar", short: "C", icon: CalendarDays },
  { id: "imessage", label: "iMessage", short: "i", icon: MessageCircle },
  { id: "slack", label: "Slack", short: "S", icon: Slack },
  { id: "discord", label: "Discord", short: "D", icon: MessageCircle },
  { id: "linear", label: "Linear", short: "L", icon: CircleDot },
  { id: "asana", label: "Asana", short: "A", icon: CheckCircle2 },
];

const SOURCE_META = Object.fromEntries(
  SOURCES.map((source) => [source.id, source]),
) as Record<Source, (typeof SOURCES)[number]>;

function formatTime(timestamp?: number) {
  if (!timestamp) return "Not yet";
  const date = new Date(timestamp);
  const now = Date.now();
  const delta = now - timestamp;
  if (delta >= 0 && delta < 60_000) return "just now";
  if (delta >= 0 && delta < 3_600_000)
    return `${Math.floor(delta / 60_000)}m ago`;
  if (date.toDateString() === new Date().toDateString())
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function sentence(value: string) {
  return value
    .replace(/(^|[-_ ])\w/g, (part) => part.toUpperCase())
    .replace(/[-_]/g, " ");
}

function PixelAvatar({
  agent,
  size = "md",
}: {
  agent?: Agent;
  size?: "sm" | "md" | "lg";
}) {
  const color = agent?.color || "#d6c9aa";
  const hair = agent?.hair || "#43362f";
  const skin = agent?.skin || "#e4ad80";
  return (
    <span
      className={`pixel-avatar pixel-avatar--${size}`}
      aria-hidden="true"
      style={
        { "--shirt": color, "--hair": hair, "--skin": skin } as CSSProperties
      }
    >
      <span className="pixel-avatar__hair" />
      <span className="pixel-avatar__face" />
      <span className="pixel-avatar__body" />
      {agent?.accessory === "glasses" && (
        <span className="pixel-avatar__glasses" />
      )}
      {agent?.accessory === "headphones" && (
        <span className="pixel-avatar__phones" />
      )}
      {agent?.accessory === "cap" && <span className="pixel-avatar__cap" />}
    </span>
  );
}

function StatusDot({ status }: { status: string }) {
  return (
    <span className={`status-dot status-dot--${status}`} aria-hidden="true" />
  );
}

function EmptyState({
  icon,
  title,
  body,
}: {
  icon: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="empty-state">
      <span className="empty-state__icon">{icon}</span>
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
  wide = false,
  closeOnBackdrop = true,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  closeOnBackdrop?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = panel.current;
    if (node && !node.contains(document.activeElement)) {
      (node.querySelector<HTMLElement>('button, input, select, textarea, [href]') || node).focus();
    }
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
      if (event.key !== "Tab" || !node) return;
      const focusable = [
        ...node.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((item) => !item.hasAttribute("disabled"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === node || !node.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      }
      if (!event.shiftKey && (document.activeElement === last || document.activeElement === node || !node.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => closeOnBackdrop && event.target === event.currentTarget && onClose()}
    >
      <div
        ref={panel}
        className={`modal ${wide ? "modal--wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <div className="modal__top">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("office");
  const [busy, setBusy] = useState<string | null>("snapshot");
  const [fatalError, setFatalError] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [selectedWorkId, setSelectedWorkId] = useState<string>();
  const [selectedAgentId, setSelectedAgentId] = useState<string>();
  const [selectedArtifactId, setSelectedArtifactId] = useState<string>();
  const [routineOpen, setRoutineOpen] = useState(false);
  const [editingRoutine, setEditingRoutine] = useState<Routine>();
  const [profileOpen, setProfileOpen] = useState(false);
  const [inboxTargetId, setInboxTargetId] = useState<string>();
  const [composer, setComposer] = useState<Composer>();
  const toastId = useRef(0);
  const revision = useRef(-1);
  const snapshotRef = useRef<Snapshot | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const audioUnlocked = useRef(false);

  const toast = useCallback((message: string, tone: Toast["tone"]) => {
    const id = ++toastId.current;
    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(
      () => setToasts((current) => current.filter((item) => item.id !== id)),
      4200,
    );
  }, []);

  const playChime = useCallback(() => {
    const context = audioContext.current;
    if (!context || !audioUnlocked.current || context.state !== "running")
      return;
    const now = context.currentTime;
    [523.25, 659.25].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = frequency;
      oscillator.type = "sine";
      gain.gain.setValueAtTime(0.0001, now + index * 0.09);
      gain.gain.exponentialRampToValueAtTime(0.055, now + index * 0.09 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.09 + 0.22);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now + index * 0.09);
      oscillator.stop(now + index * 0.09 + 0.24);
    });
  }, []);

  const acceptSnapshot = useCallback(
    (next: Snapshot) => {
      if (next.revision < revision.current) return;
      const previous = snapshotRef.current;
      revision.current = next.revision;
      snapshotRef.current = next;
      setSnapshot(next);
      if (
        previous?.settings.sound &&
        next.work.some(
          (work) =>
            work.status === "completed" &&
            !previous.work.some(
              (old) => old.id === work.id && old.status === "completed",
            ),
        )
      )
        playChime();
    },
    [playChime],
  );

  useEffect(() => {
    let alive = true;
    const unsubscribe = bridge.subscribe(
      (next) => alive && acceptSnapshot(next),
    );
    bridge
      .command({ type: "snapshot" })
      .then((next) => {
        if (alive) {
          acceptSnapshot(next);
          setFatalError("");
        }
      })
      .catch(
        (error: unknown) =>
          alive &&
          setFatalError(
            error instanceof Error
              ? error.message
              : "Little Office could not connect to its local runtime.",
          ),
      )
      .finally(() => alive && setBusy(null));
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [acceptSnapshot]);

  const run = useCallback(
    async (command: Command, key: string = command.type, success?: string) => {
      if (!audioContext.current) audioContext.current = new AudioContext();
      if (audioContext.current.state === "suspended")
        void audioContext.current.resume();
      audioUnlocked.current = true;
      setBusy(key);
      try {
        const next = await bridge.command(command);
        acceptSnapshot(next);
        if (success) toast(success, "success");
        return next;
      } catch (error) {
        toast(
          error instanceof Error
            ? error.message
            : "That action did not finish.",
          "error",
        );
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [acceptSnapshot, toast],
  );

  const openWork = useCallback((id: string) => {
    setSelectedAgentId(undefined);
    setSelectedArtifactId(undefined);
    setSelectedWorkId(id);
  }, []);

  const openArtifact = useCallback(
    (id: string) => {
      const artifact = snapshot?.artifacts.find((item) => item.id === id);
      setSelectedArtifactId(id);
      setSelectedAgentId(undefined);
      if (artifact) setSelectedWorkId(artifact.workId);
    },
    [snapshot],
  );

  const openSource = useCallback((id: string) => {
    setSelectedWorkId(undefined);
    setSelectedAgentId(undefined);
    setSelectedArtifactId(undefined);
    setInboxTargetId(id);
    setActiveTab("inbox");
  }, []);

  if (!snapshot) {
    return (
      <main className="boot-screen">
        <div className="boot-mark">
          <Building2 size={30} />
        </div>
        <h1>Little Office</h1>
        {fatalError ? (
          <>
            <p>{fatalError}</p>
            <button
              className="button button--primary"
              onClick={() => window.location.reload()}
            >
              <RefreshCw size={15} /> Try again
            </button>
          </>
        ) : (
          <>
            <span className="loader" />
            <p>Opening the office...</p>
          </>
        )}
      </main>
    );
  }

  const activeWorkers = snapshot.agents.filter(
    (agent) => !agent.retiredAt && agent.activity !== "idle" && agent.activity !== "waiting",
  ).length;
  const pendingInbox = snapshot.sources.filter(
    (item) => !item.disposition || item.disposition === "pending",
  ).length;
  const attention = snapshot.work.filter(
    (work) => work.status === "failed" || work.status === "waiting",
  ).length;
  const selectedWork = snapshot.work.find((work) => work.id === selectedWorkId) ||
    (selectedAgentId ? [...snapshot.work].reverse().find((work) => work.agentId === selectedAgentId) : undefined);
  const selectedAgent = selectedWork
    ? snapshot.agents.find((agent) => agent.id === selectedWork.agentId)
    : snapshot.agents.find((agent) => agent.id === selectedAgentId);

  return (
    <div
      className={`app ${snapshot.settings.reducedMotion ? "reduce-motion" : ""}`}
    >
      <header className="topbar">
        <button
          className="brand"
          onClick={() => setActiveTab("office")}
          aria-label="Go to office"
        >
          <span className="brand__mark">
            <Building2 size={18} />
          </span>
          <span>Little Office</span>
        </button>
        <div className="topbar__status">
          <span className="mode-badge">Demo data</span>
          <span className="mode-badge mode-badge--live">Codex execution</span>
          <span className="workers">
            <span className="live-dot" />
            {activeWorkers} working
          </span>
        </div>
        <div className="topbar__actions">
          <button
            className="button button--sunny top-new"
            onClick={() => setRoutineOpen(true)}
          >
            <Plus size={16} /> New routine
          </button>
          <button
            className="icon-button notification-button"
            onClick={() => setActiveTab(attention ? "history" : "inbox")}
            aria-label={
              attention ? `${attention} items need attention` : "Open inbox"
            }
          >
            <Bell size={18} />
            {(attention || pendingInbox) > 0 && (
              <span className="notification-count">
                {attention || pendingInbox}
              </span>
            )}
          </button>
          <button
            className="profile-button"
            onClick={() => setProfileOpen((value) => !value)}
            aria-expanded={profileOpen}
          >
            <UserCircle size={24} />
            <span>
              {snapshot.auth.status === "signed-in"
                ? snapshot.auth.email?.split("@")[0]
                : "Local desk"}
            </span>
            <ChevronDown size={14} />
          </button>
          {profileOpen && (
            <div className="profile-menu">
              <p className="eyebrow">ChatGPT</p>
              <strong>
                {snapshot.auth.status === "signed-in"
                  ? snapshot.auth.email
                  : "Not signed in"}
              </strong>
              {snapshot.auth.plan && <span>{snapshot.auth.plan} plan</span>}
              <button
                onClick={() => {
                  setActiveTab("settings");
                  setProfileOpen(false);
                }}
              >
                <SettingsIcon size={15} /> Account settings
              </button>
            </div>
          )}
        </div>
      </header>

      <aside className="nav-rail" aria-label="Main navigation">
        <nav>
          {NAV.map((item) => {
            const Icon = item.icon;
            const count =
              item.id === "inbox"
                ? pendingInbox
                : item.id === "history"
                  ? attention
                  : 0;
            return (
              <button
                key={item.id}
                className={activeTab === item.id ? "active" : ""}
                onClick={() => setActiveTab(item.id)}
                aria-current={activeTab === item.id ? "page" : undefined}
              >
                <span className="nav-icon">
                  <Icon size={19} />
                  {count > 0 && <i>{count}</i>}
                </span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="rail-bottom">
          <button
            onClick={() =>
              run({
                type: "settings.update",
                settings: { sound: !snapshot.settings.sound },
              })
            }
            aria-label={
              snapshot.settings.sound ? "Mute sounds" : "Turn sounds on"
            }
          >
            {snapshot.settings.sound ? (
              <Volume2 size={18} />
            ) : (
              <VolumeX size={18} />
            )}
            <span>Sound</span>
          </button>
          <div className="rail-note">
            <Sparkles size={14} />
            <span>V1</span>
          </div>
        </div>
      </aside>

      <div className={`workspace workspace--${activeTab}`}>
        {activeTab === "office" && (
          <OfficeView
            snapshot={snapshot}
            run={run}
            busy={busy}
            selectedAgentId={selectedAgentId}
            onSelectAgent={(id) => {
              setSelectedAgentId(id);
              setSelectedWorkId(
                snapshot.agents.find((agent) => agent.id === id)?.workId,
              );
            }}
            onOpenWork={openWork}
            onOpenArtifact={openArtifact}
            onOpenCalendar={() => setActiveTab("calendar")}
            onSimulate={() => setComposer({ kind: "simulation" })}
          />
        )}
        {activeTab === "inbox" && (
          <InboxView
            snapshot={snapshot}
            run={run}
            busy={busy}
            targetId={inboxTargetId}
            onCompose={() => setComposer({ kind: "message" })}
            onOpenWork={openWork}
            onOpenArtifact={openArtifact}
          />
        )}
        {activeTab === "routines" && (
          <RoutinesView
            onOpenWork={openWork}
            onOpenArtifact={openArtifact}
            snapshot={snapshot}
            run={run}
            busy={busy}
            onCreate={() => {
              setEditingRoutine(undefined);
              setRoutineOpen(true);
            }}
            onEdit={(routine) => {
              setEditingRoutine(routine);
              setRoutineOpen(true);
            }}
          />
        )}
        {activeTab === "tasks" && <TasksView snapshot={snapshot} onOpenWork={openWork} onOpenSource={openSource} onOpenArtifact={openArtifact} />}
        {activeTab === "calendar" && <CalendarView snapshot={snapshot} onOpenArtifact={openArtifact} run={run} busy={busy} onOpenSource={openSource} onOpenWork={openWork} onCreate={() => setComposer({ kind: "calendar" })} />}
        {activeTab === "history" && (
          <HistoryView snapshot={snapshot} onOpenWork={openWork} />
        )}
        {activeTab === "settings" && (
          <SettingsView snapshot={snapshot} run={run} busy={busy} />
        )}
      </div>

      {composer?.kind === "simulation" && <SimulationModal snapshot={snapshot} busy={busy} run={run} onClose={() => setComposer(undefined)} onMessage={() => setComposer({ kind: "message" })} onCalendar={() => setComposer({ kind: "calendar" })} onTemplate={(id) => setComposer({ kind: "message", templateId: id })} />}
      {composer?.kind === "message" && <IncomingMessageModal key={composer.templateId || "new-message"} run={run} busy={busy} signedIn={snapshot.auth.status === "signed-in"} template={snapshot.demo.events?.find((entry) => entry.id === composer.templateId)} onClose={() => setComposer(undefined)} onCreated={(id) => { setComposer(undefined); if (activeTab === "inbox") setInboxTargetId(id); }} />}
      {composer?.kind === "calendar" && <CalendarEventModal snapshot={snapshot} run={run} busy={busy} onClose={() => setComposer(undefined)} />}
      {routineOpen && (
        <RoutineModal
          snapshot={snapshot}
          busy={busy}
          run={run}
          routine={editingRoutine}
          onClose={() => {
            setRoutineOpen(false);
            setEditingRoutine(undefined);
          }}
        />
      )}
      {(selectedWork || selectedAgent) && (
        <WorkDrawer key={selectedWork?.id || selectedAgent?.id}
          snapshot={snapshot}
          work={selectedWork}
          agent={selectedAgent}
          initialArtifactId={selectedArtifactId}
          busy={busy}
          run={run}
          onOpenArtifact={openArtifact}
          onOpenSource={openSource}
          onOpenWork={openWork}
          onError={(message) => toast(message, "error")}
          onClose={() => {
            setSelectedWorkId(undefined);
            setSelectedAgentId(undefined);
            setSelectedArtifactId(undefined);
          }}
        />
      )}

      <div className="toast-stack" aria-live="polite">
        {toasts.map((item) => (
          <div key={item.id} className={`toast toast--${item.tone}`}>
            {item.tone === "error" ? (
              <AlertCircle size={17} />
            ) : (
              <Check size={17} />
            )}
            {item.message}
          </div>
        ))}
      </div>
    </div>
  );
}

type RunCommand = (
  command: Command,
  key?: string,
  success?: string,
) => Promise<Snapshot | undefined>;

function OfficeView({
  snapshot,
  run,
  busy,
  selectedAgentId,
  onSelectAgent,
  onOpenWork,
  onOpenArtifact,
  onOpenCalendar,
  onSimulate,
}: {
  snapshot: Snapshot;
  run: RunCommand;
  busy: string | null;
  selectedAgentId?: string;
  onSelectAgent: (id: string) => void;
  onOpenWork: (id: string) => void;
  onOpenArtifact: (id: string) => void;
  onOpenCalendar: () => void;
  onSimulate: () => void;
}) {
  const arrivalTemplates = snapshot.demo.events || [];
  const signedIn = snapshot.auth.status === "signed-in";
  const visibleAgents = snapshot.agents.filter((agent) => !agent.retiredAt && (agent.temporary || agent.persistent || agent.id === "agent-maya" || agent.activity !== "idle"));
  const [boardText, setBoardText] = useState("");
  const active = visibleAgents.filter((agent) => agent.activity !== "idle");
  const resting = visibleAgents.filter((agent) => agent.activity === "idle");
  const recent = [...snapshot.activity]
    .sort((a, b) => b.sequence - a.sequence)
    .slice(0, 7);
  const failures = snapshot.work.filter(
    (item) => item.status === "failed" || item.status === "waiting",
  );
  const finished = snapshot.artifacts
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 5);
  const selectStation = (station: string) => {
    if (station.toLowerCase().includes("calendar")) { onOpenCalendar(); return; }
    const target = station.toLowerCase().includes("board")
      ? "office-board"
      : "finished-shelf";
    document.getElementById(target)?.scrollIntoView({
      behavior: snapshot.settings.reducedMotion ? "auto" : "smooth",
      block: "nearest",
    });
  };
  const postToBoard = async (event: FormEvent) => {
    event.preventDefault();
    if (!boardText.trim()) return;
    const next = await run(
      { type: "board.post", text: boardText.trim() },
      "board.post",
      "Posted to the board.",
    );
    if (next) setBoardText("");
  };
  return (
    <div className="office-layout">
      <main className="office-main">
        <section className="office-intro">
          <div>
            <p className="eyebrow">Live office</p>
            <h1>Your team at work</h1>
          </div>
          <button className="button button--primary" onClick={onSimulate}><Plus size={16} /> Simulate an arrival</button>
        </section>

        <div className="triage-mode"><Sparkles size={15} /><span>Demo data · Codex triage and execution</span><small>{signedIn ? `${arrivalTemplates.filter((event) => event.delivered).length} / ${arrivalTemplates.length} suggestions delivered` : "Sign in with ChatGPT in Settings to triage incoming events."}</small></div>
        <section className="roster" aria-label="Agent roster">
          <span className="roster__label">In the office</span>
          <div className="roster__people">
            {active.map((agent) => (
              <button
                key={agent.id}
                className={selectedAgentId === agent.id ? "selected" : ""}
                onClick={() => onSelectAgent(agent.id)}
              >
                <PixelAvatar agent={agent} size="sm" />
                <span>
                  <strong>{agent.name}</strong>
                  <small>{agent.temporary ? "Task worker · " : agent.persistent ? "Recurring · " : ""}{agent.statusText}</small>
                </span>
                <StatusDot status={agent.activity} />
              </button>
            ))}
            {resting.map((agent) => (
              <button
                key={agent.id}
                className="resting"
                onClick={() => onSelectAgent(agent.id)}
              >
                <PixelAvatar agent={agent} size="sm" />
                <span>
                  <strong>{agent.name}</strong>
                  <small>Resting</small>
                </span>
              </button>
            ))}
            {!snapshot.agents.length && (
              <span className="muted">The office is quiet.</span>
            )}
          </div>
        </section>

        <section className="canvas-card">
          <OfficeCanvas
            agents={visibleAgents}
            selectedAgentId={selectedAgentId}
            reducedMotion={snapshot.settings.reducedMotion}
            onSelectAgent={onSelectAgent}
            onSelectStation={selectStation}
          />
          <div className="canvas-caption">
            <span>
              <i className="live-dot" />
              Office floor
            </span>
            <span>
              {active.filter((agent) => agent.activity !== "waiting").length} active · {active.filter((agent) => agent.activity === "waiting").length} waiting
            </span>
          </div>
        </section>

        <section className="office-activity" aria-label="Recent office activity">
          <div className="recent-strip">
            <span className="eyebrow">Recent activity</span>
            <div>
              {recent.length ? (
                recent.slice(0, 3).map((event) => (
                  <button
                    key={event.id}
                    onClick={() => event.workId && onOpenWork(event.workId)}
                    disabled={!event.workId}
                  >
                    <StatusDot status={event.kind} />
                    <span>{event.text}</span>
                    <time>{formatTime(event.timestamp)}</time>
                  </button>
                ))
              ) : (
                <span className="muted">
                  Activity will appear as work starts.
                </span>
              )}
            </div>
          </div>
        </section>
      </main>

      <aside className="board-panel" id="office-board">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">From the team</p>
            <h2>Office board</h2>
          </div>
          <span className="count-pill">{snapshot.board.length}</span>
        </div>
        <TriageQueue snapshot={snapshot} onOpenWork={onOpenWork} />
        <div className="board-posts">
          {[...snapshot.board]
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, 20)
            .map((post) => {
              const agent = snapshot.agents.find(
                (item) => item.id === post.agentId,
              );
              const parent = snapshot.board.find(item => item.id === post.replyTo);
              const speaker = snapshot.agents.find(item => item.id === parent?.agentId);
              return (
                <article className="board-post" key={post.id}>
                  <PixelAvatar agent={agent} size="sm" />
                  <div>
                    <div className="board-post__meta">
                      <strong>{agent?.name || "Office"}</strong>
                      <span className={`post-kind post-kind--${post.kind}`}>
                        {post.simulated ? "Simulated chat" : post.kind}
                      </span>
                      <time>{formatTime(post.timestamp)}</time>
                    </div>
                    {parent && <div className="board-reply">Replying to {speaker?.name.split(" ")[0] || "Office"}: {parent.text}</div>}
                    <p>{post.text}</p>
                    {(post.workId || post.artifactId) && (
                      <button
                        className="text-link"
                        onClick={() =>
                          post.artifactId
                            ? onOpenArtifact(post.artifactId)
                            : post.workId && onOpenWork(post.workId)
                        }
                      >
                        {post.artifactId ? "Open artifact" : "Open work"}
                        <ChevronRight size={14} />
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          {!snapshot.board.length && (
            <EmptyState
              icon={<MessageCircle size={20} />}
              title="The board is clear"
              body="Agent updates will collect here."
            />
          )}
        </div>
        <form className="board-compose" onSubmit={postToBoard}>
          <label htmlFor="board-note">Leave a note</label>
          <div>
            <input
              id="board-note"
              value={boardText}
              onChange={(event) => setBoardText(event.target.value)}
              placeholder="A note for the office"
            />
            <button
              className="icon-button icon-button--send"
              disabled={busy !== null || !boardText.trim()}
              aria-label="Post note"
            >
              <Send size={14} />
            </button>
          </div>
        </form>
        {finished.length > 0 && (
          <section className="shelf" id="finished-shelf">
            <div className="section-title">
              <span>Finished work</span>
              <span>{finished.length}</span>
            </div>
            {finished.map((artifact) => (
              <button
                key={artifact.id}
                onClick={() => onOpenArtifact(artifact.id)}
              >
                <span
                  className={`artifact-icon artifact-icon--${artifact.kind}`}
                >
                  <FileText size={15} />
                </span>
                <span>
                  <strong>{artifact.title}</strong>
                  <small>
                    {sentence(artifact.kind)} · {formatTime(artifact.createdAt)}
                  </small>
                </span>
                <ChevronRight size={15} />
              </button>
            ))}
          </section>
        )}
        {failures.length > 0 && (
          <section className="attention-box">
            <div className="section-title">
              <span>Needs attention</span>
              <span>{failures.length}</span>
            </div>
            {failures.map((work) => (
              <button key={work.id} onClick={() => onOpenWork(work.id)}>
                <AlertCircle size={16} />
                <span>
                  <strong>{work.title}</strong>
                  <small>{work.error || sentence(work.status)}</small>
                </span>
                <ChevronRight size={15} />
              </button>
            ))}
          </section>
        )}
      </aside>
    </div>
  );
}

function InboxView({
  snapshot,
  run,
  busy,
  targetId,
  onCompose,
  onOpenWork,
  onOpenArtifact,
}: {
  snapshot: Snapshot;
  run: RunCommand;
  busy: string | null;
  targetId?: string;
  onCompose: () => void;
  onOpenWork: (id: string) => void;
  onOpenArtifact: (id: string) => void;
}) {
  const [source, setSource] = useState<Source | "all">("all");
  const [selectedId, setSelectedId] = useState<string | undefined>(targetId);
  const [query, setQuery] = useState("");
  const filtered = snapshot.sources.filter(
    (item) =>
      (source === "all" || item.source === source) &&
      `${item.title} ${item.author} ${item.content}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  ).sort((a, b) => b.timestamp - a.timestamp);
  useEffect(() => {
    if (targetId) {
      setSelectedId(targetId);
      setSource("all");
      setQuery("");
    }
  }, [targetId]);
  const selected =
    filtered.find((item) => item.id === selectedId) || filtered[0];
  const linkedWork = selected
    ? snapshot.work.filter((work) => work.sourceIds.includes(selected.id))
    : [];
  const linkedArtifacts = snapshot.artifacts.filter((artifact) =>
    linkedWork.some((work) => work.id === artifact.workId),
  );
  return (
    <div className="page page--inbox">
      <PageHeader
        eyebrow="Connected sources"
        title="Inbox"
        description="Incoming messages, Codex decisions, and the work they started."
        action={<button className="button button--primary" onClick={onCompose}><Plus size={15} /> New incoming message</button>}
      />
      <div className="source-tabs" role="tablist" aria-label="Inbox sources">
        <button
          role="tab"
          aria-selected={source === "all"}
          className={source === "all" ? "active" : ""}
          onClick={() => setSource("all")}
        >
          <Archive size={16} />
          All <span>{snapshot.sources.length}</span>
        </button>
        {SOURCES.map((item) => {
          const Icon = item.icon;
          const count = snapshot.sources.filter(
            (sourceItem) => sourceItem.source === item.id,
          ).length;
          return (
            <button
              key={item.id}
              role="tab"
              aria-selected={source === item.id}
              className={source === item.id ? "active" : ""}
              onClick={() => setSource(item.id)}
            >
              <Icon size={16} />
              {item.label}
              <span>{count}</span>
            </button>
          );
        })}
      </div>
      <div className="inbox-grid">
        <section className="inbox-list">
          <label className="search-box">
            <Search size={16} />
            <span className="sr-only">Search inbox</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search messages"
            />
          </label>
          <div className="message-list">
            {filtered.map((item) => (
              <MessageRow
                key={item.id}
                item={item}
                demoLabel={messageDemoAction(item, snapshot.demo.events)}
                selected={selected?.id === item.id}
                onClick={() => setSelectedId(item.id)}
              />
            ))}
            {!filtered.length && (
              <EmptyState
                icon={<Inbox size={20} />}
                title="Nothing here"
                body="Try another source or search."
              />
            )}
          </div>
        </section>
        <section className="message-detail">
          {selected ? (
            <>
              <div className="message-detail__head">
                <span className={`source-logo source-logo--${selected.source}`}>
                  {SOURCE_META[selected.source].short}
                </span>
                <div>
                  <p className="eyebrow">
                    {SOURCE_META[selected.source].label}
                    {selected.channel ? ` · ${selected.channel}` : ""}
                  </p>
                  <h2>{selected.title}</h2>
                  <p className="demo-action">{messageDemoAction(selected, snapshot.demo.events)}</p>
                  <p>
                    {selected.author} · {formatTime(selected.timestamp)}
                  </p>
                </div>
                <span
                  className={`disposition disposition--${selected.disposition || "pending"}`}
                >
                  {selected.disposition || "pending"}
                </span>
              </div>
              <p className="thread-id">Thread ID <code>{selected.threadId}</code></p>
              <div className="message-copy">
                <p>{selected.content}</p>
              </div>
              <SourceAttachments attachments={selected.attachments} />
              <SourceTriage snapshot={snapshot} sourceId={selected.id} onOpenWork={onOpenWork} />
              {snapshot.sources.filter((item) => item.source === selected.source && item.threadId === selected.threadId && item.id !== selected.id).length > 0 && <details className="thread-context"><summary>Other messages in this thread</summary>{snapshot.sources.filter((item) => item.source === selected.source && item.threadId === selected.threadId && item.id !== selected.id).sort((a, b) => a.timestamp - b.timestamp).map((item) => <button key={item.id} onClick={() => { setSelectedId(item.id); setQuery(""); setSource("all"); }}><strong>{item.author} · {formatTime(item.timestamp)}</strong><span>{item.title}</span><small>{item.content.slice(0, 180)}</small></button>)}</details>}
              {selected.reason && !snapshot.triage.some((record) => record.sourceId === selected.id) && (
                <div className="evaluation-note">
                  <Sparkles size={16} />
                  <span>
                    <strong>Decision</strong>
                    {selected.reason}
                  </span>
                </div>
              )}
              {snapshot.auth.status !== "signed-in" && <p className="field-error">Sign in with ChatGPT in Settings to triage this message.</p>}
              <div className="detail-actions">
                <button
                  className="button button--primary"
                  disabled={busy !== null || snapshot.auth.status !== "signed-in" || selected.disposition === "triaging"}
                  onClick={() =>
                    run(
                      { type: "source.evaluate", id: selected.id },
                      `source.evaluate:${selected.id}`,
                      "Queued for Codex triage.",
                    )
                  }
                >
                  <Gauge size={15} /> {selected.disposition === "error" ? "Retry triage" : "Triage with Codex"}
                </button>
              </div>
              {linkedWork.length > 0 && (
                <div className="linked-section">
                  <h3>Linked work</h3>
                  {linkedWork.map((work) => (
                    <button
                      key={work.id}
                      className="linked-row"
                      onClick={() => onOpenWork(work.id)}
                    >
                      <StatusDot status={work.status} />
                      <span>
                        <strong>{work.title}</strong>
                        <small>{sentence(work.status)}</small>
                      </span>
                      <ChevronRight size={15} />
                    </button>
                  ))}
                </div>
              )}
              {linkedArtifacts.length > 0 && (
                <div className="linked-section">
                  <h3>Artifacts</h3>
                  {linkedArtifacts.map((artifact) => (
                    <button
                      key={artifact.id}
                      className="linked-row"
                      onClick={() => onOpenArtifact(artifact.id)}
                    >
                      <FileText size={16} />
                      <span>
                        <strong>{artifact.title}</strong>
                        <small>{sentence(artifact.kind)}</small>
                      </span>
                      <ExternalLink size={14} />
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <EmptyState
              icon={<Mail size={22} />}
              title="Choose a message"
              body="Its context and connected work will appear here."
            />
          )}
        </section>
      </div>
    </div>
  );
}

function followUpKind(entry: ReplayEntry, entries: ReplayEntry[]) {
  const item = entry.item;
  if (!item) return undefined;
  const previous = entries.slice(0, entries.indexOf(entry));
  if (previous.some((other) => other.item?.source === item.source && other.item.externalId === item.externalId)) return "Duplicate";
  if (/correct|revis/i.test(`${entry.label.replace(/^\[ACTION: [^\]]+\] /, "")} ${item.title}`)) return "Correction";
  if (/clarif|confirm|context|same|follow.?up|adds evidence/i.test(`${entry.label.replace(/^\[ACTION: [^\]]+\] /, "")} ${item.title}`) || previous.some((other) => other.item?.source === item.source && other.item.threadId === item.threadId)) return "Clarification";
  return undefined;
}

function SimulationModal({ snapshot, run, busy, onClose, onMessage, onCalendar, onTemplate }: { snapshot: Snapshot; run: RunCommand; busy: string | null; onClose: () => void; onMessage: () => void; onCalendar: () => void; onTemplate: (id: string) => void }) {
  const entries = snapshot.demo.events || [];
  const [category, setCategory] = useState<"suggested" | "follow-ups">("suggested");
  const [connection, setConnection] = useState<Source | "all">("all");
  const filtered = entries.filter(entry => connection === "all" || entry.source === connection);
  const suggested = filtered.filter((entry) => !followUpKind(entry, entries));
  const followUps = filtered.filter((entry) => followUpKind(entry, entries));
  const visible = category === "suggested" ? suggested : followUps;
  return <Modal title="Simulate an arrival" onClose={onClose} wide>
    <div className="simulation-panel">
      <p className="simulation-intro">Choose what arrives next. Preview and edit a message, then watch Codex decide what to do.</p>
      <div className="simulation-create">
        <button aria-label="New incoming message" onClick={onMessage}><span className="simulation-create__icon"><Mail size={20} /></span><span><strong>New incoming message</strong><small>Write an email, chat message, or issue.</small></span><Plus size={17} /></button>
        <button aria-label="New calendar event" onClick={onCalendar}><span className="simulation-create__icon"><CalendarDays size={20} /></span><span><strong>New calendar event</strong><small>Add a meeting and let the office prepare.</small></span><Plus size={17} /></button>
      </div>
      <label className="simulation-connection"><span>Connection</span><select aria-label="Arrival connection" value={connection} onChange={event => setConnection(event.target.value as Source | "all")}><option value="all">All connections · {entries.length}</option>{SOURCES.map(source => <option key={source.id} value={source.id}>{source.label} · {entries.filter(entry => entry.source === source.id).length}</option>)}</select></label>
      <div className="simulation-tabs" role="tablist" aria-label="Arrival templates">
        <button role="tab" aria-selected={category === "suggested"} onClick={() => setCategory("suggested")}>Suggested arrivals <span>{suggested.filter((entry) => !entry.delivered).length}</span></button>
        <button role="tab" aria-selected={category === "follow-ups"} onClick={() => setCategory("follow-ups")}>Follow-ups <span>{followUps.filter((entry) => !entry.delivered).length}</span></button>
      </div>
      <p className="simulation-hint">{category === "suggested" ? "Requests and everyday messages from the sample connections." : "Corrections, clarifications, and a duplicate delivery. These are most useful after the related request arrives."}</p>
      <div className="simulation-suggestions" role="tabpanel" aria-label={category === "suggested" ? "Suggested arrivals" : "Follow-ups"}>
        {visible.map((entry) => <button key={entry.id} className="simulation-suggestion" aria-label={entry.label} disabled={entry.delivered || !entry.item} onClick={() => onTemplate(entry.id)}>
          <span className={`source-logo source-logo--${entry.source}`}>{SOURCE_META[entry.source].short}</span>
          <span className="simulation-suggestion__copy"><strong>{entry.label}</strong><small>{SOURCE_META[entry.source].label}{entry.item ? ` · ${entry.item.author}${entry.item.attachments?.length ? ` · ${entry.item.attachments.length} attachments` : ""}` : " · Preview unavailable"}</small></span>
          {entry.delivered ? <span className="simulation-delivered"><Check size={13} /> Delivered</span> : <><span className="simulation-kind">{followUpKind(entry, entries) || "Message"}</span><ChevronRight size={15} /></>}
        </button>)}
        {!visible.length && <p className="muted">No suggested messages in this group. You can always write a new message.</p>}
      </div>
      <div className="simulation-controls"><div><strong>Demo controls</strong><small>{snapshot.auth.status === "signed-in" ? "Codex reviews each message when you deliver it." : "You can preview now. Sign in with ChatGPT to deliver messages."}</small></div><button className="button button--quiet" disabled={busy !== null} onClick={() => run({ type: "demo.reset" }, "demo.reset", "Sample inbox and work history reset.")}><RotateCcw size={14} /> Reset demo data</button></div>
    </div>
  </Modal>;
}

function SourceAttachments({ attachments }: { attachments: SourceItem["attachments"] }) {
  if (!attachments?.length) return null;
  return <div className="attachment-list"><h3>Attachments · {attachments.length}</h3>{attachments.map((file) => <details key={file.id}><summary><FileText size={15} /> {file.name}<small>{file.mediaType}</small></summary><pre>{file.content}</pre></details>)}</div>;
}

function IncomingMessageModal({ run, busy, signedIn, template, onClose, onCreated }: { run: RunCommand; busy: string | null; signedIn: boolean; template?: ReplayEntry; onClose: () => void; onCreated: (id: string) => void }) {
  const item = template?.item;
  const [form, setForm] = useState({ source: item?.source || "gmail" as Source, author: item?.author || "", title: item?.title || "", content: item?.content || "", threadId: item?.threadId || "" });
  const [attachments, setAttachments] = useState<SourceAttachment[]>([]);
  const [fileError, setFileError] = useState("");
  const [readingFiles, setReadingFiles] = useState(false);
  const addFiles = async (files: File[]) => {
    setFileError(""); setReadingFiles(true);
    try {
      if (attachments.length + files.length > 10) throw new Error("Attach up to 10 files.");
      const added = await Promise.all(files.map(async file => {
        if (file.size > 200_000) throw new Error(`${file.name} exceeds the 200 KB limit.`);
        const content = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
        if (content.includes("\0") || /\.(pdf|docx?|xlsx?|zip|png|jpe?g|gif)$/i.test(file.name)) throw new Error(`${file.name} is not a supported text file. Use CSV, JSON, Markdown, text, or source code.`);
        return { id: crypto.randomUUID(), name: file.name.slice(0, 200), mediaType: file.type || "text/plain", content };
      }));
      setAttachments(current => [...current, ...added]);
    } catch (error) { setFileError(error instanceof Error ? error.message : "Could not read the file."); }
    finally { setReadingFiles(false); }
  };
  const loadExample = () => {
    setForm({ ...form, author: "Alex Morgan", title: "Create a PDF sales performance report", content: "Please use the attached sales.csv to write a PDF report for July through September. Calculate revenue, cost, gross profit and margin by month and product. Explain the changes, recommend two next steps, and show your calculations. All amounts are USD; these six rows are the complete dataset.", threadId: "" });
    setAttachments([{ id: crypto.randomUUID(), name: "sales.csv", mediaType: "text/csv", content: sampleSales }]);
    setFileError("");
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (readingFiles || !signedIn || template?.delivered || (template && !item)) return;
    const id = item?.id || crypto.randomUUID();
    const changes = { ...form, author: form.author.trim(), title: form.title.trim(), content: form.content.trim(), threadId: form.threadId.trim() || item?.threadId || id };
    const command: Command = template ? { type: "demo.deliver", id: template.id, changes } : { type: "source.ingest", item: { ...changes, id, externalId: id, timestamp: Date.now(), attachments } };
    const next = await run(command);
    if (next) onCreated(id);
  };
  return <Modal title={template ? "Review incoming message" : "New incoming message"} onClose={onClose} closeOnBackdrop={false}><form className="form-stack" onSubmit={submit}>
    {template && <p className="demo-action">{template.label}</p>}
    <p className="muted">{template ? "Edit this suggested message before it arrives. Its original message ID and attached files will be preserved." : "Simulate a message arriving from a connection. Codex reads its content and decides whether to create work, attach context, wait, or ignore it."}</p>
    <label><span>Source</span><select value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value as Source })}>{SOURCES.map((source) => <option key={source.id} value={source.id}>{source.label}</option>)}</select></label>
    <label><span>Author</span><input required maxLength={200} autoFocus value={form.author} onChange={(event) => setForm({ ...form, author: event.target.value })} placeholder="Alex Morgan" /></label>
    <label><span>Subject</span><input required maxLength={300} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Could you prepare a launch summary?" /></label>
    <label><span>Message</span><textarea aria-label="Message" required rows={6} maxLength={20000} value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })} placeholder="Include the context an agent would need to do the work." /></label>
    <label><span>Thread ID <small>Optional, reuse an existing ID for a follow-up</small></span><input value={form.threadId} maxLength={200} onChange={(event) => setForm({ ...form, threadId: event.target.value })} /></label>
    {!template && <section className="attachment-picker">
      <button type="button" className="button button--quiet" onClick={loadExample} disabled={readingFiles}>Use sales report example</button>
      <label><span>Attach local files</span><input type="file" multiple disabled={readingFiles || attachments.length >= 10} onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ""; void addFiles(files); }} /></label>
      <p className="muted">CSV, JSON, Markdown, text, or source code. Up to 10 files, 200 KB each. Copies are saved with the message and placed in the agent's local workspace.</p>
      {attachments.map(file => <div className="attachment-picker__file" key={file.id}><span>{file.name} · {new TextEncoder().encode(file.content).length.toLocaleString()} bytes</span><button type="button" className="button button--quiet" disabled={readingFiles} aria-label={`Remove ${file.name}`} onClick={() => setAttachments(current => current.filter(item => item.id !== file.id))}><X size={14} /></button></div>)}
      {fileError && <p role="alert" className="field-error">{fileError}</p>}
    </section>}
    <SourceAttachments attachments={template ? item?.attachments : attachments} />
    {template?.delivered && <p className="field-error">This suggestion has already been delivered. Start a new message for another arrival.</p>}
    {!signedIn && <p className="field-error">Sign in with ChatGPT in Settings before delivering messages for triage.</p>}
    <div className="modal-actions"><button type="button" className="button button--quiet" onClick={onClose}>Cancel</button><button className="button button--primary" disabled={readingFiles || busy !== null || !signedIn || template?.delivered || !form.author.trim() || !form.title.trim() || !form.content.trim()}><Send size={15} /> Deliver message</button></div>
  </form></Modal>;
}

function SourceTriage({ snapshot, sourceId, onOpenWork }: { snapshot: Snapshot; sourceId: string; onOpenWork: (id: string) => void }) {
  const record = [...snapshot.triage].reverse().find((item) => item.sourceId === sourceId);
  if (!record) return null;
  const work = snapshot.work.find((item) => item.id === record.workId);
  return <div className={`triage-record triage-record--${record.status}`} role="status"><div><Sparkles size={16} /><strong>Codex triage</strong><span className="post-kind">{record.action || record.status}</span></div><p>{record.error || record.reason || (record.status === "running" ? "Reading the message and checking existing work…" : "Waiting for Codex to review this message.")}</p>{work && <button className="text-link" onClick={() => onOpenWork(work.id)}>{work.title}<ChevronRight size={14} /></button>}</div>;
}

function TriageQueue({ snapshot, onOpenWork }: { snapshot: Snapshot; onOpenWork: (id: string) => void }) {
  const pending = snapshot.triage.filter((record) => record.status === "queued" || record.status === "running").length;
  const recent = [...snapshot.triage].sort((a, b) => Number(b.status === "running") - Number(a.status === "running") || b.createdAt - a.createdAt).slice(0, 3);
  if (!recent.length) return null;
  return <section className="triage-feed" aria-label="Triage decisions"><h2><Sparkles size={15} /> At the intake desk{pending > 0 && <span className="muted"> · {pending} in review</span>}</h2>{recent.map((record) => <div key={record.id}><span className={`status-label status-label--${record.status}`}><StatusDot status={record.status} />{record.action || record.status}</span><span><strong>{snapshot.sources.find((source) => source.id === record.sourceId)?.title || "Incoming message"}</strong><small>{record.error || record.reason || "Codex is reviewing this trigger."}</small></span>{record.workId && <button className="button button--quiet" onClick={() => onOpenWork(record.workId!)}>Task <ChevronRight size={14} /></button>}</div>)}</section>;
}

function WorkContext({ snapshot, work, onOpenWork, onOpenSource, onOpenArtifact }: { snapshot: Snapshot; work: WorkItem; onOpenWork: (id: string) => void; onOpenSource: (id: string) => void; onOpenArtifact: (id: string) => void }) {
  const decision = snapshot.triage.find((record) => record.workId === work.id && (record.action === "create" || record.action === "wait"));
  const related = Array.from(new Set([work.parentWorkId, work.followUpOf, ...(work.dependsOnWorkIds || [])].filter((id): id is string => Boolean(id))));
  const inputs = snapshot.artifacts.filter((artifact) => work.inputArtifactIds?.includes(artifact.id));
  const source = snapshot.sources.find((item) => item.id === work.triggerSourceId);
  const followUps = snapshot.work.filter((item) => item.parentWorkId === work.id || item.followUpOf === work.id);
  if (!decision && !related.length && !inputs.length && !source && !work.blockedReason && !followUps.length) return null;
  return <section className="work-context"><h3>Why this task exists</h3>{decision?.reason && <p>{decision.reason}</p>}{source && <button className="text-link" onClick={() => onOpenSource(source.id)}>{SOURCE_META[source.source].label} · {source.title}<ChevronRight size={14} /></button>}
    {work.blockedReason && <p className="waiting-note"><Clock3 size={15} />{work.blockedReason}</p>}
    {work.needsInformation && <p className="muted">Waiting for more information. Deliver a reply in the original thread to continue.</p>}
    {!!related.length && <div><h4>Earlier work and dependencies</h4>{related.map((id) => { const item = snapshot.work.find((candidate) => candidate.id === id); return item && <button className="context-link" key={id} onClick={() => onOpenWork(id)}><StatusDot status={item.status} /><span>{item.title}</span><small>{item.status}</small><ChevronRight size={14} /></button>; })}</div>}
    {!!inputs.length && <div><h4>Input artifacts</h4>{inputs.map((artifact) => <button className="context-link" key={artifact.id} onClick={() => onOpenArtifact(artifact.id)}><FileText size={15} /><span>{artifact.title}</span><ChevronRight size={14} /></button>)}</div>}
    {!!followUps.length && <div><h4>Follow-up tasks</h4>{followUps.map((item) => <button className="context-link" key={item.id} onClick={() => onOpenWork(item.id)}><StatusDot status={item.status} /><span>{item.title}</span><ChevronRight size={14} /></button>)}</div>}
  </section>;
}

function TasksView({ snapshot, onOpenWork, onOpenSource, onOpenArtifact }: { snapshot: Snapshot; onOpenWork: (id: string) => void; onOpenSource: (id: string) => void; onOpenArtifact: (id: string) => void }) {
  const [filter, setFilter] = useState("all");
  const tasks = [...snapshot.work].filter((work) => filter === "all" || work.status === filter).sort((a, b) => b.createdAt - a.createdAt);
  return <div className="page page--tasks"><PageHeader eyebrow="From trigger to finished work" title="Tasks" description="See why work started, who picked it up, and what it produced." /><div className="task-filters" aria-label="Task status">{["all", "queued", "running", "waiting", "completed", "failed", "cancelled"].map((status) => <button key={status} className={filter === status ? "active" : ""} aria-pressed={filter === status} onClick={() => setFilter(status)}>{sentence(status)}<span>{snapshot.work.filter((work) => status === "all" || work.status === status).length}</span></button>)}</div><div className="task-cards">{tasks.map((work) => {
    const agent = snapshot.agents.find((item) => item.id === work.agentId);
    const artifacts = snapshot.artifacts.filter((item) => item.workId === work.id);
    return <article key={work.id} className="task-card"><div className="task-card__head"><button onClick={() => onOpenWork(work.id)}><PixelAvatar agent={agent} size="sm" /><span><strong>{work.title}</strong><small>{agent?.name || "Unassigned"} · {agent?.temporary ? "Temporary worker" : agent?.persistent ? "Recurring agent" : "Resident agent"}{agent?.retiredAt ? " · Retired" : ""}</small></span><ChevronRight size={17} /></button><span className={`status-label status-label--${work.status}`}><StatusDot status={work.status} />{work.status}</span></div><p>{work.goal}</p><WorkContext snapshot={snapshot} work={work} onOpenWork={onOpenWork} onOpenSource={onOpenSource} onOpenArtifact={onOpenArtifact} /><div className="task-card__foot"><span>{formatTime(work.createdAt)} · {work.mode === "demo" ? "Historical demo work" : "Codex execution"}</span>{artifacts.map((artifact) => <button key={artifact.id} className="text-link" onClick={() => onOpenArtifact(artifact.id)}><FileText size={14} />{artifact.title}</button>)}</div></article>;
  })}{!tasks.length && <EmptyState icon={<CheckCircle2 size={22} />} title="No tasks here yet" body="Deliver an incoming message. Codex will decide whether it needs a task." />}</div></div>;
}

function MessageRow({
  item,
  demoLabel,
  selected,
  onClick,
}: {
  item: SourceItem;
  demoLabel?: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`message-row ${selected ? "selected" : ""}`}
      onClick={onClick}
    >
      <span className={`source-logo source-logo--${item.source}`}>
        {SOURCE_META[item.source].short}
      </span>
      <span className="message-row__copy">
        <span>
          <strong>{item.author}</strong>
          <time>{formatTime(item.timestamp)}</time>
        </span>
        {demoLabel && <span className="message-action">{demoLabel}</span>}
        <b>{item.title}</b>
        <small>{item.content}</small>
      </span>
      {(!item.disposition || item.disposition === "pending") && (
        <i className="unread-dot" />
      )}
    </button>
  );
}

function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </header>
  );
}

function RoutinesView({
  snapshot,
  onOpenWork,
  onOpenArtifact,
  run,
  busy,
  onCreate,
  onEdit,
}: {
  snapshot: Snapshot;
  run: RunCommand;
  busy: string | null;
  onCreate: () => void;
  onEdit: (routine: Routine) => void;
  onOpenWork: (id: string) => void;
  onOpenArtifact: (id: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string>();
  const [resultTab, setResultTab] = useState<"collected" | "history">("collected");
  const [newsFilter, setNewsFilter] = useState("all");
  const [newsQuery, setNewsQuery] = useState("");
  const [linkError, setLinkError] = useState("");
  const selected = snapshot.routines.find(routine => routine.id === selectedId) || snapshot.routines.find(routine => routine.kind === "ai-news") || snapshot.routines[0];
  const history = snapshot.work.filter(work => work.routineId === selected?.id).sort((a, b) => b.createdAt - a.createdAt);
  const workIds = new Set(history.map(work => work.id));
  const collected = snapshot.artifacts.filter(artifact => workIds.has(artifact.workId)).sort((a, b) => b.createdAt - a.createdAt);
  const latestNews = collected.find(artifact => artifact.news)?.news;
  const news = [...new Map(collected.flatMap(artifact => (artifact.news?.items || []).map(item => [item.url, { ...item, artifactId: artifact.id }] as const))).values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const visibleNews = news.filter(item => (newsFilter === "all" || item.kind === newsFilter) && `${item.title} ${item.summary} ${item.account}`.toLowerCase().includes(newsQuery.toLowerCase()));
  const openNewsLink = (url: string) => { setLinkError(""); void bridge.openExternal(url).catch(error => setLinkError(error instanceof Error ? error.message : "Could not open source.")); };
  return (
    <div className="page">
      <PageHeader
        eyebrow="Repeatable help"
        title="Routines"
        description="Give useful work a schedule, an owner, and a note for next time."
        action={
          <button className="button button--primary" onClick={onCreate}>
            <Plus size={16} /> New routine
          </button>
        }
      />
      <div className="routine-workspace">
      <div className="routine-grid">
        {snapshot.routines.map((routine) => {
          const agent = snapshot.agents.find(
            (item) => item.id === routine.agentId,
          );
          return (
            <article
              className={`routine-card ${!routine.enabled ? "routine-card--paused" : ""}`}
              key={routine.id}
            >
              <div className="routine-card__top">
                <PixelAvatar agent={agent} />
                <div>
                  <span
                    className={`state-chip ${routine.enabled ? "state-chip--on" : ""}`}
                  >
                    {routine.enabled ? "Active" : "Paused"}
                  </span>
                  <h2>{routine.name}</h2>
                  <p>{routine.instructions}</p>
                </div>
                <button
                  className="icon-button"
                  aria-label={`Edit ${routine.name}`}
                  onClick={() => onEdit(routine)}
                >
                  <MoreHorizontal size={18} />
                </button>
              </div>
              <div className="routine-card__schedule">
                <Clock3 size={16} />
                <span>
                  {routine.schedule === "daily"
                    ? `Daily at ${routine.dailyTime}`
                    : `Every ${routine.intervalMinutes} minutes`}
                </span>
                <small>{routine.enabled ? `Next ${formatTime(routine.nextRunAt)}` : "Schedule paused"}</small>
              </div>
              {routine.notes && (
                <div className="routine-note">
                  <FileText size={15} />
                  <span>{routine.notes}</span>
                </div>
              )}
              <div className="routine-card__actions">
                <button className="button button--quiet" aria-pressed={selected?.id === routine.id} onClick={() => setSelectedId(routine.id)}><HistoryIcon size={14} /> Results · {snapshot.work.filter(work => work.routineId === routine.id).length}</button>
                <button
                  className="button button--quiet"
                  disabled={busy !== null}
                  onClick={() =>
                    run({ type: "routine.toggle", id: routine.id })
                  }
                >
                  {routine.enabled ? <Pause size={14} /> : <Play size={14} />}
                  {routine.enabled ? "Pause" : "Resume"}
                </button>
                <button
                  className="button button--quiet"
                  disabled={busy !== null || snapshot.work.some(work => work.routineId === routine.id && ["queued", "running", "waiting"].includes(work.status))}
                  onClick={() =>
                    run(
                      { type: "routine.run", id: routine.id },
                      `routine.run:${routine.id}`,
                      "Routine started.",
                    )
                  }
                >
                  <Zap size={14} /> Run now
                </button>
                <button
                  className="icon-button icon-button--danger"
                  disabled={busy !== null}
                  onClick={() =>
                    run(
                      { type: "routine.delete", id: routine.id },
                      `routine.delete:${routine.id}`,
                      "Routine deleted.",
                    )
                  }
                  aria-label={`Delete ${routine.name}`}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </article>
          );
        })}
        {!snapshot.routines.length && (
          <EmptyState
            icon={<Repeat2 size={23} />}
            title="No routines yet"
            body="Make a repeatable job for your office crew."
          />
        )}
      </div>
      {selected && <section className="routine-results">
        <div className="panel-heading"><div><p className="eyebrow">Collected over time</p><h2>{selected.name}</h2></div><span className="count-pill">{history.length}</span></div>
        <div className="routine-result-tabs" role="tablist" aria-label="Routine results"><button role="tab" aria-selected={resultTab === "collected"} onClick={() => setResultTab("collected")}>Collected results · {selected.kind === "ai-news" ? news.length : collected.length}</button><button role="tab" aria-selected={resultTab === "history"} onClick={() => setResultTab("history")}>Run history · {history.length}</button></div>
        {selected.kind === "ai-news" && <>
          <div className="news-accounts">{AI_NEWS_ACCOUNTS.map(account => <button key={account} onClick={() => openNewsLink(`https://x.com/${account}`)}>@{account}</button>)}</div>
          <p className="muted">Public-web coverage can be incomplete. Each run uses Codex allowance. Rumors remain unconfirmed.</p>
          {latestNews && <details className="news-coverage"><summary>Latest coverage: {latestNews.coverage.filter(entry => entry.status !== "unavailable").length}/10 accounts readable · {new Date(latestNews.until).toLocaleString()}</summary><p>Window: {new Date(latestNews.since).toLocaleString()} to {new Date(latestNews.until).toLocaleString()}. {latestNews.excluded} duplicate or invalid items excluded. Public profiles provide limited timelines; readable does not mean fully checked.</p>{latestNews.coverage.map(entry => <p key={entry.account}><strong>@{entry.account} · {entry.status}</strong> {entry.note}</p>)}</details>}
        </>}
        {linkError && <p role="alert" className="field-error">{linkError}</p>}
        {resultTab === "collected" && (selected.kind === "ai-news" ? <>
          <div className="news-filters"><input aria-label="Search collected news" placeholder="Search news or accounts" value={newsQuery} onChange={event => setNewsQuery(event.target.value)} /><select aria-label="News classification" value={newsFilter} onChange={event => setNewsFilter(event.target.value)}><option value="all">All news</option><option value="announcement">Announcements</option><option value="rumor">Unconfirmed rumors</option></select></div>
          <div className="news-feed">{visibleNews.map(item => <article className="news-item" key={item.url}><div className="news-item__meta"><span className={`news-kind news-kind--${item.kind}`}>{item.kind === "rumor" ? "Unconfirmed rumor" : "Announcement"}</span><span>@{item.account}</span><time>{new Date(item.publishedAt).toLocaleString()}</time></div><h3>{item.title}</h3><p>{item.summary}</p><div className="news-item__links"><button className="text-link" onClick={() => openNewsLink(item.url)}>Original post <ExternalLink size={14} /></button><button className="text-link" onClick={() => onOpenArtifact(item.artifactId)}>Collection report <FileText size={14} /></button></div></article>)}</div>
          {!visibleNews.length && <EmptyState icon={<Search size={22} />} title={news.length ? "No matching news" : "No verified new posts yet"} body={history.length ? "Check the latest account coverage and run history. Missing results do not mean no news was posted." : "Run once to collect today's posts. New results will accumulate here without duplicate posts."} />}
        </> : <div className="routine-collected">{collected.map(artifact => <button className="context-link" key={artifact.id} onClick={() => onOpenArtifact(artifact.id)}><FileText size={18} /><span><strong>{artifact.title}</strong><small>{new Date(artifact.createdAt).toLocaleString()}</small></span><ChevronRight size={16} /></button>)}{!collected.length && <p className="muted">Completed results will collect here.</p>}</div>)}
        {resultTab === "history" && history.map(work => {
          const artifacts = snapshot.artifacts.filter(artifact => artifact.workId === work.id);
          return <article className="routine-result-row" key={work.id}>
            <button className="text-link" onClick={() => onOpenWork(work.id)}><Clock3 size={15} />{new Date(work.createdAt).toLocaleString()}<ChevronRight size={14} /></button>
            <span className={`status-label status-label--${work.status}`}>{work.status}</span>
            {work.error && <p className="field-error">{work.error}</p>}
            {artifacts.map(artifact => <button key={artifact.id} className="context-link" onClick={() => onOpenArtifact(artifact.id)}><FileText size={16} /><span>{artifact.title}</span><ChevronRight size={14} /></button>)}
          </article>;
        })}
        {resultTab === "history" && !history.length && <EmptyState icon={<HistoryIcon size={22} />} title="No runs yet" body="Run this routine when ready. Its results will be saved here." />}
      </section>}
      </div>
    </div>
  );
}

function RoutineModal({
  snapshot,
  run,
  busy,
  onClose,
  routine,
}: {
  snapshot: Snapshot;
  run: RunCommand;
  busy: string | null;
  onClose: () => void;
  routine?: Routine;
}) {
  const [form, setForm] = useState({
    id: routine?.id,
    kind: routine?.kind,
    name: routine?.name || "",
    instructions: routine?.instructions || "",
    agentId: routine?.agentId || snapshot.agents.find((agent) => !agent.temporary)?.id || "",
    enabled: routine?.enabled ?? true,
    schedule: routine?.schedule || ("daily" as "interval" | "daily"),
    intervalMinutes: routine?.intervalMinutes || 60,
    dailyTime: routine?.dailyTime || "09:00",
    notes: routine?.notes || "",
    lastRunAt: routine?.lastRunAt,
  });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next = await run(
      { type: "routine.save", routine: form },
      "routine.save",
      routine ? "Routine saved." : "Routine created.",
    );
    if (next) onClose();
  };
  return (
    <Modal title={routine ? "Edit routine" : "New routine"} onClose={onClose} closeOnBackdrop={false}>
      <form className="form-stack" onSubmit={submit}>
        <label>
          <span>Name</span>
          <input
            required
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="Morning inbox sweep"
            autoFocus
          />
        </label>
        <label>
          <span>Instructions</span>
          <textarea
            required
            rows={4}
            value={form.instructions}
            onChange={(event) =>
              setForm({ ...form, instructions: event.target.value })
            }
            placeholder="Check new messages and flag anything that needs a reply."
          />
        </label>
        <div className="form-row">
          <label>
            <span>Agent</span>
            <select
              required
              value={form.agentId}
              onChange={(event) =>
                setForm({ ...form, agentId: event.target.value })
              }
            >
              {snapshot.agents.filter((agent) => !agent.temporary).map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name} · {agent.role}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Schedule</span>
            <select
              value={form.schedule}
              onChange={(event) =>
                setForm({
                  ...form,
                  schedule: event.target.value as "interval" | "daily",
                })
              }
            >
              <option value="daily">Daily</option>
              <option value="interval">Interval</option>
            </select>
          </label>
        </div>
        {form.schedule === "daily" ? (
          <label>
            <span>Run at</span>
            <input
              type="time"
              required
              value={form.dailyTime}
              onChange={(event) =>
                setForm({ ...form, dailyTime: event.target.value })
              }
            />
          </label>
        ) : (
          <label>
            <span>Repeat every (minutes)</span>
            <input
              type="number"
              required
              min={5}
              value={form.intervalMinutes}
              onChange={(event) =>
                setForm({
                  ...form,
                  intervalMinutes: Number(event.target.value),
                })
              }
            />
          </label>
        )}
        <label>
          <span>Notes for next run</span>
          <textarea
            rows={2}
            value={form.notes}
            onChange={(event) =>
              setForm({ ...form, notes: event.target.value })
            }
            placeholder="Optional context the agent should remember"
          />
        </label>
        <div className="modal-actions">
          <button
            type="button"
            className="button button--quiet"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="button button--primary"
            disabled={busy !== null || !form.agentId}
          >
            <Save size={15} /> Save routine
          </button>
        </div>
      </form>
    </Modal>
  );
}

function HistoryView({
  snapshot,
  onOpenWork,
}: {
  snapshot: Snapshot;
  onOpenWork: (id: string) => void;
}) {
  const [filter, setFilter] = useState<
    "all" | "completed" | "failed" | "cancelled"
  >("all");
  const items = snapshot.work
    .filter(
      (item) =>
        ["completed", "failed", "cancelled"].includes(item.status) &&
        (filter === "all" || item.status === filter),
    )
    .sort(
      (a, b) => (b.completedAt || b.createdAt) - (a.completedAt || a.createdAt),
    );
  return (
    <div className="page">
      <PageHeader
        eyebrow="What the office did"
        title="History"
        description="Open a task to review its run, notes, and output."
      />
      <div className="segmented">
        {(["all", "completed", "failed", "cancelled"] as const).map((item) => (
          <button
            key={item}
            className={filter === item ? "active" : ""}
            onClick={() => setFilter(item)}
          >
            {sentence(item)}
            <span>
              {
                snapshot.work.filter(
                  (work) =>
                    ["completed", "failed", "cancelled"].includes(
                      work.status,
                    ) &&
                    (item === "all" || work.status === item),
                ).length
              }
            </span>
          </button>
        ))}
      </div>
      <div className="history-list">
        {items.map((work) => {
          const agent = snapshot.agents.find(
            (item) => item.id === work.agentId,
          );
          const artifacts = snapshot.artifacts.filter(
            (item) => item.workId === work.id,
          );
          return (
            <button
              key={work.id}
              className="history-row"
              onClick={() => onOpenWork(work.id)}
            >
              <StatusDot status={work.status} />
              <span className="history-row__main">
                <strong>{work.title}</strong>
                <small>{work.goal}</small>
              </span>
              <span className="history-row__agent">
                <PixelAvatar agent={agent} size="sm" />
                {agent?.name || "Unassigned"}
              </span>
              <span className="history-row__meta">
                <b className={`status-label status-label--${work.status}`}>
                  {sentence(work.status)}
                </b>
                <small>
                  {formatTime(work.completedAt || work.createdAt)} ·{" "}
                  {artifacts.length}{" "}
                  {artifacts.length === 1 ? "artifact" : "artifacts"}
                </small>
              </span>
              <ChevronRight size={16} />
            </button>
          );
        })}
        {!items.length && (
          <EmptyState
            icon={<HistoryIcon size={22} />}
            title="No matching work"
            body="Completed, failed, and cancelled work will stay here."
          />
        )}
      </div>
    </div>
  );
}

function SettingsView({
  snapshot,
  run,
  busy,
}: {
  snapshot: Snapshot;
  run: RunCommand;
  busy: string | null;
}) {
  const auth = snapshot.auth;
  const authBusy =
    busy?.startsWith("auth.") ||
    ["checking", "signing-in"].includes(auth.status);
  const [model, setModel] = useState(snapshot.settings.model);
  const [authLinkError, setAuthLinkError] = useState("");
  useEffect(() => setModel(snapshot.settings.model), [snapshot.settings.model]);
  return (
    <div className="page page--settings">
      <PageHeader
        eyebrow="Office preferences"
        title="Settings"
        description="Connect ChatGPT and choose how work runs on this computer."
      />
      <div className="settings-stack">
        <section className="settings-card">
          <div className="settings-card__intro">
            <span className="settings-icon">
              <Sparkles size={20} />
            </span>
            <div>
              <h2>ChatGPT account</h2>
              <p>
                All triage and task execution use your ChatGPT sign-in. Authentication opens the
                official flow.
              </p>
            </div>
          </div>
          <div className="auth-panel">
            <div>
              <StatusDot status={auth.status} />
              <span>
                <strong>
                  {auth.status === "signed-in"
                    ? auth.email
                    : sentence(auth.status)}
                </strong>
                <small>
                  {auth.plan
                    ? `${auth.plan} plan${auth.method ? ` · ${auth.method}` : ""}`
                    : auth.error || (auth.status === "signed-in" ? "Connected through local Codex." : "Sign in to triage messages and run tasks.")}
                </small>
              </span>
            </div>
            <div className="settings-actions">
              {auth.status === "signed-in" ? (
                <>
                  <button
                    className="button button--quiet"
                    disabled={authBusy}
                    onClick={() => run({ type: "auth.refresh" })}
                  >
                    <RefreshCw size={15} /> Refresh
                  </button>
                  <button
                    className="button button--quiet"
                    disabled={authBusy}
                    onClick={() =>
                      run({ type: "auth.logout" }, "auth.logout", "Signed out.")
                    }
                  >
                    <LogOut size={15} /> Sign out
                  </button>
                </>
              ) : (
                <>
                  {auth.status === "signing-in" && (
                    <>
                      {auth.loginUrl && (
                        <button
                          className="button button--quiet"
                          onClick={() => {
                            setAuthLinkError("");
                            bridge
                              .openExternal(auth.loginUrl!)
                              .catch((error: unknown) =>
                                setAuthLinkError(
                                  error instanceof Error
                                    ? error.message
                                    : "The sign-in page could not be opened.",
                                ),
                              );
                          }}
                        >
                          <ExternalLink size={14} /> Open sign-in page
                        </button>
                      )}
                      <button
                        className="button button--quiet"
                        disabled={busy !== null}
                        onClick={() => run({ type: "auth.cancel" })}
                      >
                        Cancel
                      </button>
                    </>
                  )}
                  <button
                    className="button button--primary"
                    disabled={authBusy}
                    onClick={() => run({ type: "auth.login" })}
                  >
                    <LogIn size={15} /> Sign in with ChatGPT
                  </button>
                </>
              )}
            </div>
          </div>
          {auth.error && (
            <p className="field-error">
              <AlertCircle size={15} />
              {auth.error}
            </p>
          )}
          {authLinkError && (
            <p className="field-error">
              <AlertCircle size={15} />
              {authLinkError}
            </p>
          )}
        </section>
        <section className="settings-card">
          <div className="settings-card__intro">
            <span className="settings-icon">
              <Gauge size={20} />
            </span>
            <div>
              <h2>Real work, demo data</h2>
              <p>Codex reviews incoming messages and executes every new task. A ChatGPT sign-in and internet connection are required.</p>
            </div>
          </div>
          <div className="execution-details">
            <div><Code2 size={18} /><span><strong>Real local files</strong><p>Reports, code changes, and verification results are written to task folders on this computer. Open the finished files from a task's artifacts.</p></span></div>
            <div><Inbox size={18} /><span><strong>Fictional incoming data</strong><p>Choose a suggested arrival or write your own message. Codex decides what deserves work, which existing task needs the context, and what to ignore.</p></span></div>
            <div><CalendarDays size={18} /><span><strong>Local calendar and external actions</strong><p>Calendar changes stay inside Little Office. Invitations, messages, and pull requests are not published to external services.</p></span></div>
          </div>
        </section>
        <section className="settings-card">
          <div className="settings-card__intro">
            <span className="settings-icon">
              <Code2 size={20} />
            </span>
            <div>
              <h2>Model and display</h2>
              <p>
                Choose the model name sent to the runtime and adjust motion.
              </p>
            </div>
          </div>
          <div className="setting-row">
            <label htmlFor="model-name">
              <span>
                <strong>Model</strong>
                <small>The Codex model used for triage and new tasks.</small>
              </span>
            </label>
            <div className="inline-save">
              <input
                id="model-name"
                value={model}
                placeholder="Use the Codex default"
                onChange={(event) => setModel(event.target.value)}
              />
              <button
                className="button button--quiet"
                disabled={busy !== null || model === snapshot.settings.model}
                onClick={() =>
                  run(
                    {
                      type: "settings.update",
                      settings: { model: model.trim() },
                    },
                    "settings.update",
                    "Model saved.",
                  )
                }
              >
                <Save size={14} /> Save
              </button>
            </div>
          </div>
          <div className="setting-row">
            <span>
              <strong>Reduced motion</strong>
              <small>
                Stops character movement and softens interface animation.
              </small>
            </span>
            <button
              className={`toggle ${snapshot.settings.reducedMotion ? "active" : ""}`}
              role="switch"
              aria-label="Reduced motion"
              aria-checked={snapshot.settings.reducedMotion}
              onClick={() =>
                run({
                  type: "settings.update",
                  settings: { reducedMotion: !snapshot.settings.reducedMotion },
                })
              }
            >
              <span />
            </button>
          </div>
          <div className="setting-row">
            <span>
              <strong>Office sound</strong>
              <small>Plays quiet cues when work changes state.</small>
            </span>
            <button
              className={`toggle ${snapshot.settings.sound ? "active" : ""}`}
              role="switch"
              aria-label="Office sound"
              aria-checked={snapshot.settings.sound}
              onClick={() =>
                run({
                  type: "settings.update",
                  settings: { sound: !snapshot.settings.sound },
                })
              }
            >
              <span />
            </button>
          </div>
        </section>
        <p className="platform-note">
          Little Office is running on {sentence(bridge.platform)}. Your
          workspace stays on this computer.
        </p>
      </div>
    </div>
  );
}

function WorkDrawer({
  snapshot,
  work,
  agent,
  initialArtifactId,
  busy,
  run,
  onOpenArtifact,
  onOpenSource,
  onOpenWork,
  onError,
  onClose,
}: {
  snapshot: Snapshot;
  work?: WorkItem;
  agent?: Agent;
  initialArtifactId?: string;
  busy: string | null;
  run: RunCommand;
  onOpenArtifact: (id: string) => void;
  onOpenSource: (id: string) => void;
  onOpenWork: (id: string) => void;
  onError: (message: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"messages" | "activity" | "artifacts">(
    initialArtifactId ? "artifacts" : "messages",
  );
  const [artifactId, setArtifactId] = useState(initialArtifactId);
  const [steer, setSteer] = useState("");
  const artifacts = snapshot.artifacts.filter(
    (item) => work && item.workId === work.id,
  );
  const events = snapshot.activity
    .filter(
      (item) =>
        (work && item.workId === work.id) ||
        (!work && agent && item.agentId === agent.id),
    )
    .sort((a, b) => b.sequence - a.sequence);
  const runItem = [...snapshot.runs].reverse().find((item) => work && item.workId === work.id);
  const workRuns = snapshot.runs.filter(item => work && item.workId === work.id);
  const canSteer = work?.status === "running" && Boolean(runItem?.turnId);
  const sources = snapshot.sources.filter((item) =>
    work?.sourceIds.includes(item.id),
  );
  const selectedArtifact =
    snapshot.artifacts.find((item) => item.id === artifactId) || artifacts[0];
  const sendSteer = async (event: FormEvent) => {
    event.preventDefault();
    if (!work || !steer.trim()) return;
    const next = await run(
      { type: "work.steer", id: work.id, text: steer.trim() },
      `work.steer:${work.id}`,
      "Direction sent.",
    );
    if (next) setSteer("");
  };
  return (
    <Modal
      title={work?.title || agent?.name || "Work details"}
      onClose={onClose}
      wide
    >
      <div className="drawer-identity">
        <PixelAvatar agent={agent} size="lg" />
        <div>
          <p className="eyebrow">{agent?.role || "Office agent"}</p>
          <h3>{agent?.name || "Unassigned"}</h3>
          <p>{work?.goal || agent?.statusText}</p>
        </div>
        {work && (
          <span className={`status-label status-label--${work.status}`}>
            <StatusDot status={work.status} />
            {sentence(work.status)}
          </span>
        )}
      </div>
      {work && <WorkContext snapshot={snapshot} work={work} onOpenWork={onOpenWork} onOpenSource={onOpenSource} onOpenArtifact={onOpenArtifact} />}
      {work?.error && (
        <div className="run-error">
          <AlertCircle size={18} />
          <div>
            <strong>The run stopped</strong>
            <p>{work.error}</p>
          </div>
        </div>
      )}
      <div className="drawer-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "messages"} className={tab === "messages" ? "active" : ""} onClick={() => setTab("messages")}>Agent messages <span>{workRuns.reduce((count, run) => count + (run.messages?.length || 0), 0)}</span></button>
        <button
          role="tab"
          aria-selected={tab === "activity"}
          className={tab === "activity" ? "active" : ""}
          onClick={() => setTab("activity")}
        >
          Activity <span>{events.length}</span>
        </button>
        <button
          role="tab"
          aria-selected={tab === "artifacts"}
          className={tab === "artifacts" ? "active" : ""}
          onClick={() => setTab("artifacts")}
        >
          Artifacts <span>{artifacts.length}</span>
        </button>
      </div>
      {tab === "messages" ? <div className="agent-messages" aria-label="Agent messages">
        <p className="muted">Live updates and complete responses, saved with each attempt. Activity contains task status changes and your directions.</p>
        {workRuns.map((attempt, index) => <section key={attempt.id}>
          <h4>Attempt {index + 1} · {attempt.status} · {formatTime(attempt.startedAt)}</h4>
          {attempt.messages?.map(message => <article className="agent-message" key={message.id}><header><strong>{agent?.name || "Agent"}</strong><time>{formatTime(message.timestamp)}</time><span>{!message.complete ? attempt.status === "running" ? "Writing…" : "Interrupted" : ""}</span></header><div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
            a: ({ href, children }) => href?.startsWith("https://") ? <a href={href} onClick={event => { event.preventDefault(); void bridge.openExternal(href).catch((error: unknown) => onError(error instanceof Error ? error.message : "Could not open this link.")); }}>{children}</a> : <span title={href}>{children}</span>,
          }}>{message.text}</ReactMarkdown></div></article>)}
          {!attempt.messages?.length && <p className="muted">{attempt.status === "running" ? "Waiting for the agent's first message…" : "No messages were saved for this attempt. Older runs may have summaries in Activity."}</p>}
        </section>)}
        {!workRuns.length && <p className="muted">Messages will appear when this task starts.</p>}
      </div> : tab === "activity" ? (
        <div className="drawer-body">
          <div className="run-summary">
            <div>
              <span>Source</span>
              <strong>
                {sources.length
                  ? `${sources.length} linked item${sources.length > 1 ? "s" : ""}`
                  : work
                    ? "Manual"
                    : "Agent desk"}
              </strong>
            </div>
            <div>
              <span>Started</span>
              <strong>
                {formatTime(runItem?.startedAt || work?.createdAt)}
              </strong>
            </div>
            <div>
              <span>Execution</span>
              <strong>{work?.mode === "demo" ? "Historical demo" : "Codex"}</strong>
            </div>
          </div>
          {sources.length > 0 && (
            <div className="drawer-sources">
              <span className="eyebrow">Linked sources</span>
              {sources.map((source) => (
                <button key={source.id} onClick={() => onOpenSource(source.id)}>
                  <span className={`source-logo source-logo--${source.source}`}>
                    {SOURCE_META[source.source].short}
                  </span>
                  <span>
                    <strong>{source.title}</strong>
                    <small>
                      {SOURCE_META[source.source].label} · {source.author}
                    </small>
                  </span>
                  <ChevronRight size={14} />
                </button>
              ))}
            </div>
          )}
          <div className="timeline">
            {events.map((event) => (
              <div className="timeline__item" key={event.id}>
                <span
                  className={`timeline__mark timeline__mark--${event.kind}`}
                />{" "}
                <div>
                  <p>{event.text}</p>
                  <time>{formatTime(event.timestamp)}</time>
                </div>
              </div>
            ))}
            {!events.length && (
              <EmptyState
                icon={<Clock3 size={20} />}
                title="No activity yet"
                body="Updates from this desk will appear here."
              />
            )}
          </div>
        </div>
      ) : (
        <div className="artifact-workspace">
          <div className="artifact-list">
            {artifacts.map((artifact) => (
              <button
                key={artifact.id}
                className={selectedArtifact?.id === artifact.id ? "active" : ""}
                onClick={() => {
                  setArtifactId(artifact.id);
                  onOpenArtifact(artifact.id);
                }}
              >
                <ArtifactGlyph artifact={artifact} />
                <span>
                  <strong>{artifact.title}</strong>
                  <small>
                    {sentence(artifact.kind)} · {formatTime(artifact.createdAt)}
                  </small>
                </span>
              </button>
            ))}
            {!artifacts.length && (
              <p className="muted">No artifacts for this work.</p>
            )}
          </div>
          {selectedArtifact && (
            <ArtifactPreview
              artifact={selectedArtifact}
              snapshot={snapshot}
              onOpen={() =>
                bridge
                  .openArtifact(selectedArtifact.id)
                  .catch((error: unknown) =>
                    onError(
                      error instanceof Error
                        ? error.message
                        : "The artifact could not be opened.",
                    ),
                  )
              }
            />
          )}
        </div>
      )}
      {work && (
        <div className="drawer-footer">
          <form className="steer-form" onSubmit={sendSteer}>
            <label htmlFor="steer">Add direction</label>
            <div>
              <input
                id="steer"
                value={steer}
                onChange={(event) => setSteer(event.target.value)}
                placeholder={canSteer ? "Ask for a change or add context" : "Direction is available during an active Codex turn"}
                disabled={!canSteer}
              />
              <button
                className="icon-button icon-button--send"
                disabled={
                  busy !== null ||
                  !steer.trim() ||
                  !canSteer
                }
                aria-label="Send direction"
              >
                <Send size={16} />
              </button>
            </div>
          </form>
          <div className="work-actions">
            {["running", "queued", "waiting"].includes(work.status) && (
              <button
                className="button button--quiet button--danger"
                disabled={busy !== null}
                onClick={() =>
                  run(
                    { type: "work.cancel", id: work.id },
                    `work.cancel:${work.id}`,
                    "Work cancelled.",
                  )
                }
              >
                <X size={14} /> Cancel run
              </button>
            )}
            {["failed", "cancelled"].includes(work.status) && (
              <button
                className="button button--primary"
                disabled={busy !== null}
                onClick={() =>
                  run(
                    { type: "work.retry", id: work.id },
                    `work.retry:${work.id}`,
                    "Work restarted.",
                  )
                }
              >
                <RefreshCw size={14} /> Retry
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function ArtifactGlyph({ artifact }: { artifact: Artifact }) {
  if (artifact.kind === "patch")
    return (
      <span className="artifact-icon artifact-icon--patch">
        <Code2 size={16} />
      </span>
    );
  if (artifact.kind === "calendar")
    return (
      <span className="artifact-icon artifact-icon--calendar">
        <CalendarDays size={16} />
      </span>
    );
  return (
    <span className={`artifact-icon artifact-icon--${artifact.kind}`}>
      <FileText size={16} />
    </span>
  );
}

function CalendarCard({ event }: { event: CalendarEvent }) {
  return <div className="calendar-card">
    <span className="calendar-card__date"><b>{new Date(event.start).toLocaleDateString([], { day: "numeric" })}</b>{new Date(event.start).toLocaleDateString([], { month: "short" })}</span>
    <div><h4>{event.title}</h4><p>{new Date(event.start).toLocaleString([], { weekday: "long", hour: "numeric", minute: "2-digit" })} to {new Date(event.end).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p><p>{event.location}</p><small>{event.attendees.join(", ")}</small></div>
  </div>;
}

function localDateTime(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function CalendarEventModal({ snapshot, run, busy, onClose }: { snapshot: Snapshot; run: RunCommand; busy: string | null; onClose: () => void }) {
  const [form, setForm] = useState(() => {
    const start = new Date();
    start.setHours(start.getHours() + 1, 0, 0, 0);
    return { title: "", start: localDateTime(start), end: localDateTime(new Date(start.getTime() + 30 * 60_000)), attendees: "", location: "", description: "" };
  });
  const startTime = new Date(form.start).getTime();
  const endTime = new Date(form.end).getTime();
  const validTimes = Number.isFinite(startTime) && Number.isFinite(endTime) && endTime > startTime;
  const signedIn = snapshot.auth.status === "signed-in";
  const conflicts = validTimes ? snapshot.calendar.filter((event) => startTime < Date.parse(event.end) && endTime > Date.parse(event.start)) : [];
  const changeStart = (value: string) => {
    const newStart = new Date(value).getTime();
    const duration = validTimes ? endTime - startTime : 30 * 60_000;
    setForm({ ...form, start: value, end: Number.isFinite(newStart) ? localDateTime(new Date(newStart + duration)) : form.end });
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!validTimes || !form.title.trim() || !signedIn) return;
    const result = await run({
      type: "calendar.create",
      event: {
        title: form.title.trim(), start: new Date(startTime).toISOString(), end: new Date(endTime).toISOString(),
        attendees: [...new Set(form.attendees.split(/[,;\n]/).map((value) => value.trim()).filter(Boolean))],
        location: form.location.trim(), description: form.description.trim(),
      },
    }, "calendar.create", "Calendar event added. Codex will review it for meeting preparation.");
    if (result) onClose();
  };
  return <Modal title="New calendar event" onClose={onClose} closeOnBackdrop={false}>
    <form className="form-stack" onSubmit={submit}>
      <p className="calendar-form-note">Add an event to the local demo calendar. Codex will receive the invitation, find relevant context, and decide what preparation it needs.</p>
      <label><span>Event title</span><input autoFocus required maxLength={200} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Atlas launch review" /></label>
      <div className="form-row calendar-time-row">
        <label><span>Starts</span><input type="datetime-local" required value={form.start} onChange={(event) => changeStart(event.target.value)} /></label>
        <label><span>Ends</span><input type="datetime-local" required value={form.end} min={form.start} onChange={(event) => setForm({ ...form, end: event.target.value })} /></label>
      </div>
      <p className="calendar-timezone">Times are in {Intl.DateTimeFormat().resolvedOptions().timeZone}. Invitations are not sent to attendees.</p>
      {form.start && form.end && !validTimes && <p className="field-error" role="alert">Choose an end time after the start time.</p>}
      {conflicts.length > 0 && <p className="calendar-conflict">Overlaps with {conflicts.map((event) => event.title).join(", ")}. You can still add this event.</p>}
      <label><span>Attendees</span><input aria-label="Attendees" aria-describedby="calendar-attendees-help" value={form.attendees} maxLength={2000} onChange={(event) => setForm({ ...form, attendees: event.target.value })} placeholder="nora@example.com, alex@example.com" /><small id="calendar-attendees-help">Separate names or email addresses with commas.</small></label>
      <label><span>Location</span><input value={form.location} maxLength={500} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="Studio room or meeting link" /></label>
      <label><span>Agenda and context</span><textarea rows={5} maxLength={20000} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="What will you discuss? Mention projects, decisions, or documents the agent should look for." /></label>
      {!signedIn && <p className="field-error">Sign in with ChatGPT in Settings to create an event and prepare for it.</p>}
      <div className="modal-actions"><button type="button" className="button button--quiet" onClick={onClose}>Cancel</button><button className="button button--primary" disabled={busy !== null || !signedIn || !validTimes || !form.title.trim()}><CalendarDays size={15} /> Create event</button></div>
    </form>
  </Modal>;
}

function CalendarView({ snapshot, run, busy, onOpenWork, onOpenSource, onOpenArtifact, onCreate }: { snapshot: Snapshot; run: RunCommand; busy: string | null; onOpenWork: (id: string) => void; onOpenSource: (id: string) => void; onOpenArtifact: (id: string) => void; onCreate: () => void }) {
  const events = [...snapshot.calendar].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  return <div className="page page--calendar">
    <PageHeader eyebrow="Know the context before you join" title="Calendar" description="Agendas, pre-reads, and notes for your upcoming meetings." action={<button className="button button--primary" onClick={onCreate}><Plus size={15} /> New calendar event</button>} />
    <div className="calendar-agenda">
      {events.map((event) => {
        const linked = snapshot.work.filter(work => work.sourceIds.some(id => event.sourceIds.includes(id)));
        const notes = [...linked].reverse().find(work => work.scenario === "meeting");
        const brief = [...snapshot.artifacts].reverse().find(artifact => artifact.workId === notes?.id && artifact.kind === "brief");
        const reviewing = snapshot.triage.some(record => event.sourceIds.includes(record.sourceId) && ["queued", "running"].includes(record.status));
        const failedReview = [...snapshot.triage].reverse().find(record => event.sourceIds.includes(record.sourceId) && record.status === "failed")?.error;
        const sources = snapshot.sources.filter(source => event.sourceIds.includes(source.id) && source.source !== "calendar");
        const meeting = !event.kind || event.kind === "meeting";
        return <article className="calendar-agenda__event" key={event.id}>
          <div className="calendar-agenda__heading"><span>{new Date(event.start).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</span><span className="post-kind">{meeting ? `${Math.round((Date.parse(event.end) - Date.parse(event.start)) / 60000)} min meeting` : event.kind === "focus" ? "Focus time" : "Personal"}</span></div>
          <CalendarCard event={event} />
          {meeting ? <details className="calendar-agenda-details"><summary>Agenda and meeting goal</summary><p className="calendar-agenda__description">{event.description}</p></details> : <p className="calendar-agenda__description">{event.description}</p>}
          {(event.attachments?.length || sources.length || linked.some(work => work.scenario !== "meeting")) ? <details className="calendar-pre-reads"><summary>Pre-reads and related work</summary>
            <SourceAttachments attachments={event.attachments} />
            {sources.map(source => <button className="context-link" key={source.id} onClick={() => onOpenSource(source.id)}><Mail size={14} /><span>{source.title}</span><small>{SOURCE_META[source.source].label}</small><ChevronRight size={14} /></button>)}
            {linked.filter(work => work.scenario !== "meeting").map(work => <button className="context-link" key={work.id} onClick={() => onOpenWork(work.id)}><FileText size={14} /><span>{work.title}</span><small>{work.status}</small><ChevronRight size={14} /></button>)}
          </details> : null}
          {meeting && <div className="calendar-preparation">
            <div><strong>{notes?.status === "completed" ? "Meeting notes ready" : notes ? `Preparation ${notes.status}` : reviewing ? "Reviewing meeting context" : failedReview ? "Preparation needs attention" : "Ready to prepare"}</strong><small>{failedReview || (notes ? "Open the task for agent messages and the meeting brief." : "Creates a pre-read and discussion notes with Codex. Uses subscription allowance.")}</small></div>
            {notes ? <button className="button button--primary" onClick={() => brief ? onOpenArtifact(brief.id) : onOpenWork(notes.id)}><FileText size={15} />{notes.status === "completed" ? "View meeting notes" : "View preparation"}</button> : <button className="button button--primary" disabled={busy !== null || reviewing || snapshot.auth.status !== "signed-in"} onClick={() => void run({ type: "calendar.prepare", id: event.id })}><Sparkles size={15} />{reviewing ? "Preparing…" : failedReview ? "Retry preparation" : "Prepare meeting notes"}</button>}
          </div>}
        </article>;
      })}
      {!events.length && <EmptyState icon={<CalendarDays size={24} />} title="A little breathing room" body="Add a meeting with its agenda to let an agent prepare a brief." />}
    </div>
  </div>;
}

function ArtifactPreview({
  artifact,
  snapshot,
  onOpen,
}: {
  artifact: Artifact;
  snapshot: Snapshot;
  onOpen: () => void;
}) {
  const [linkError, setLinkError] = useState("");
  let calendar: CalendarEvent | undefined;
  if (artifact.kind === "calendar") {
    try {
      const saved = JSON.parse(artifact.content) as { id?: string };
      calendar = snapshot.calendar.find((item) => item.id === saved.id);
    } catch { /* Non-JSON artifacts remain readable as text. */ }
  }
  return (
    <div className="artifact-preview">
      <header>
        <div>
          <p className="eyebrow">
            {sentence(artifact.kind)}
            {artifact.simulated ? " · Simulated" : ""}
          </p>
          <h3>{artifact.title}</h3>
        </div>
        {artifact.filePath && (
          <button className="button button--quiet" onClick={onOpen}>
            <ExternalLink size={14} /> {artifact.filePath?.endsWith(".pdf") ? "Open PDF" : "Open file"}
          </button>
        )}
      </header>
      {artifact.kind === "patch" ? (
        <pre>
          <code>{artifact.content}</code>
        </pre>
      ) : calendar ? (
        <CalendarCard event={calendar} />
      ) : (
        <div className="markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
            a: ({ href, children }) => href?.startsWith("https://") ? (
              <a href={href} onClick={(event) => {
                event.preventDefault();
                void bridge.openExternal(href).catch((error: unknown) => setLinkError(error instanceof Error ? error.message : "Could not open this link."));
              }}>{children}</a>
            ) : <span title={href}>{children}</span>,
          }}>{artifact.content}</ReactMarkdown>
          {linkError && <p className="field-error" role="alert">{linkError}</p>}
        </div>
      )}
    </div>
  );
}

export default App;
