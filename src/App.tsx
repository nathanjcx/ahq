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
  ShieldCheck,
  Slack,
  Sparkles,
  StepForward,
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
  Command,
  Routine,
  Scenario,
  Snapshot,
  Source,
  SourceItem,
  WorkItem,
} from "./shared/types";

type Tab = "office" | "inbox" | "routines" | "history" | "settings";
type Toast = { id: number; message: string; tone: "error" | "success" };

const NAV: { id: Tab; label: string; icon: typeof Building2 }[] = [
  { id: "office", label: "Office", icon: Building2 },
  { id: "inbox", label: "Inbox", icon: Inbox },
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

const SCENARIOS: { id: Scenario; label: string }[] = [
  { id: "report", label: "Research brief" },
  { id: "bug", label: "Fix a bug" },
  { id: "meeting", label: "Plan a meeting" },
  { id: "dinner", label: "Organize dinner" },
  { id: "qa", label: "Run QA" },
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
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = panel.current;
    node?.focus();
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
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
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
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
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
    (agent) => agent.activity !== "idle" && agent.activity !== "waiting",
  ).length;
  const pendingInbox = snapshot.sources.filter(
    (item) => !item.disposition || item.disposition === "pending",
  ).length;
  const attention = snapshot.work.filter(
    (work) => work.status === "failed" || work.status === "waiting",
  ).length;
  const selectedWork = snapshot.work.find((work) => work.id === selectedWorkId);
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
          <span className={`mode-badge mode-badge--${snapshot.settings.mode}`}>
            {snapshot.settings.mode}
          </span>
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
          />
        )}
        {activeTab === "inbox" && (
          <InboxView
            snapshot={snapshot}
            run={run}
            busy={busy}
            targetId={inboxTargetId}
            onOpenWork={openWork}
            onOpenArtifact={openArtifact}
          />
        )}
        {activeTab === "routines" && (
          <RoutinesView
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
        {activeTab === "history" && (
          <HistoryView snapshot={snapshot} onOpenWork={openWork} />
        )}
        {activeTab === "settings" && (
          <SettingsView snapshot={snapshot} run={run} busy={busy} />
        )}
      </div>

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
        <WorkDrawer
          snapshot={snapshot}
          work={selectedWork}
          agent={selectedAgent}
          initialArtifactId={selectedArtifactId}
          busy={busy}
          run={run}
          onOpenArtifact={openArtifact}
          onOpenSource={openSource}
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
}: {
  snapshot: Snapshot;
  run: RunCommand;
  busy: string | null;
  selectedAgentId?: string;
  onSelectAgent: (id: string) => void;
  onOpenWork: (id: string) => void;
  onOpenArtifact: (id: string) => void;
}) {
  const [scenario, setScenario] = useState<Scenario>("report");
  const [boardText, setBoardText] = useState("");
  const active = snapshot.agents.filter((agent) => agent.activity !== "idle");
  const resting = snapshot.agents.filter((agent) => agent.activity === "idle");
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
    const target = station.toLowerCase().includes("board")
      ? "office-board"
      : station.toLowerCase().includes("calendar")
        ? "scenario-runner"
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
            <p className="eyebrow">Your crew, at a glance</p>
            <h1>A little help. A lot getting done.</h1>
          </div>
          <div className="scenario-runner" id="scenario-runner">
            <label htmlFor="scenario">Start some work</label>
            <div>
              <select
                id="scenario"
                value={scenario}
                onChange={(event) =>
                  setScenario(event.target.value as Scenario)
                }
              >
                {SCENARIOS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
              <button
                className="button button--primary"
                disabled={
                  busy !== null ||
                  (snapshot.settings.mode === "live" &&
                    snapshot.auth.status !== "signed-in")
                }
                onClick={() =>
                  run(
                    { type: "scenario.run", scenario },
                    "scenario.run",
                    "Work started.",
                  )
                }
              >
                <Zap size={15} /> Run
              </button>
            </div>
          </div>
        </section>

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
                  <small>{agent.statusText}</small>
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
            agents={snapshot.agents}
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
              {active.length} active · {resting.length} resting
            </span>
          </div>
        </section>

        <section className="playback">
          <div className="playback__controls">
            <span className="eyebrow">Demo playback</span>
            <button
              className="round-control round-control--play"
              disabled={busy !== null}
              onClick={() =>
                run({
                  type: snapshot.demo.playing ? "demo.pause" : "demo.play",
                })
              }
              aria-label={snapshot.demo.playing ? "Pause demo" : "Play demo"}
            >
              {snapshot.demo.playing ? <Pause size={17} /> : <Play size={17} />}
            </button>
            <button
              className="round-control"
              disabled={busy !== null}
              onClick={() => run({ type: "demo.next" })}
              aria-label="Next demo step"
            >
              <StepForward size={16} />
            </button>
            <button
              className="round-control"
              disabled={busy !== null}
              onClick={() => run({ type: "demo.reset" })}
              aria-label="Reset demo"
            >
              <RotateCcw size={15} />
            </button>
            <label className="speed-control">
              Speed{" "}
              <select
                value={snapshot.demo.speed}
                onChange={(event) =>
                  run({ type: "demo.speed", speed: Number(event.target.value) })
                }
              >
                <option value="0.5">0.5x</option>
                <option value="1">1x</option>
                <option value="2">2x</option>
                <option value="4">4x</option>
              </select>
            </label>
          </div>
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
        <div className="board-posts">
          {[...snapshot.board]
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, 8)
            .map((post) => {
              const agent = snapshot.agents.find(
                (item) => item.id === post.agentId,
              );
              return (
                <article className="board-post" key={post.id}>
                  <PixelAvatar agent={agent} size="sm" />
                  <div>
                    <div className="board-post__meta">
                      <strong>{agent?.name || "Office"}</strong>
                      <span className={`post-kind post-kind--${post.kind}`}>
                        {post.kind}
                      </span>
                      <time>{formatTime(post.timestamp)}</time>
                    </div>
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
  onOpenWork,
  onOpenArtifact,
}: {
  snapshot: Snapshot;
  run: RunCommand;
  busy: string | null;
  targetId?: string;
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
  );
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
        description="Review what arrived and decide what deserves a desk."
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
              <div className="message-copy">
                <p>{selected.content}</p>
              </div>
              {selected.reason && (
                <div className="evaluation-note">
                  <Sparkles size={16} />
                  <span>
                    <strong>Office read</strong>
                    {selected.reason}
                  </span>
                </div>
              )}
              <div className="detail-actions">
                <button
                  className="button button--primary"
                  disabled={busy !== null}
                  onClick={() =>
                    run(
                      { type: "source.evaluate", id: selected.id },
                      `source.evaluate:${selected.id}`,
                      "Message evaluated.",
                    )
                  }
                >
                  <Gauge size={15} /> Evaluate
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

function MessageRow({
  item,
  selected,
  onClick,
}: {
  item: SourceItem;
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
}) {
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
                <small>Next {formatTime(routine.nextRunAt)}</small>
              </div>
              {routine.notes && (
                <div className="routine-note">
                  <FileText size={15} />
                  <span>{routine.notes}</span>
                </div>
              )}
              <div className="routine-card__actions">
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
                  disabled={busy !== null}
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
    name: routine?.name || "",
    instructions: routine?.instructions || "",
    agentId: routine?.agentId || snapshot.agents[0]?.id || "",
    enabled: routine?.enabled ?? true,
    schedule: routine?.schedule || ("daily" as "interval" | "daily"),
    intervalMinutes: routine?.intervalMinutes || 60,
    dailyTime: routine?.dailyTime || "09:00",
    notes: routine?.notes || "",
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
    <Modal title={routine ? "Edit routine" : "New routine"} onClose={onClose}>
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
              {snapshot.agents.map((agent) => (
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
        description="Open a past job to review its run, notes, and output."
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
                Live work uses your ChatGPT sign-in. Authentication opens the
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
                    : auth.error ||
                      "Demo mode is available without an account."}
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
              <h2>Work mode</h2>
              <p>
                Demo replays sample workflows from the runtime. Live mode starts
                real Codex work.
              </p>
            </div>
          </div>
          <div className="mode-options">
            <button
              className={snapshot.settings.mode === "demo" ? "active" : ""}
              onClick={() =>
                run({ type: "settings.update", settings: { mode: "demo" } })
              }
            >
              <span className="mode-radio" />
              <span>
                <strong>Demo</strong>
                <small>
                  Explore the full office with local simulated work.
                </small>
              </span>
            </button>
            <button
              className={snapshot.settings.mode === "live" ? "active" : ""}
              disabled={auth.status !== "signed-in"}
              onClick={() =>
                run({ type: "settings.update", settings: { mode: "live" } })
              }
            >
              <span className="mode-radio" />
              <span>
                <strong>Live</strong>
                <small>
                  {auth.status === "signed-in"
                    ? "Run work through your connected account."
                    : "Sign in with ChatGPT to unlock live work."}
                </small>
              </span>
              <ShieldCheck size={17} />
            </button>
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
                <small>The Codex model used for new live work.</small>
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
  onError: (message: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"activity" | "artifacts">(
    initialArtifactId ? "artifacts" : "activity",
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
  const runItem = snapshot.runs.find((item) => work && item.workId === work.id);
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
      {tab === "activity" ? (
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
              <span>Mode</span>
              <strong>
                {work?.mode?.toUpperCase() ||
                  snapshot.settings.mode.toUpperCase()}
              </strong>
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
              work={work}
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
                placeholder="Ask for a change or add context"
                disabled={
                  !["running", "waiting", "queued"].includes(work.status)
                }
              />
              <button
                className="icon-button icon-button--send"
                disabled={
                  busy !== null ||
                  !steer.trim() ||
                  !["running", "waiting", "queued"].includes(work.status)
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

function ArtifactPreview({
  artifact,
  work,
  snapshot,
  onOpen,
}: {
  artifact: Artifact;
  work?: WorkItem;
  snapshot: Snapshot;
  onOpen: () => void;
}) {
  const [linkError, setLinkError] = useState("");
  const calendar =
    artifact.kind === "calendar"
      ? snapshot.calendar.find(
          (item) =>
            artifact.content.includes(item.id) ||
            item.sourceIds.some((id) => work?.sourceIds.includes(id)),
        )
      : undefined;
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
            <ExternalLink size={14} /> Open file
          </button>
        )}
      </header>
      {artifact.kind === "patch" ? (
        <pre>
          <code>{artifact.content}</code>
        </pre>
      ) : calendar ? (
        <div className="calendar-card">
          <span className="calendar-card__date">
            <b>
              {new Date(calendar.start).toLocaleDateString([], {
                day: "numeric",
              })}
            </b>
            {new Date(calendar.start).toLocaleDateString([], {
              month: "short",
            })}
          </span>
          <div>
            <h4>{calendar.title}</h4>
            <p>
              {new Date(calendar.start).toLocaleString([], {
                weekday: "long",
                hour: "numeric",
                minute: "2-digit",
              })}{" "}
              to{" "}
              {new Date(calendar.end).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })}
            </p>
            <p>{calendar.location}</p>
            <small>{calendar.attendees.join(", ")}</small>
          </div>
        </div>
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
