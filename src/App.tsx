import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDownLeft,
  History,
  ArrowRight,
  Bell,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Coffee,
  Ellipsis,
  Flag,
  Focus,
  FolderOpen,
  Home,
  Inbox,
  Leaf,
  LoaderCircle,
  Megaphone,
  MessageCircle,
  Minus,
  Plus,
  Search,
  Settings,
  Sparkles,
  Target,
  Users,
  Volume2,
  X,
} from 'lucide-react';
import type {
  AppState,
  Approval,
  CloudSettings,
  Commitment,
  Employee,
  Integration,
  Page,
  WorkspaceFolder,
} from '../shared/types';
import {
  clockTime,
  dueLabel,
  employeeById,
  employeeColors,
  folderBrief,
  getLocalStateRecovery,
  initialState,
  normalizeState,
  profileSuggestion,
  readLocalState,
  recoverLocalState,
  saveLocalState,
  timeNow,
  uid,
} from './lib/store';
import { AgentConfigSchema, resolveAgentConfig, type AgentConfig } from '../shared/agent-config';
import { AgentConfiguration } from './components/AgentConfiguration';
import { AgentWorkspace } from './components/AgentWorkspace';
import { allowedPath, containsSecret, MAX_FILES, MAX_FILE_SIZE, MAX_FOLDER_SIZE } from '../shared/workspace';
import Avatar from './components/Avatar';
import { applyDecision, applySession } from './lib/workflow';
import Modal from './components/Modal';
import SceneBoundary from './components/SceneBoundary';
import Markdown from './components/Markdown';
import OfficeActivity from './components/OfficeActivity';
import { useOfficeReplay, OfficeReplayTimeline } from './components/OfficeReplay';
import { OfficeToolAtlas } from './components/OfficeToolAtlas';
import type { OfficeStation } from '../shared/office-tool-atlas';
import { AppearanceEditor, VoiceAnnounce, ConnectionSettings, ActivityPage } from './components/HQFeatures';
import {
  AnnouncePage,
  CommitmentsPage,
  ConversationsPage,
  EmployeesPage,
  NeedsYouPage,
  SettingsPage,
} from './components/Pages';
const OfficeScene = lazy(() => import('./components/OfficeScene'));
const nav = [
  { id: 'office', label: 'Office', icon: Home },
  { id: 'employees', label: 'Employees', icon: Users },
  { id: 'announce', label: 'Announce', icon: Megaphone },
  { id: 'commitments', label: 'Commitments', icon: Flag },
  { id: 'conversations', label: 'Conversations', icon: MessageCircle },
  { id: 'activity', label: 'Activity', icon: History },
  { id: 'needs-you', label: 'Needs you', icon: Inbox },
] as const;
const pageNames: Record<Page, string> = {
  office: 'Office',
  employees: 'Employees',
  announce: 'Announce',
  commitments: 'Commitments',
  conversations: 'Conversations',
  'needs-you': 'Needs you',
  activity: 'Activity',
  settings: 'Workspace settings',
};
export type UpdateState = (update: (s: AppState) => AppState) => void;
export default function App() {
  const [state, setState] = useState<AppState>(readLocalState);
  const [recovery, setRecovery] = useState(getLocalStateRecovery);
  const [ready, setReady] = useState(!window.ahq);
  const [page, setPage] = useState<Page>('office');
  const [conversationTarget, setConversationTarget] = useState('team');
  const [cloud, setCloud] = useState<CloudSettings>({ endpoint: '', configured: false, connected: false });
  const [toast, setToast] = useState('');
  const [modal, setModal] = useState<
    'employee' | 'commitment' | 'goal' | 'search' | 'help' | 'folder' | 'storage' | 'atlas' | null
  >(null);
  const [atlasStation, setAtlasStation] = useState<OfficeStation | undefined>(undefined);
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [selectedApproval, setSelectedApproval] = useState<string | null>(null);
  const [selectedCommitment, setSelectedCommitment] = useState<string | null>(null);
  const [playing, setPlaying] = useState(true);
  const [systemReducedMotion, setSystemReducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setSystemReducedMotion(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  const [angle, setAngle] = useState(0);
  const [listening, setListening] = useState(false);
  const [microphoneLevel, setMicrophoneLevel] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const folderInput = useRef<HTMLInputElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const notify = useCallback((text: string) => setToast(text), []);
  const update: UpdateState = useCallback((fn) => setState((previous) => fn(previous)), []);
  const history = useOfficeReplay(state, update, notify);
  useEffect(() => {
    if (!ready) return;
    return window.ahq?.onAgentSession?.(({ employeeId, session }) => {
      if (getLocalStateRecovery()) return;
      update((current) =>
        current.employees.some((employee) => employee.id === employeeId)
          ? applySession(current, employeeId, session)
          : current,
      );
    });
  }, [ready, update]);
  const pastFrame = history.frame;
  const officeState = history.display;
  const lastFrame = useRef(0);
  const frameTime = useRef(Date.now() / 1000);
  if (playing && !listening && !state.reducedMotion && !systemReducedMotion)
    frameTime.current = history.at === null ? history.now / 1000 : history.at / 1000;
  useEffect(() => {
    if (!window.ahq || history.at !== null || !ready) return;
    const time = Date.now();
    if (time - lastFrame.current < (listening ? 100 : 5000)) return;
    lastFrame.current = time;
    void window.ahq
      .recordFrame({
        time,
        sceneTime: frameTime.current,
        listening,
        level: microphoneLevel,
        motion: !state.reducedMotion && !systemReducedMotion && playing,
      })
      .catch(() => undefined);
  }, [
    listening,
    microphoneLevel,
    history.at,
    history.now,
    ready,
    state.reducedMotion,
    playing,
    systemReducedMotion,
  ]);
  useEffect(() => {
    lastFrame.current = 0;
  }, [listening, state.reducedMotion]);
  async function broadcast(text: string) {
    if (getLocalStateRecovery()) throw new Error('Recover the saved workspace before starting cloud work.');
    if (!window.ahq) throw new Error('Open the desktop app to announce to your employees.');
    await saveChain.current;
    await window.ahq.saveState(stateRef.current);
    const results = await window.ahq.broadcast(text);
    const saved = await window.ahq.loadState();
    if (saved) setState(normalizeState(saved));
    const failed = results.filter((r) => r.error);
    notify(
      failed.length
        ? `Reached ${results.length - failed.length} employees. ${failed.map((f) => state.employees.find((e) => e.id === f.employeeId)?.name).join(', ')} could not receive the announcement.`
        : 'Announcement submitted to the employee sessions.',
    );
  }
  useEffect(() => {
    const room = (event: Event) => {
      const key = (event as CustomEvent<string>).detail;
      if (key === 'library') setModal('folder');
      else if (key === 'meeting') navigate('conversations');
      else if (key === 'lounge') navigate('employees');
      else setAngle(0);
    };
    window.addEventListener('ahq:room', room);
    return () => window.removeEventListener('ahq:room', room);
  }, []);
  useEffect(() => {
    if (!window.ahq) return;
    let cancelled = false;
    Promise.all([window.ahq.loadState(), window.ahq.getCloudSettings()])
      .then(([saved, settings]) => {
        if (!cancelled) {
          if (saved !== null) {
            const parsed = normalizeState(saved);
            if (getLocalStateRecovery()) {
              try {
                recoverLocalState(parsed);
              } catch (error) {
                notify(
                  error instanceof Error
                    ? error.message
                    : 'The original cache is preserved. Saving remains paused.',
                );
              }
              setRecovery(getLocalStateRecovery());
            }
            setState(parsed);
          }
          setCloud(settings);
          setReady(true);
          void window
            .ahq!.needsStorageSetup()
            .then((needs) => {
              if (needs) setModal('storage');
            })
            .catch(() => undefined);
        }
      })
      .catch(() => {
        if (!cancelled) {
          notify('Your desktop workspace could not be loaded. Using the local cache.');
          setReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [notify]);
  const saveChain = useRef(Promise.resolve());
  useEffect(() => {
    if (!ready || getLocalStateRecovery()) return;
    try {
      saveLocalState(state);
    } catch {
      notify('Storage is full. Export your documents before closing.');
    }
    if (window.ahq)
      saveChain.current = saveChain.current
        .then(() => window.ahq!.saveState(state))
        .catch(() => notify('Could not save to disk. Your browser cache is still available.'));
  }, [state, ready, notify]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 5200);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setModal('search');
      }
    };
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, []);
  useEffect(() => {
    if (!window.ahq || !cloud.configured) return;
    let stopped = false,
      polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        for (const employee of stateRef.current.employees.filter(
          (e) => e.sessionId && e.status !== 'ready',
        )) {
          try {
            const session = await window.ahq!.getSession(employee.sessionId!);
            if (stopped) return;
            setCloud((c) => ({ ...c, connected: true }));
            update((s) => applySession(s, employee.id, session));
          } catch {
            if (!stopped) {
              setCloud((c) => ({ ...c, connected: false }));
              update((s) => ({
                ...s,
                employees: s.employees.map((e) =>
                  e.id === employee.id
                    ? { ...e, status: 'offline', activity: 'Connection lost · waiting to reconnect' }
                    : e,
                ),
              }));
            }
          }
        }
      } finally {
        polling = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 8000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [cloud.configured, update]);
  const pending = state.approvals.filter((a) => a.status === 'pending');
  const previousPending = useRef(pending.length);
  useEffect(() => {
    if (ready && state.sound && pending.length > previousPending.current) playReviewChime();
    previousPending.current = pending.length;
  }, [pending.length, ready, state.sound]);
  const person = employeeById(state.employees, selectedEmployee ?? undefined);
  const approval = state.approvals.find((a) => a.id === selectedApproval);
  const commitment = state.commitments.find((c) => c.id === selectedCommitment);
  function navigate(to: Page) {
    setPage(to);
    setModal(null);
    setSelectedEmployee(null);
    setSelectedCommitment(null);
  }
  function addEvent(text: string, kind: 'system' | 'review' | 'announcement' = 'system') {
    return { id: uid(), text, time: timeNow(), kind, source: 'local' as const };
  }
  async function decide(a: Approval, decision: 'approved' | 'changes-requested', feedback = '') {
    if (busy || a.status !== 'pending') return;
    setBusy(true);
    try {
      let response: import('../shared/types').CloudSession | undefined;
      if (a.sessionId) {
        if (!window.ahq) throw new Error('Open the desktop app to review a cloud output.');
        response = await window.ahq.decideSession({
          sessionId: a.sessionId,
          version: a.version,
          decision: decision === 'approved' ? 'approve' : 'request_changes',
          feedback,
        });
      }
      const latest = stateRef.current.approvals.find((item) => item.id === a.id);
      if (!latest || latest.status !== 'pending' || latest.version !== a.version)
        throw new Error('This review changed. Open the latest version.');
      update((s) => {
        const current = s.approvals.find((item) => item.id === a.id);
        if (!current || current.status !== 'pending' || current.version !== a.version) return s;
        const next = applyDecision(s, a.id, a.version, decision, feedback);
        return response ? applySession(next, a.employeeId, response) : next;
      });
      notify(
        decision === 'approved'
          ? 'Review approved. Your decision is saved.'
          : 'Your feedback is saved with this review.',
      );
      setSelectedApproval(null);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not save the decision. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  async function exportApproval(a: Approval) {
    if (window.ahq) {
      try {
        if (await window.ahq.exportDocument({ title: a.title, content: a.content }))
          notify('Document exported.');
      } catch {
        notify('Could not export the document.');
      }
    } else {
      const url = URL.createObjectURL(new Blob([a.content], { type: 'text/markdown' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${a.title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.md`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify('Your document is downloading.');
    }
  }
  function registerFolder(folder: WorkspaceFolder) {
    update((s) => ({
      ...s,
      folders: [...s.folders, folder],
      events: [...s.events, addEvent(`Created a local working copy of “${folder.name}”`)],
    }));
    setModal(null);
    notify(`${folder.files.length} files copied into your local workspace.`);
  }
  async function selectFolder() {
    if (window.ahq) {
      setBusy(true);
      try {
        const result = await window.ahq.selectFolder();
        if (result) registerFolder(result);
      } catch (error) {
        notify(error instanceof Error ? error.message : 'Unable to read that folder.');
      } finally {
        setBusy(false);
      }
    } else folderInput.current?.click();
  }
  async function importBrowserFolder(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      const first = files[0].webkitRelativePath.split('/')[0] || 'Selected folder';
      const folder: WorkspaceFolder = {
        id: uid(),
        name: first,
        files: [],
        createdAt: timeNow(),
        excludedCount: 0,
      };
      let bytes = 0;
      for (const file of Array.from(files)) {
        const path = file.webkitRelativePath.split('/').slice(1).join('/') || file.name;
        if (
          !allowedPath(path) ||
          file.size > MAX_FILE_SIZE ||
          bytes + file.size > MAX_FOLDER_SIZE ||
          folder.files.length >= MAX_FILES
        ) {
          folder.excludedCount++;
          continue;
        }
        const text = await file.text();
        if (containsSecret(text)) {
          folder.excludedCount++;
          continue;
        }
        folder.files.push({ path, size: file.size, excerpt: text.slice(0, 1500) });
        bytes += file.size;
      }
      if (!folder.files.length)
        throw new Error('No supported text files found. Try a folder with .md, .txt, or .csv files.');
      registerFolder(folder);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Unable to read that folder.');
    } finally {
      setBusy(false);
      if (folderInput.current) folderInput.current.value = '';
    }
  }
  function createBrief(folder: WorkspaceFolder) {
    const a: Approval = {
      id: uid(),
      title: `${folder.name} · workspace brief`,
      summary: 'A local source inventory, ready to review.',
      employeeId: 'you',
      content: folderBrief(folder),
      createdAt: timeNow(),
      status: 'pending',
      kind: 'document',
      recipient: 'Your workspace · local only',
      sources: folder.files.map((f) => f.path),
      version: 1,
    };
    update((s) => ({
      ...s,
      approvals: [...s.approvals, a],
      events: [...s.events, addEvent(`Prepared a local source brief for “${folder.name}”`, 'review')],
    }));
    setSelectedApproval(a.id);
  }
  const common = { state, update, notify };
  return (
    <div className={`app-shell ${state.reducedMotion ? 'reduce-motion' : ''}`}>
      <aside className="sidebar">
        <a
          className="brand"
          href="#office"
          onClick={(e) => {
            e.preventDefault();
            navigate('office');
          }}
          aria-label="Astra HQ home"
        >
          <span className="brand-mark">
            a<span>✳</span>
          </span>
          <span>
            astra<span className="brand-hq">HQ</span>
          </span>
        </a>
        <button className="workspace-switch" onClick={() => navigate('settings')}>
          <span className="workspace-icon">
            <Leaf size={17} />
          </span>
          <span>
            {state.workspaceName}
            <small>Personal workspace</small>
          </span>
          <ChevronDown size={14} />
        </button>
        <span className="nav-caption">YOUR WORKSPACE</span>
        <nav aria-label="Main navigation">
          {nav.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${page === item.id ? 'active' : ''}`}
              onClick={() => navigate(item.id)}
              aria-current={page === item.id ? 'page' : undefined}
              aria-label={
                item.id === 'needs-you' && pending.length
                  ? `${item.label}: ${pending.length} pending reviews`
                  : item.label
              }
            >
              <item.icon size={19} strokeWidth={1.7} />
              <span>{item.label}</span>
              {item.id === 'needs-you' && pending.length > 0 && (
                <span className="nav-count">{pending.length}</span>
              )}
              {item.id === 'announce' && <span className="tiny-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-lower">
          <div className="workspace-note">
            <span className="note-icon">
              <Sparkles size={20} />
            </span>
            <strong>Good work starts together.</strong>
            <p>
              A little clarity. A little teamwork.
              <br />A lot more possibility.
            </p>
            <button onClick={() => setModal('help')}>
              Make yourself at home <ArrowRight size={14} />
            </button>
          </div>
          <button
            className={`nav-item ${page === 'settings' ? 'active' : ''}`}
            onClick={() => navigate('settings')}
            aria-label="Settings and connections"
          >
            <Settings size={18} strokeWidth={1.7} />
            <span>Settings & connections</span>
          </button>
          <button className="profile" onClick={() => navigate('settings')}>
            <Avatar size={34} />
            <span>
              Your workspace<small>Let’s make good things.</small>
            </span>
            <Ellipsis size={18} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>{state.workspaceName}</span>
            <ChevronRight size={13} />
            <strong>{pageNames[page]}</strong>
          </div>
          <div className="topbar-actions">
            <span className="today">
              {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
            </span>
            <span className="topbar-line" />
            <button
              className="search-button"
              aria-label="Search workspace"
              onClick={() => setModal('search')}
            >
              <Search size={17} />
              <span>Search anything</span>
              <kbd>⌘ K</kbd>
            </button>
            <button
              className="notification-button icon-button"
              aria-label={`${pending.length} pending reviews`}
              onClick={() => navigate('needs-you')}
            >
              <Bell size={18} />
              {pending.length > 0 && <i />}
            </button>
            <Avatar size={31} />
          </div>
        </header>
        {recovery && (
          <div className="agent-config-recovery" role="alert">
            <strong>Workspace recovery · saving paused</strong>
            <p>{recovery.message}</p>
            {recovery.backupKey && <small>Preserved backup: {recovery.backupKey}</small>}
          </div>
        )}
        <main>
          <div className="page-header">
            <div>
              <div className="page-eyebrow">A LITTLE SPACE FOR BIG THINGS</div>
              <h1>{page === 'office' ? 'Your office, in good company.' : pageNames[page]}</h1>
              <p>
                {
                  {
                    office: 'The big picture, the little details, and everyone moving things forward.',
                    employees: 'Good people. Clear roles. A shared direction.',
                    announce: 'One shared direction. Everyone on the same page.',
                    commitments: 'Flexibility in the path. Reliability in the promise.',
                    conversations: 'The thinking, the handoffs, and the conversations in between.',
                    'needs-you': 'A few thoughtful decisions to keep good things moving.',
                    activity: 'Your decisions. Their work. Every step recorded.',
                    settings: 'Make this space work for you.',
                  }[page]
                }
              </p>
            </div>
            <div className="page-actions">
              {page === 'office' && (
                <span className="mode-badge">
                  <span className={cloud.connected ? 'status-dot' : 'sample-dot'} />
                  {cloud.connected ? 'Cloud connected' : 'Sample office'}
                </span>
              )}
              {page === 'office' || page === 'employees' ? (
                <button
                  className="button primary"
                  disabled={page === 'office' && history.at !== null}
                  onClick={() => setModal('employee')}
                >
                  <Plus size={16} />
                  New employee
                </button>
              ) : page === 'commitments' ? (
                <button className="button primary" onClick={() => setModal('commitment')}>
                  <Plus size={16} />
                  New commitment
                </button>
              ) : null}
            </div>
          </div>
          {page === 'office' && (
            <>
              {officeState ? (
                <>
                  <div className="goal-banner">
                    <span className="goal-icon">
                      <Target size={19} />
                    </span>
                    <span className="goal-label">OUR NORTH STAR</span>
                    <p>{officeState.goal}</p>
                    <button
                      className="text-button"
                      disabled={history.at !== null}
                      onClick={() => setModal('goal')}
                    >
                      Edit goal <ArrowRight size={14} />
                    </button>
                  </div>
                  <div className="office-layout">
                    <section className="office-card">
                      <div className="office-card-header">
                        <div>
                          <span className="room-icon">
                            <Home size={15} />
                          </span>
                          <strong>The studio</strong>
                          <span className="small-separator" />
                          <span>{officeState.employees.length} teammates</span>
                        </div>
                        <div>
                          <span className="office-weather">
                            ☀<span>A little room to grow</span>
                          </span>
                          <button
                            className="icon-button"
                            aria-label="Rotate office view"
                            onClick={() => setAngle((v) => (v + 45) % 360)}
                          >
                            <Ellipsis size={20} />
                          </button>
                        </div>
                      </div>
                      <div className="office-viewport">
                        <div className="scene-caption">
                          <span className="eyebrow">SPACE TO DO YOUR BEST WORK</span>
                          <span className="scene-script">Better, together.</span>
                        </div>
                        <SceneBoundary onTeam={() => navigate('employees')}>
                          <Suspense
                            fallback={
                              <div className="scene-loading">
                                <LoaderCircle className="spin" size={24} />
                                <span>Opening the studio…</span>
                              </div>
                            }
                          >
                            <OfficeScene
                              employees={officeState.employees}
                              events={history.events}
                              eventTimeMs={history.at ?? history.now}
                              sample={officeState.demo}
                              selectedEmployeeId={selectedEmployee}
                              onStation={(station) => {
                                setAtlasStation(station);
                                setModal('atlas');
                              }}
                              animate={playing && !state.reducedMotion && !systemReducedMotion}
                              onSelect={(e) =>
                                history.at === null
                                  ? setSelectedEmployee(e.id)
                                  : notify(`${e.name}: ${e.activity}`)
                              }
                              zoom={zoom}
                              angle={angle}
                              timeSeconds={
                                history.at !== null
                                  ? (pastFrame?.sceneTime ?? history.at / 1000)
                                  : frameTime.current
                              }
                              live={history.at === null}
                              listening={history.at !== null ? !!pastFrame?.listening : listening}
                              microphoneLevel={
                                history.at !== null ? (pastFrame?.level ?? 0) : microphoneLevel
                              }
                            />
                          </Suspense>
                        </SceneBoundary>
                        <div className="office-hint">
                          <span className={cloud.connected ? 'status-dot' : 'sample-dot'} />
                          {history.at !== null
                            ? 'Recorded office · read only'
                            : cloud.connected
                              ? `${officeState.employees.filter((e) => e.sessionId && e.status === 'working').length} cloud sessions active`
                              : 'A preview of your future team'}
                          <span>·</span>
                          <span>
                            {history.at !== null
                              ? 'Inspect a recorded moment'
                              : 'Select a teammate or a physical tool'}
                          </span>
                        </div>
                        <div className="scene-controls">
                          <button
                            aria-label="Zoom out"
                            onClick={() => setZoom((z) => Math.max(0.7, z - 0.12))}
                            disabled={zoom <= 0.7}
                          >
                            <Minus size={17} />
                          </button>
                          <button
                            aria-label="Reset office view"
                            onClick={() => {
                              setZoom(1);
                              setPlaying(true);
                            }}
                          >
                            <Focus size={17} />
                          </button>
                          <button
                            aria-label="Zoom in"
                            onClick={() => setZoom((z) => Math.min(1.5, z + 0.12))}
                            disabled={zoom >= 1.5}
                          >
                            <Plus size={17} />
                          </button>
                        </div>
                        {history.at !== null && (
                          <div className="replay-badge">
                            <History size={14} />
                            Replay · {new Date(history.at).toLocaleTimeString()}
                          </div>
                        )}
                        {listening && (
                          <div className="replay-badge">
                            <Volume2 size={14} />
                            The whole office is listening
                          </div>
                        )}
                      </div>
                      <div className="office-footer">
                        <div className="avatar-stack">
                          {officeState.employees.slice(0, 6).map((e) => (
                            <Avatar key={e.id} employee={e} size={26} />
                          ))}
                        </div>
                        <span>{cloud.connected ? 'Your team is here.' : 'Meet your next great team.'}</span>
                        <button className="text-button" onClick={() => navigate('employees')}>
                          Meet everyone <ArrowRight size={14} />
                        </button>
                      </div>
                    </section>
                    <aside className="activity-column">
                      <OfficeActivity
                        events={history.events}
                        employees={officeState.employees}
                        replay={history.at !== null}
                        onReplay={(at) => {
                          history.setPlay(false);
                          history.setAt(at);
                        }}
                      />
                      <section className="needs-preview">
                        <div className="section-heading">
                          <h2>
                            <Inbox size={17} />A moment of your time
                          </h2>
                          <span className="count-badge">
                            {officeState.approvals.filter((item) => item.status === 'pending').length}
                          </span>
                        </div>
                        <p className="section-description">Your perspective makes the difference.</p>
                        {officeState.approvals
                          .filter((item) => item.status === 'pending')
                          .slice(0, 2)
                          .map((a, i) => (
                            <button
                              className={`review-preview ${i === 0 ? 'featured' : ''}`}
                              key={a.id}
                              disabled={history.at !== null}
                              onClick={() => setSelectedApproval(a.id)}
                            >
                              <div className="review-preview-top">
                                <span className={`approval-symbol ${i === 0 ? 'warm' : ''}`}>
                                  {i === 0 ? <Sparkles size={18} /> : <BookOpen size={18} />}
                                </span>
                                <span>
                                  {employeeById(officeState.employees, a.employeeId)?.name ?? 'Workspace'}
                                  <small>
                                    {a.kind === 'decision' ? 'A decision for you' : 'Ready for review'}
                                  </small>
                                </span>
                                <ArrowDownLeft size={15} />
                              </div>
                              <strong>{a.title}</strong>
                              <p>{a.summary}</p>
                              <span className="review-link">
                                Take a look <ArrowRight size={14} />
                              </span>
                            </button>
                          ))}
                        {officeState.approvals.filter((item) => item.status === 'pending').length === 0 && (
                          <div className="caught-up">
                            <CheckCheck size={28} />
                            <strong>A little breathing room.</strong>
                            <p>You’re all caught up.</p>
                          </div>
                        )}
                        <div className="quiet-note">
                          <Leaf size={14} />
                          <span>
                            {cloud.connected
                              ? 'Other employees can keep working.'
                              : 'A thoughtful pause, then onward.'}
                          </span>
                        </div>
                      </section>
                    </aside>
                  </div>
                  <VoiceAnnounce
                    onLevel={setMicrophoneLevel}
                    onListening={setListening}
                    onBroadcast={broadcast}
                    notify={notify}
                  />
                </>
              ) : (
                <div className="surface empty-state">
                  <History size={32} />
                  <h3>
                    {history.loading ? 'Loading the recorded office…' : 'No recorded office at this moment.'}
                  </h3>
                  <p>
                    {history.error ||
                      'Choose a recorded checkpoint on the timeline. Live state is not substituted for missing history.'}
                  </p>
                </div>
              )}
              <div className="office-guide-launch">
                <BookOpen size={23} />
                <div>
                  <strong>A place for every kind of work.</strong>
                  <p>Filing cabinets, inbox trays, research desks. Explore 45 concrete tools.</p>
                </div>
                <button
                  className="button secondary"
                  onClick={() => {
                    setAtlasStation(undefined);
                    setModal('atlas');
                  }}
                >
                  How this office works <ArrowRight size={14} />
                </button>
              </div>
              <OfficeReplayTimeline history={history} />
              <div className="page-bottom">
                <span>
                  <span className="status-dot" />
                  {ready ? 'Your workspace is saved on this device' : 'Loading your workspace'}
                </span>
                <button className="text-button" onClick={() => setModal('help')}>
                  A little help getting started <CircleHelp size={13} />
                </button>
              </div>
            </>
          )}
          {page === 'employees' && (
            <EmployeesPage
              {...common}
              onCreate={() => setModal('employee')}
              onSelect={(e) => setSelectedEmployee(e.id)}
            />
          )}
          {page === 'announce' && (
            <>
              <VoiceAnnounce
                onLevel={setMicrophoneLevel}
                onListening={setListening}
                onBroadcast={broadcast}
                notify={notify}
              />
              <AnnouncePage {...common} onBroadcast={broadcast} onEditGoal={() => setModal('goal')} />
            </>
          )}
          {page === 'commitments' && (
            <CommitmentsPage
              {...common}
              onSelect={(c) => setSelectedCommitment(c.id)}
              onCreate={() => setModal('commitment')}
            />
          )}
          {page === 'conversations' && <ConversationsPage {...common} initialChannel={conversationTarget} />}
          {page === 'needs-you' && <NeedsYouPage {...common} onReview={(a) => setSelectedApproval(a.id)} />}
          {page === 'activity' && <ActivityPage {...common} />}
          {page === 'settings' && (
            <>
              <ConnectionSettings cloud={cloud} onCloud={setCloud} notify={notify} />
              <SettingsPage
                {...common}
                cloud={cloud}
                setCloud={setCloud}
                onSelectFolder={() => setModal('folder')}
                onBrief={createBrief}
                onReset={() => {
                  update(() => initialState());
                  notify('Sample workspace restored.');
                }}
              />
            </>
          )}
        </main>
      </div>
      <input
        ref={folderInput}
        className="hidden-input"
        type="file"
        multiple
        {...{ webkitdirectory: '' }}
        onChange={(e) => void importBrowserFolder(e.target.files)}
        aria-label="Choose workspace folder"
      />
      {modal === 'atlas' && <OfficeToolAtlas initialStation={atlasStation} onClose={() => setModal(null)} />}
      {modal === 'storage' && (
        <Modal
          title="A home for your office."
          subtitle="Choose where Astra HQ may save your local database and history."
          onClose={() => setModal(null)}
        >
          <p>
            Your team, goals, activity, and five-minute checkpoints are saved on your Mac. Choose a folder you
            own, or use Astra HQ’s application folder.
          </p>
          <div className="modal-footer">
            <button
              className="button secondary"
              onClick={() =>
                void window
                  .ahq!.useDefaultStorage()
                  .then(() => setModal(null))
                  .catch((e) => notify(String(e)))
              }
            >
              Use application folder
            </button>
            <button
              className="button primary"
              onClick={() =>
                void window
                  .ahq!.chooseDatabaseFolder()
                  .then((path) => {
                    if (path) {
                      setModal(null);
                      notify('Your local database folder is ready.');
                    }
                  })
                  .catch((e) => notify(String(e)))
              }
            >
              Choose a folder
            </button>
          </div>
        </Modal>
      )}
      {modal === 'employee' && (
        <EmployeeForm
          initial={editingEmployee ?? undefined}
          employees={state.employees}
          onClose={() => {
            setModal(null);
            setEditingEmployee(null);
          }}
          onCreate={(fields) => {
            if (editingEmployee) {
              update((s) => ({
                ...s,
                employees: s.employees.map((e) => (e.id === editingEmployee.id ? { ...e, ...fields } : e)),
              }));
              setEditingEmployee(null);
              setModal(null);
              setSelectedEmployee(editingEmployee.id);
              notify('Employee configuration saved. It applies to the next manager turn or new assignment.');
              return;
            }
            const employee: Employee = {
              ...fields,
              id: uid(),
              color: employeeColors[state.employees.length % employeeColors.length],
              avatar: state.employees.length % 6,
              status: 'ready',
              activity: 'Ready for a first assignment',
              location: 'desk',
            };
            update((s) => ({
              ...s,
              employees: [...s.employees, employee],
              events: [...s.events, addEvent(`${employee.name} joined the team`)],
            }));
            setModal(null);
            setSelectedEmployee(employee.id);
            notify(`${employee.name} has a place at the table.`);
          }}
        />
      )}
      {modal === 'goal' && (
        <GoalForm
          goal={state.goal}
          onClose={() => setModal(null)}
          onSave={(goal) => {
            update((s) => ({
              ...s,
              goal,
              events: [...s.events, addEvent('Updated the team’s north star', 'announcement')],
            }));
            setModal(null);
            notify('Your team’s north star is updated.');
          }}
        />
      )}
      {modal === 'commitment' && (
        <CommitmentForm
          employees={state.employees}
          onClose={() => setModal(null)}
          onSave={(c) => {
            update((s) => ({
              ...s,
              commitments: [...s.commitments, c],
              events: [...s.events, addEvent(`A new promise: ${c.title}`)],
            }));
            setModal(null);
            notify('A new promise, with a clear next step.');
          }}
        />
      )}
      {person && (
        <EmployeeDetail
          onAppearance={(appearance) => {
            update((s) => ({
              ...s,
              employees: s.employees.map((e) => (e.id === person!.id ? { ...e, appearance } : e)),
              events: [...s.events, addEvent(`Updated ${person!.name}’s appearance`)],
            }));
            notify('Appearance saved.');
          }}
          onEdit={() => {
            setEditingEmployee(person);
            setSelectedEmployee(null);
            setModal('employee');
          }}
          employee={person}
          state={state}
          cloud={cloud}
          onClose={() => setSelectedEmployee(null)}
          onChat={() => {
            setConversationTarget(person.id);
            setSelectedEmployee(null);
            navigate('conversations');
          }}
          onSettings={() => {
            setSelectedEmployee(null);
            navigate('settings');
          }}
          onStart={async (assignment, folderIds, allowCloudUpload) => {
            if (getLocalStateRecovery())
              throw new Error('Recover the saved workspace before starting cloud work.');
            if (!window.ahq) throw new Error('Cloud sessions are available in the desktop app.');
            await saveChain.current;
            await window.ahq.saveState(stateRef.current);
            const session = await window.ahq.startSession({
              employee: person,
              assignment,
              goal: state.goal,
              folderIds,
              allowCloudUpload,
            });
            update((s) =>
              applySession(
                {
                  ...s,
                  demo: false,
                  events: [
                    ...s.events,
                    {
                      id: uid(),
                      employeeId: person.id,
                      text: `Started an Astra cloud session: ${assignment}`,
                      time: timeNow(),
                      kind: 'work',
                      source: 'cloud',
                    },
                  ],
                },
                person.id,
                session,
              ),
            );
            notify(`${person.name}’s Astra cloud session has started.`);
          }}
        />
      )}
      {approval && (
        <ReviewDialog
          approval={approval}
          employee={employeeById(state.employees, approval.employeeId)}
          busy={busy}
          onClose={() => setSelectedApproval(null)}
          onDecide={(d, f) => void decide(approval, d, f)}
          onExport={() => void exportApproval(approval)}
        />
      )}
      {commitment && (
        <Modal
          title={commitment.title}
          subtitle={`${dueLabel(commitment.deadline)} · ${clockTime(commitment.deadline)} · ${commitment.firm ? 'Firm promise' : 'Flexible target'}`}
          onClose={() => setSelectedCommitment(null)}
        >
          <div className="commitment-detail">
            <p>{commitment.description}</p>
            <div className="detail-grid">
              <div>
                <label>ACCOUNTABLE OWNER</label>
                <strong>{employeeById(state.employees, commitment.ownerId)?.name ?? 'Unassigned'}</strong>
              </div>
              <div>
                <label>PREPARED FOR</label>
                <strong>{commitment.recipient}</strong>
              </div>
            </div>
            <label>WHAT DONE LOOKS LIKE</label>
            <p>{commitment.definitionOfDone}</p>
            <div className="next-step">
              <Flag size={18} />
              <div>
                <strong>Your next useful step</strong>
                <p>{commitment.nextStep}</p>
              </div>
            </div>
            {commitment.dependencies.length > 0 && (
              <p className="muted">
                Depends on:{' '}
                {commitment.dependencies
                  .map((id) => state.commitments.find((c) => c.id === id)?.title ?? id)
                  .join(', ')}
              </p>
            )}
            <div className="modal-footer">
              <span className="muted">Source: {commitment.source}</span>
              <button
                className="button primary"
                onClick={() => {
                  const related = pending.find((a) => a.commitmentId === commitment.id);
                  if (related) {
                    setSelectedCommitment(null);
                    setSelectedApproval(related.id);
                  } else {
                    const owner = employeeById(state.employees, commitment.ownerId);
                    setSelectedCommitment(null);
                    if (owner) setSelectedEmployee(owner.id);
                  }
                }}
              >
                {pending.some((a) => a.commitmentId === commitment.id) ? 'Open review' : 'Speak to the owner'}
                <ArrowRight size={15} />
              </button>
            </div>
          </div>
        </Modal>
      )}
      {modal === 'folder' && (
        <Modal
          title="Give your team a starting point."
          subtitle="A working copy, with you in control."
          onClose={() => setModal(null)}
        >
          <div className="folder-explainer">
            <FolderOpen size={38} />
            <p>
              Select a project folder to create an isolated local copy of its supported text files. Your
              original files stay in place.
            </p>
            <ul>
              <li>Up to 100 text files, 512 KB each, 8 MB total.</li>
              <li>Hidden folders, common secrets, and unsupported files are excluded.</li>
              <li>Nothing is uploaded until you explicitly share it in a cloud assignment.</li>
            </ul>
            {!window.ahq && (
              <div className="info-note">
                Browser preview stores short text excerpts locally. Use the desktop app for complete file
                snapshots and cloud assignments.
              </div>
            )}
          </div>
          <div className="modal-footer">
            <span className="muted">Markdown, text, CSV, and code</span>
            <button className="button primary" onClick={() => void selectFolder()} disabled={busy}>
              {busy ? <LoaderCircle size={16} className="spin" /> : <FolderOpen size={16} />}Choose a folder
            </button>
          </div>
        </Modal>
      )}
      {modal === 'search' && (
        <Modal
          title="Find your way around."
          onClose={() => {
            setModal(null);
            setSearch('');
          }}
        >
          <div className="search-field">
            <Search size={20} />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="People, promises, and places…"
            />
          </div>
          <div className="search-results">
            {nav
              .filter((n) => n.label.toLowerCase().includes(search.toLowerCase()))
              .map((n) => (
                <button key={n.id} onClick={() => navigate(n.id)}>
                  <n.icon size={18} />
                  <span>
                    {n.label}
                    <small>Workspace</small>
                  </span>
                  <ArrowRight size={16} />
                </button>
              ))}
            {state.employees
              .filter((e) => `${e.name} ${e.jobTitle}`.toLowerCase().includes(search.toLowerCase()))
              .map((e) => (
                <button
                  key={e.id}
                  onClick={() => {
                    setModal(null);
                    setSelectedEmployee(e.id);
                  }}
                >
                  <Avatar employee={e} size={30} />
                  <span>
                    {e.name}
                    <small>{e.jobTitle}</small>
                  </span>
                  <ArrowRight size={16} />
                </button>
              ))}
            {state.commitments
              .filter((c) => c.title.toLowerCase().includes(search.toLowerCase()))
              .map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    setModal(null);
                    setSelectedCommitment(c.id);
                  }}
                >
                  <Flag size={18} />
                  <span>
                    {c.title}
                    <small>Commitment · {dueLabel(c.deadline)}</small>
                  </span>
                  <ArrowRight size={16} />
                </button>
              ))}
            {search &&
              ![
                ...nav.map((n) => n.label),
                ...state.employees.map((e) => `${e.name} ${e.jobTitle}`),
                ...state.commitments.map((c) => c.title),
              ].some((t) => t.toLowerCase().includes(search.toLowerCase())) && (
                <div className="empty-state">
                  <Search size={24} />
                  <p>No matches yet. Try a name or a promise.</p>
                </div>
              )}
          </div>
        </Modal>
      )}
      {modal === 'help' && (
        <Modal
          title="Make yourself at home."
          subtitle="A few small steps toward a little more possibility."
          onClose={() => setModal(null)}
        >
          <div className="guide-list">
            {[
              {
                icon: Target,
                title: 'Start with a shared direction',
                text: 'Set your north star: the outcome you want your team to work toward.',
                action: () => setModal('goal'),
              },
              {
                icon: Users,
                title: 'Give someone a place on the team',
                text: 'Define their role, then choose thinking effort, tools, memory, communication, and autonomy. Every employee uses Astra.',
                action: () => setModal('employee'),
              },
              {
                icon: FolderOpen,
                title: 'Bring the context',
                text: 'Choose a folder, make a local working copy, and review the source brief.',
                action: () => setModal('folder'),
              },
              {
                icon: Sparkles,
                title: 'Connect the work',
                text: 'Add your Astra / OpenAI API key in Settings to run real cloud sessions.',
                action: () => navigate('settings'),
              },
            ].map((item, i) => (
              <button key={item.title} onClick={item.action}>
                <span>{i + 1}</span>
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.text}</p>
                </div>
                <ArrowRight size={17} />
              </button>
            ))}
          </div>
          <div className="info-note">
            You’re exploring a sample workspace. Example conversations and deliverables are labeled. New
            actions are saved locally; employee work starts only with a connected Astra cloud session.
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          <span>{toast}</span>
          <button aria-label="Dismiss notification" onClick={() => setToast('')}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
function playReviewChime() {
  try {
    const ctx = new AudioContext();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.frequency.setValueAtTime(660, ctx.currentTime);
    gain.gain.setValueAtTime(0.035, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.5);
    oscillator.onended = () => void ctx.close();
  } catch {
    /* Audio is optional. */
  }
}
function EmployeeForm({
  initial,
  employees,
  onClose,
  onCreate,
}: {
  initial?: Employee;
  employees: Employee[];
  onClose: () => void;
  onCreate: (
    e: Pick<Employee, 'name' | 'jobTitle' | 'personality' | 'skills'> & { agent: AgentConfig },
  ) => void;
}) {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [integrationError, setIntegrationError] = useState('');
  const [agent, setAgent] = useState(() => resolveAgentConfig(initial?.agent));
  const [formError, setFormError] = useState('');
  useEffect(() => {
    void window.ahq
      ?.integrations()
      .then(setIntegrations)
      .catch(() =>
        setIntegrationError(
          'Connections could not be loaded. Existing selections are preserved; reconnect in Settings before using them.',
        ),
      );
  }, []);
  const [fields, setFields] = useState({
    name: initial?.name ?? '',
    jobTitle: initial?.jobTitle ?? '',
    personality: initial?.personality ?? '',
    skills: initial?.skills ?? '',
  });
  return (
    <Modal
      title={initial ? `Configure ${initial.name}.` : 'Welcome a new employee.'}
      subtitle="Define their role and review how they will work. You choose every setting; Astra is included."
      onClose={onClose}
      wide
    >
      <form
        onInvalidCapture={(event) => {
          const details = (event.target as HTMLElement).closest('details');
          if (details) details.open = true;
        }}
        onSubmit={(e) => {
          e.preventDefault();
          const parsed = AgentConfigSchema.safeParse({
            ...agent,
            revision: initial?.agent ? initial.agent.revision + 1 : 1,
            reviewedAt: timeNow(),
          });
          if (!parsed.success) {
            setFormError(
              parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(' '),
            );
            return;
          }
          if (Object.values(fields).every((v) => v.trim())) {
            onCreate({
              name: fields.name.trim(),
              jobTitle: fields.jobTitle.trim(),
              personality: fields.personality.trim(),
              skills: fields.skills.trim(),
              agent: parsed.data,
            });
          } else setFormError('Complete the name, job title, personality, and skills.');
        }}
      >
        <div className="new-person-preview">
          <div className="new-person-icon">
            <Users size={29} />
          </div>
          <span>
            {fields.name || 'Your next great teammate'}
            <small>{fields.jobTitle || 'A space with their name on it'}</small>
          </span>
          <Leaf size={22} />
        </div>
        <div className="form-grid">
          <label>
            Name
            <input
              autoFocus
              required
              maxLength={40}
              placeholder="e.g. Alex"
              value={fields.name}
              onChange={(e) => setFields({ ...fields, name: e.target.value })}
            />
          </label>
          <label>
            Job title
            <input
              required
              maxLength={80}
              placeholder="e.g. Research Assistant"
              value={fields.jobTitle}
              onChange={(e) => setFields({ ...fields, jobTitle: e.target.value })}
            />
          </label>
        </div>
        <div className="label-row">
          <label htmlFor="personality">Personality</label>
          <button
            type="button"
            className="text-button"
            disabled={!fields.jobTitle.trim()}
            onClick={() => setFields({ ...fields, ...profileSuggestion(fields.jobTitle) })}
          >
            <Sparkles size={13} />
            Use a suggested profile
          </button>
        </div>
        <textarea
          id="personality"
          required
          maxLength={2000}
          placeholder="How do they approach the work and talk to the team?"
          value={fields.personality}
          onChange={(e) => setFields({ ...fields, personality: e.target.value })}
          rows={3}
        />
        <label>
          Skills
          <textarea
            required
            maxLength={2000}
            placeholder="What should they be good at?"
            value={fields.skills}
            onChange={(e) => setFields({ ...fields, skills: e.target.value })}
            rows={3}
          />
        </label>
        <p className="form-hint">
          Skills describe expertise. Select actual tools and connections in the configuration below.
        </p>
        {integrationError && (
          <p className="agent-config-error" role="status">
            {integrationError}
          </p>
        )}
        <AgentConfiguration
          value={agent}
          onChange={(next) => {
            setAgent(next);
            setFormError('');
          }}
          integrations={integrations}
          employees={employees}
          employeeId={initial?.id}
        />
        {initial?.sessionId && (
          <p className="form-hint">
            The active request keeps its current settings. Saved changes apply to the next manager turn or new
            assignment.
          </p>
        )}
        {formError && (
          <p className="form-error" role="alert">
            {formError}
          </p>
        )}
        <div className="modal-footer">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" type="submit">
            <Plus size={16} />
            {initial ? 'Save configuration' : 'Create employee'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function GoalForm({
  goal,
  onClose,
  onSave,
}: {
  goal: string;
  onClose: () => void;
  onSave: (goal: string) => void;
}) {
  const [value, setValue] = useState(goal);
  return (
    <Modal
      title="What are we working toward?"
      subtitle="A clear north star gives every small step a little more meaning."
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onSave(value.trim());
        }}
      >
        <label>
          Our overarching goal
          <textarea
            autoFocus
            rows={4}
            maxLength={500}
            required
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <div className="info-note">
          <Target size={18} />
          This goal becomes context for every new cloud assignment.
        </div>
        <div className="modal-footer">
          <span className="muted">{value.length}/500</span>
          <button className="button primary" type="submit">
            Set our direction <ArrowRight size={15} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
function CommitmentForm({
  employees,
  onClose,
  onSave,
}: {
  employees: Employee[];
  onClose: () => void;
  onSave: (c: Commitment) => void;
}) {
  return (
    <Modal
      title="Make a little promise."
      subtitle="An outcome, a person, and a clear definition of done."
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          const title = String(data.get('title')).trim();
          if (!title) return;
          onSave({
            id: uid(),
            title,
            description: String(data.get('description')).trim(),
            ownerId: String(data.get('owner')),
            recipient: String(data.get('recipient')).trim(),
            deadline: new Date(String(data.get('deadline'))).toISOString(),
            firm: data.get('firm') === 'on',
            status: 'planned',
            progress: 0,
            nextStep: String(data.get('nextStep')).trim(),
            dependencies: [],
            source: 'Your instruction',
            definitionOfDone: String(data.get('done')).trim(),
          });
        }}
      >
        <label>
          What are we promising?
          <input
            autoFocus
            required
            name="title"
            maxLength={120}
            placeholder="Prepare the weekly client update"
          />
        </label>
        <label>
          A little context
          <textarea name="description" rows={2} placeholder="What should the owner know?" maxLength={2000} />
        </label>
        <div className="form-grid">
          <label>
            Accountable owner
            <select name="owner" required>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} · {e.jobTitle}
                </option>
              ))}
            </select>
          </label>
          <label>
            Who is it for?
            <input required name="recipient" placeholder="Client or stakeholder" maxLength={120} />
          </label>
        </div>
        <label>
          Deadline · your local timezone
          <input required name="deadline" type="datetime-local" />
        </label>
        <label className="checkbox-label">
          <input name="firm" type="checkbox" defaultChecked />
          This is a firm promise
        </label>
        <label>
          What does done look like?
          <textarea
            required
            rows={2}
            name="done"
            maxLength={1000}
            placeholder="A reviewed draft with this week’s progress and next milestones"
          />
        </label>
        <label>
          The first useful step
          <input required name="nextStep" maxLength={300} placeholder="Collect the project notes" />
        </label>
        <div className="modal-footer">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary">
            <Flag size={16} />
            Save commitment
          </button>
        </div>
      </form>
    </Modal>
  );
}
function EmployeeDetail({
  employee,
  state,
  cloud,
  onClose,
  onChat,
  onSettings,
  onStart,
  onEdit,
  onAppearance,
}: {
  onAppearance: (a: import('../shared/types').Appearance) => void;
  employee: Employee;
  state: AppState;
  cloud: CloudSettings;
  onClose: () => void;
  onChat: () => void;
  onSettings: () => void;
  onEdit: () => void;
  onStart: (assignment: string, folderIds: string[], allow: boolean) => Promise<void>;
}) {
  const [assignment, setAssignment] = useState('');
  const [folderIds, setFolderIds] = useState<string[]>([]);
  const [allow, setAllow] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const config = resolveAgentConfig(employee.agent);
  return (
    <Modal title={`A little time with ${employee.name}.`} onClose={onClose} wide>
      <div className="employee-detail-profile">
        <Avatar employee={employee} size={68} />
        <div>
          <h3>{employee.name}</h3>
          <p>{employee.jobTitle}</p>
          <button className="text-button edit-profile" onClick={onEdit}>
            Configure employee
          </button>
          <span className={`status-pill ${employee.status}`}>
            {employee.sessionId
              ? employee.status === 'working'
                ? 'Astra cloud session'
                : employee.status
              : 'Ready for a cloud assignment'}
          </span>
        </div>
      </div>
      <AppearanceEditor employee={employee} onSave={onAppearance} />
      <div className="detail-section">
        <label>PERSONALITY</label>
        <p>{employee.personality}</p>
        <label>SKILLS</label>
        <div className="skill-tags">
          {employee.skills.split(',').map((s) => (
            <span key={s}>{s.trim()}</span>
          ))}
        </div>
      </div>
      <div className="next-step">
        <Coffee size={19} />
        <div>
          <strong>{employee.activity}</strong>
          <p>
            {employee.sessionId
              ? `Session ${employee.sessionId}`
              : 'No cloud session is running for this employee.'}
          </p>
        </div>
      </div>
      {!getLocalStateRecovery() && <AgentWorkspace employee={employee} employees={state.employees} />}
      <div className="detail-section">
        <label>GIVE {employee.name.toUpperCase()} AN ASSIGNMENT</label>
        <div className="agent-config-run-summary">
          <div>
            <strong>
              Astra ·{' '}
              {config.reasoning === 'xhigh'
                ? 'Extra high'
                : config.reasoning.charAt(0).toUpperCase() + config.reasoning.slice(1)}{' '}
              reasoning
            </strong>
            <button type="button" className="text-button" onClick={onEdit}>
              Review settings
            </button>
          </div>
          <p>
            {config.limits.maxTurns} turns · {config.limits.maxToolCalls} tool calls ·{' '}
            {config.limits.maxRuntimeMinutes} minutes · {config.limits.maxRunTokens.toLocaleString()} total
            tokens
          </p>
          <p>
            {[
              config.tools.webSearch && 'Web search',
              config.tools.dataAnalysis && 'Data analysis',
              config.tools.workspaceRead && 'Workspace reading',
              config.tools.artifactWrite && 'Artifacts',
              config.tools.integrationIds.length > 0 && `${config.tools.integrationIds.length} integrations`,
            ]
              .filter(Boolean)
              .join(' · ') || 'No tools selected'}
          </p>
          <p>
            {config.memory.enabled
              ? `Memory: ${config.memory.scopes.join(', ') || 'no scopes'} · ${config.memory.write} writes`
              : 'Memory off'}{' '}
            · {config.autonomy.completionReview ? 'Review finished work' : 'Finish without review'}
          </p>
        </div>
        <textarea
          value={assignment}
          onChange={(e) => setAssignment(e.target.value)}
          rows={3}
          maxLength={12000}
          placeholder="Prepare the client’s weekly update. Bring back a draft, your sources, and anything that needs my input."
        />
        {state.folders.length > 0 && config.tools.workspaceRead && (
          <div className="folder-selection">
            {state.folders.map((f) => (
              <label className="checkbox-label" key={f.id}>
                <input
                  type="checkbox"
                  checked={folderIds.includes(f.id)}
                  onChange={(e) =>
                    setFolderIds((ids) =>
                      e.target.checked ? [...ids, f.id] : ids.filter((id) => id !== f.id),
                    )
                  }
                />
                <FolderOpen size={16} />
                {f.name}
                <small>{f.files.length} files</small>
              </label>
            ))}
          </div>
        )}
        {folderIds.length > 0 && (
          <label className="checkbox-label cloud-consent">
            <input type="checkbox" checked={allow} onChange={(e) => setAllow(e.target.checked)} />
            Share the selected copies with my configured Astra cloud service for this assignment.
          </label>
        )}
        {!cloud.connected && (
          <div className="info-note">
            {window.ahq
              ? 'Add your Astra / OpenAI API key in Settings to start cloud work.'
              : 'Open the desktop app and connect Astra cloud to start an employee session.'}
          </div>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="modal-footer">
        <button className="button secondary" onClick={onChat}>
          <MessageCircle size={16} />
          Conversation
        </button>
        {cloud.connected ? (
          <button
            className="button primary"
            disabled={
              running ||
              !!getLocalStateRecovery() ||
              !assignment.trim() ||
              (folderIds.length > 0 && !allow) ||
              (!!employee.sessionId && ['working', 'review'].includes(employee.status))
            }
            onClick={async () => {
              setRunning(true);
              setError('');
              try {
                await onStart(assignment.trim(), folderIds, allow);
                onClose();
              } catch (e) {
                setError(e instanceof Error ? e.message : 'The session could not start.');
              } finally {
                setRunning(false);
              }
            }}
          >
            {running ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}Start cloud
            session
          </button>
        ) : (
          <button className="button primary" onClick={onSettings}>
            Connect Astra <ArrowRight size={15} />
          </button>
        )}
      </div>
    </Modal>
  );
}
function ReviewDialog({
  approval,
  employee,
  busy,
  onClose,
  onDecide,
  onExport,
}: {
  approval: Approval;
  employee?: Employee;
  busy: boolean;
  onClose: () => void;
  onDecide: (d: 'approved' | 'changes-requested', feedback?: string) => void;
  onExport: () => void;
}) {
  const [changing, setChanging] = useState(false);
  const [feedback, setFeedback] = useState('');
  return (
    <Modal
      title={approval.title}
      subtitle={`Prepared by ${employee?.name ?? 'your local workspace'} · Version ${approval.version}`}
      onClose={onClose}
      wide
    >
      <div className="review-meta">
        <span>
          <Avatar employee={employee} size={25} />
          {employee?.jobTitle ?? 'Local source inventory'}
        </span>
        <span className={`status-pill ${approval.status === 'pending' ? 'review' : 'ready'}`}>
          {approval.status.replaceAll('-', ' ')}
        </span>
      </div>
      <div className="document-preview">
        <Markdown content={approval.content} />
      </div>
      <div className="review-sources">
        <strong>Sources</strong>
        {approval.sources.map((source) => (
          <span key={source}>
            <BookOpen size={12} />
            {source}
          </span>
        ))}
      </div>
      <div className="review-recipient">
        <Inbox size={15} />
        <span>{approval.recipient}</span>
      </div>
      {changing && (
        <label className="feedback-field">
          What would make this better?
          <textarea
            autoFocus
            rows={3}
            placeholder="Be specific about the change you’d like to see…"
            value={feedback}
            maxLength={4000}
            onChange={(e) => setFeedback(e.target.value)}
          />
        </label>
      )}
      <div className="modal-footer">
        <button className="button secondary" onClick={onExport}>
          Export document
        </button>
        <div className="button-group">
          {approval.status === 'pending' &&
            (changing ? (
              <>
                <button className="text-button" onClick={() => setChanging(false)}>
                  Cancel
                </button>
                <button
                  disabled={busy || !feedback.trim()}
                  className="button primary"
                  onClick={() => onDecide('changes-requested', feedback.trim())}
                >
                  Send feedback <ArrowRight size={15} />
                </button>
              </>
            ) : (
              <>
                <button disabled={busy} className="button secondary" onClick={() => setChanging(true)}>
                  Request changes
                </button>
                <button disabled={busy} className="button primary" onClick={() => onDecide('approved')}>
                  {busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}Approve review
                </button>
              </>
            ))}
        </div>
      </div>
    </Modal>
  );
}
