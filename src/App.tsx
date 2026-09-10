import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  History,
  ArrowRight,
  BookOpen,
  Check,
  CircleHelp,
  Coffee,
  Ellipsis,
  Flag,
  Focus,
  GitBranch,
  FolderOpen,
  Home,
  Inbox,
  LoaderCircle,
  MessageCircle,
  Minus,
  Move,
  Plus,
  Search,
  Settings,
  Sparkles,
  Target,
  Users,
  UserRound,
  Volume2,
  X,
} from 'lucide-react';
import type {
  AppState,
  Approval,
  CloudSettings,
  Commitment,
  Employee,
  Page,
  WorkspaceFolder,
} from '../shared/types';
import {
  clockTime,
  dueLabel,
  employeeById,
  folderBrief,
  sampleState,
  isState,
  readLocalState,
  STORAGE_KEY,
  timeNow,
  uid,
} from './lib/store';
import { allowedPath, containsSecret, MAX_FILES, MAX_FILE_SIZE, MAX_FOLDER_SIZE } from '../shared/workspace';
import Avatar from './components/Avatar';
import { applyDecision, applySession } from './lib/workflow';
import { dependencyCandidates, validateDependencies } from './lib/roadmap';
import Modal from './components/Modal';
import SceneBoundary from './components/SceneBoundary';
import Markdown from './components/Markdown';
import Roadmap from './components/Roadmap';
import EmployeeForm from './components/EmployeeForm';
import ChatGPTProfile from './components/ChatGPTProfile';
import { randomEmployeeAppearance } from './lib/employeeAppearance';
import officeIcon from '../assets/app-icon.svg';
import {
  useOfficeHistory,
  OfficeTimeline,
  VoiceAnnounce,
  ConnectionSettings,
  ActivityPage,
} from './components/HQFeatures';
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
  { id: 'roadmap', label: 'Roadmap', icon: GitBranch },
] as const;
const pageNames: Record<Page, string> = {
  office: 'Office',
  employees: 'Employees',
  announce: 'Announce',
  commitments: 'Commitments',
  roadmap: 'Roadmap',
  conversations: 'Chat',
  'needs-you': 'Needs you',
  activity: 'Activity',
  settings: 'Workspace settings',
};
export type UpdateState = (update: (s: AppState) => AppState) => void;
export default function App() {
  const [state, setState] = useState<AppState>(readLocalState);
  const [ready, setReady] = useState(!window.ahq);
  const [page, setPage] = useState<Page>('office');
  const [conversationTarget, setConversationTarget] = useState('team');
  const [officeChatOpen, setOfficeChatOpen] = useState(false);
  const officeChatRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!officeChatOpen || page !== 'office') return;
    const messages = officeChatRef.current?.querySelector('.conversation-messages');
    if (messages) messages.scrollTop = messages.scrollHeight;
  }, [officeChatOpen, page]);
  const [cloud, setCloud] = useState<CloudSettings>({ endpoint: '', configured: false, connected: false });
  const [toast, setToast] = useState('');
  const [modal, setModal] = useState<
    'employee' | 'commitment' | 'goal' | 'search' | 'help' | 'folder' | 'files' | 'storage' | 'profile' | null
  >(null);
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [selectedApproval, setSelectedApproval] = useState<string | null>(null);
  const [selectedCommitment, setSelectedCommitment] = useState<string | null>(null);
  const [editingCommitment, setEditingCommitment] = useState<Commitment | null>(null);
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
  const [officeViewReset, setOfficeViewReset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const folderInput = useRef<HTMLInputElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const notify = useCallback((text: string) => setToast(text), []);
  const update: UpdateState = useCallback((fn) => setState((previous) => fn(previous)), []);
  const history = useOfficeHistory(state, update, notify);
  const [pastFrame, setPastFrame] = useState<import('../shared/types').OfficeFrame | null>(null);
  const lastFrame = useRef(0);
  const frameTime = useRef(Date.now() / 1000);
  if (playing && !listening && !state.reducedMotion && !systemReducedMotion)
    frameTime.current = history.at === null ? history.now / 1000 : history.at / 1000;
  useEffect(() => {
    let active = true;
    if (history.at !== null)
      void window.ahq?.frameAt(history.at).then((frame) => {
        if (active) setPastFrame(frame);
      });
    else setPastFrame(null);
    return () => {
      active = false;
    };
  }, [history.at]);
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
    if (!state.employees.length) throw new Error('Create an employee before making an announcement.');
    if (!window.ahq) throw new Error('Open the desktop app to announce to your employees.');
    await saveChain.current;
    const results = await window.ahq.broadcast(text);
    const saved = await window.ahq.loadState();
    if (saved) setState(saved);
    const failed = results.filter((r) => r.error);
    notify(
      failed.length
        ? `Reached ${results.length - failed.length} employees. ${failed.map((f) => state.employees.find((e) => e.id === f.employeeId)?.name).join(', ')} could not receive the announcement.`
        : 'Announcement delivered to every employee’s Astra session.',
    );
  }
  useEffect(() => {
    const room = (event: Event) => {
      const key = (event as CustomEvent<string>).detail;
      if (key === 'library') setModal('folder');
      else if (key === 'storage') setModal('files');
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
          if (isState(saved)) setState(saved);
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
    if (!ready) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
  useEffect(() => {
    if (!window.ahq || !ready) return;
    let stopped = false,
      polling = false;
    const refresh = async () => {
      if (
        polling ||
        !(
          stateRef.current.roadmap ||
          stateRef.current.commitments.some((c) => c.sessionId && c.status !== 'done')
        )
      )
        return;
      polling = true;
      try {
        await saveChain.current;
        const before = stateRef.current;
        const saved = await window.ahq!.loadState();
        if (
          !stopped &&
          saved &&
          stateRef.current === before &&
          JSON.stringify(saved) !== JSON.stringify(before)
        )
          setState(saved);
      } catch {
        /* Preserve local edits until the next successful refresh. */
      } finally {
        polling = false;
      }
    };
    const timer = setInterval(() => void refresh(), 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [ready]);
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
    setPage(to === 'conversations' ? 'office' : to);
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
        const saved = await window.ahq.loadState();
        if (
          saved?.approvals.some(
            (item) => item.id === a.id && item.version === a.version && item.status === decision,
          )
        ) {
          setState(saved);
          notify(decision === 'approved' ? 'Approved. Your team can continue.' : 'Your guidance is saved.');
          setSelectedApproval(null);
          return;
        }
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
          <img className="brand-office-icon" src={officeIcon} alt="" />
          <span>
            astra<span className="brand-hq">HQ</span>
          </span>
        </a>
        <nav aria-label="Main navigation">
          {nav.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${page === item.id ? 'active' : ''}`}
              onClick={() => navigate(item.id)}
              aria-label={item.label}
              title={item.label}
              aria-current={page === item.id ? 'page' : undefined}
            >
              <item.icon size={19} strokeWidth={1.7} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </aside>
      <div className="main-shell" data-page={page}>
        <header className="topbar topbar-minimal">
          <div className="topbar-actions">
            <span className="today">
              {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
            </span>
            <button
              className="icon-button"
              aria-label="Settings"
              title="Settings"
              onClick={() => navigate('settings')}
            >
              <Settings size={18} />
            </button>
            <button
              className="icon-button profile-button"
              aria-label="Profile and ChatGPT sign-in"
              aria-haspopup="dialog"
              title="ChatGPT account"
              onClick={() => setModal('profile')}
            >
              <UserRound size={19} />
            </button>
          </div>
        </header>
        <main>
          {page !== 'office' && (
            <div className="page-header">
              <div>
                <div className="page-eyebrow">A LITTLE SPACE FOR BIG THINGS</div>
                <h1>{pageNames[page]}</h1>
                <p>
                  {
                    {
                      employees: 'Good people. Clear roles. A shared direction.',
                      announce: 'One shared direction. Everyone on the same page.',
                      commitments: 'Flexibility in the path. Reliability in the promise.',
                      roadmap: 'Every milestone, connected to the goal.',
                      conversations: 'The thinking, the handoffs, and the conversations in between.',
                      'needs-you': 'A few thoughtful decisions to keep good things moving.',
                      activity: 'Your decisions. Their work. Every step recorded.',
                      settings: 'Make this space work for you.',
                    }[page]
                  }
                </p>
              </div>
              <div className="page-actions">
                {page === 'employees' ? (
                  <button className="button primary" onClick={() => setModal('employee')}>
                    <Plus size={16} />
                    New employee
                  </button>
                ) : page === 'commitments' || page === 'roadmap' ? (
                  <button className="button primary" onClick={() => setModal('commitment')}>
                    <Plus size={16} />
                    New milestone
                  </button>
                ) : null}
              </div>
            </div>
          )}
          {page === 'office' && (
            <>
              <div className="office-goal-header">
                <button
                  className="office-goal-card"
                  onClick={() => setModal('goal')}
                  aria-label={`Goal: ${history.display.goal}. Edit goal.`}
                >
                  <span className="office-goal-copy">
                    <span className="office-goal-label">GOAL</span>
                    <strong>{history.display.goal}</strong>
                  </span>
                  <ArrowRight size={18} aria-hidden="true" />
                </button>
                <button className="button primary office-hire-button" onClick={() => setModal('employee')}>
                  <Plus size={16} />
                  New employee
                </button>
              </div>
              <div className="office-layout office-layout-with-chat" data-chat-open={officeChatOpen}>
                <div className="office-stage">
                  <section className="office-card">
                    <div className="office-card-header">
                      <div>
                        <span className="room-icon">
                          <Home size={15} />
                        </span>
                        <strong>The studio</strong>
                        <span className="small-separator" />
                        <span>{state.employees.length} teammates</span>
                      </div>
                      <div>
                        <span className="office-weather">
                          ☀<span>A little room to grow</span>
                        </span>
                        <button
                          className="office-chat-toggle"
                          aria-label={officeChatOpen ? 'Hide office chat' : 'Show office chat'}
                          aria-expanded={officeChatOpen}
                          aria-controls="office-chat-panel"
                          onClick={() => setOfficeChatOpen((open) => !open)}
                        >
                          {officeChatOpen ? <X size={15} /> : <MessageCircle size={15} />}
                          <span>{officeChatOpen ? 'Hide chat' : 'Chat'}</span>
                        </button>
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
                            employees={history.display.employees}
                            reviewEmployeeIds={history.at === null ? pending.map((a) => a.employeeId) : []}
                            onReview={(e) => {
                              const review = pending.find((a) => a.employeeId === e.id);
                              if (review) setSelectedApproval(review.id);
                            }}
                            animate={playing && !state.reducedMotion && !systemReducedMotion}
                            onSelect={(e) => {
                              if (history.at !== null) {
                                notify(`${e.name}: ${e.activity}`);
                                return;
                              }
                              const review = pending.find((a) => a.employeeId === e.id);
                              if (review) setSelectedApproval(review.id);
                              else setSelectedEmployee(e.id);
                            }}
                            zoom={zoom}
                            angle={angle}
                            resetKey={officeViewReset}
                            timeSeconds={
                              history.at !== null
                                ? (pastFrame?.sceneTime ?? frameTime.current)
                                : frameTime.current
                            }
                            live={history.at === null}
                            listening={history.at !== null ? !!pastFrame?.listening : listening}
                            microphoneLevel={history.at !== null ? (pastFrame?.level ?? 0) : microphoneLevel}
                          />
                        </Suspense>
                      </SceneBoundary>
                      <div className="office-hint">
                        <span className={cloud.connected ? 'status-dot' : 'sample-dot'} />
                        {!state.employees.length
                          ? 'Your office is ready'
                          : cloud.connected
                            ? `${state.employees.filter((e) => e.sessionId && e.status === 'working').length} sessions active`
                            : state.demo
                              ? 'A preview of your future team'
                              : 'Ready for your direction'}
                        <span>·</span>
                        <span>
                          {state.employees.length ? 'Select anyone to say hello' : 'Add your first employee'}
                        </span>
                      </div>
                      <div className="scene-controls">
                        <span className="office-pan-hint">
                          <Move size={13} /> Drag to pan
                        </span>
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
                            setAngle(0);
                            setOfficeViewReset((key) => key + 1);
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
                        <button
                          className="replay-badge"
                          onClick={() => history.setConfirm(true)}
                          title="Review this checkpoint to restore it"
                          aria-label={`Replay at ${new Date(history.at).toLocaleTimeString()}. Review checkpoint restoration.`}
                        >
                          <History size={14} />
                          Replay · {new Date(history.at).toLocaleTimeString()}
                        </button>
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
                        {state.employees.slice(0, 6).map((e) => (
                          <Avatar key={e.id} employee={e} size={26} />
                        ))}
                      </div>
                      <span>
                        {state.employees.length ? 'Your team is here.' : 'A space for your future team.'}
                      </span>
                      <button
                        className="text-button"
                        onClick={() =>
                          state.employees.length ? navigate('employees') : setModal('employee')
                        }
                      >
                        {state.employees.length ? 'Meet everyone' : 'Create your first employee'}{' '}
                        <ArrowRight size={14} />
                      </button>
                    </div>
                  </section>
                  <VoiceAnnounce
                    disabled={!state.employees.length}
                    onLevel={setMicrophoneLevel}
                    onListening={setListening}
                    onBroadcast={broadcast}
                    notify={notify}
                  />
                </div>
                <aside
                  className="office-chat-column"
                  id="office-chat-panel"
                  ref={officeChatRef}
                  aria-label="Office chat"
                  hidden={!officeChatOpen}
                >
                  <ConversationsPage
                    {...common}
                    compact
                    initialChannel={conversationTarget}
                    onChannelChange={setConversationTarget}
                    onBroadcast={broadcast}
                  />
                </aside>
              </div>
              <OfficeTimeline history={history} />
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
                disabled={!state.employees.length}
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
          {page === 'roadmap' && (
            <Roadmap
              state={{
                ...state,
                commitments: state.roadmap
                  ? state.commitments.filter((c) => state.roadmap!.milestoneIds.includes(c.id))
                  : state.commitments,
              }}
              onControl={async (action) => {
                try {
                  await saveChain.current;
                  const next = await window.ahq?.controlRoadmap(action);
                  if (next) setState(next);
                } catch (error) {
                  notify(error instanceof Error ? error.message : 'Please try again.');
                }
              }}
              onSelect={(c) => setSelectedCommitment(c.id)}
              onCreate={() => setModal('commitment')}
              onEditGoal={() => setModal('goal')}
            />
          )}
          {page === 'conversations' && (
            <ConversationsPage {...common} initialChannel={conversationTarget} onBroadcast={broadcast} />
          )}
          {page === 'needs-you' && <NeedsYouPage {...common} onReview={(a) => setSelectedApproval(a.id)} />}
          {page === 'activity' && <ActivityPage {...common} />}
          {page === 'settings' && (
            <>
              <div className="settings-workspace-links">
                <button className="button secondary" onClick={() => navigate('needs-you')}>
                  <Inbox size={16} />
                  Reviews{pending.length > 0 ? ` (${pending.length})` : ''}
                </button>
                <button className="button secondary" onClick={() => navigate('activity')}>
                  <History size={16} />
                  Activity & exports
                </button>
              </div>
              <ConnectionSettings cloud={cloud} onCloud={setCloud} notify={notify} />
              <SettingsPage
                {...common}
                cloud={cloud}
                setCloud={setCloud}
                onSelectFolder={() => setModal('folder')}
                onBrief={createBrief}
                onReset={() => {
                  if (
                    (state.roadmap && !['complete', 'failed'].includes(state.roadmap.status)) ||
                    state.employees.some(
                      (e) => e.sessionId && ['working', 'review', 'offline'].includes(e.status),
                    )
                  ) {
                    notify('Finish or stop your current work before opening an example office.');
                    return;
                  }
                  update(() => sampleState());
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
      {modal === 'profile' && (
        <ChatGPTProfile cloud={cloud} onCloud={setCloud} onClose={() => setModal(null)} />
      )}
      {modal === 'employee' && (
        <EmployeeForm
          initial={editingEmployee ?? undefined}
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
              notify('Profile updated for future assignments.');
              return;
            }
            const employee: Employee = {
              ...fields,
              skills: 'Astra session',
              id: uid(),
              ...randomEmployeeAppearance(),
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
          onSave={async (goal) => {
            if (!window.ahq)
              throw new Error('Open the desktop app to create an AI roadmap with your ChatGPT account.');
            await saveChain.current;
            const next = await window.ahq.createRoadmap(goal);
            setState(next);
            navigate('roadmap');
            notify('Creating your roadmap. Your employees will start the first available steps.');
          }}
        />
      )}
      {modal === 'commitment' && (
        <CommitmentForm
          employees={state.employees}
          commitments={state.commitments}
          initial={editingCommitment ?? undefined}
          onClose={() => {
            setModal(null);
            setEditingCommitment(null);
          }}
          onSave={(c) => {
            update((s) => ({
              ...s,
              commitments: editingCommitment
                ? s.commitments.map((item) => (item.id === c.id ? c : item))
                : [...s.commitments, c],
              events: [
                ...s.events,
                addEvent(`${editingCommitment ? 'Updated' : 'Created'} milestone: ${c.title}`),
              ],
            }));
            setModal(null);
            setEditingCommitment(null);
            notify('Roadmap saved.');
          }}
        />
      )}
      {person && (
        <EmployeeDetail
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
            if (!window.ahq) throw new Error('Cloud sessions are available in the desktop app.');
            await saveChain.current;
            const session = await window.ahq.startSession({
              employee: person,
              assignment,
              goal: state.goal,
              folderIds,
              allowCloudUpload,
            });
            const saved = await window.ahq.loadState().catch(() => null);
            if (saved) setState(saved);
            else update((s) => applySession(s, person.id, session));
            notify(`Task assigned to ${person.name}. You can follow it in Roadmap.`);
          }}
        />
      )}
      {approval && (
        <ReviewDialog
          key={`${approval.id}:${approval.version}`}
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
          subtitle={
            commitment.deadline
              ? `${dueLabel(commitment.deadline)} · ${clockTime(commitment.deadline)} · ${commitment.firm ? 'Firm promise' : 'Flexible target'}`
              : 'No due date'
          }
          onClose={() => setSelectedCommitment(null)}
        >
          <div className="commitment-detail">
            <p style={{ whiteSpace: 'pre-wrap' }}>{commitment.assignment ?? commitment.description}</p>
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
              <button
                className="button secondary"
                onClick={() => {
                  setEditingCommitment(commitment);
                  setSelectedCommitment(null);
                  setModal('commitment');
                }}
              >
                Edit milestone
              </button>
              {(pending.some((a) => a.commitmentId === commitment.id) ||
                employeeById(state.employees, commitment.ownerId)) && (
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
                  {pending.some((a) => a.commitmentId === commitment.id)
                    ? 'Open review'
                    : 'Speak to the owner'}
                  <ArrowRight size={15} />
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}
      {modal === 'files' && (
        <Modal
          title="File cabinet"
          subtitle="The local folders your team can work from."
          onClose={() => setModal(null)}
        >
          <div className="cabinet-folders">
            {!state.folders.length && (
              <div className="empty-state">
                <FolderOpen size={32} />
                <p>Your cabinet is empty. Add a project folder to give your team a starting point.</p>
              </div>
            )}
            {state.folders.map((folder) => (
              <section key={folder.id} className="cabinet-folder">
                <div>
                  <FolderOpen size={20} />
                  <strong>{folder.name}</strong>
                  <span>{folder.files.length} files</span>
                </div>
                <details>
                  <summary>View files</summary>
                  <ul>
                    {folder.files.map((file) => (
                      <li key={file.path}>{file.path}</li>
                    ))}
                  </ul>
                </details>
                <button
                  className="text-button"
                  onClick={() => {
                    setModal(null);
                    createBrief(folder);
                  }}
                >
                  Prepare a source brief <ArrowRight size={14} />
                </button>
              </section>
            ))}
          </div>
          <p className="form-hint">Choose which folders to share when you give an employee an assignment.</p>
          <div className="modal-footer">
            <button className="button secondary" onClick={() => navigate('settings')}>
              Storage settings
            </button>
            <button className="button primary" onClick={() => setModal('folder')}>
              <Plus size={16} />
              Add a folder
            </button>
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
                text: 'Enter a name and job, then let AI generate their personality.',
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
                text: 'Open your profile and sign in with ChatGPT to put your team to work.',
                action: () => setModal('profile'),
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
            {state.demo
              ? 'You’re exploring a sample workspace. Example conversations and deliverables are labeled. '
              : 'Your office starts empty. Add employees when you’re ready. '}
            Actions are saved locally; employee work starts only with a connected Astra session.
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
function GoalForm({
  goal,
  onClose,
  onSave,
}: {
  goal: string;
  onClose: () => void;
  onSave: (goal: string) => Promise<void>;
}) {
  const [value, setValue] = useState(goal);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal
      title="What are we working toward?"
      subtitle="Set the goal. Your team will work out the steps."
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!value.trim() || saving) return;
          setSaving(true);
          setError('');
          try {
            await onSave(value.trim());
          } catch (error) {
            setError(error instanceof Error ? error.message : 'Please try again.');
            setSaving(false);
          }
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
          AI creates a complete roadmap and delegates available steps to your employees. You review their work
          before dependent steps begin.
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-footer">
          <span className="muted">{value.length}/500</span>
          <button className="button primary" type="submit" disabled={saving || !value.trim()}>
            {saving ? 'Starting…' : 'Create roadmap & start'} <ArrowRight size={15} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
function CommitmentForm({
  employees,
  commitments,
  initial,
  onClose,
  onSave,
}: {
  employees: Employee[];
  commitments: Commitment[];
  initial?: Commitment;
  onClose: () => void;
  onSave: (c: Commitment) => void;
}) {
  const [error, setError] = useState('');
  const id = useRef(initial?.id ?? uid()).current;
  const candidates = dependencyCandidates(commitments, initial?.id);
  const localDeadline = initial?.deadline
    ? new Date(new Date(initial.deadline).getTime() - new Date(initial.deadline).getTimezoneOffset() * 60_000)
        .toISOString()
        .slice(0, 16)
    : '';
  return (
    <Modal
      title={initial ? 'Edit milestone' : 'New milestone'}
      subtitle="A clear step toward your team’s goal."
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          const title = String(data.get('title')).trim();
          const dependencies = data.getAll('dependencies').map(String);
          if (!title) return;
          if (!validateDependencies(commitments, id, dependencies)) {
            setError('Those connections would create a loop. Choose an earlier milestone.');
            return;
          }
          const status = String(data.get('status') ?? 'planned') as Commitment['status'];
          onSave({
            ...(initial ? { sessionId: initial.sessionId, assignment: initial.assignment } : {}),
            id,
            title,
            description: String(data.get('description')).trim(),
            ownerId: String(data.get('owner')),
            recipient: String(data.get('recipient')).trim(),
            deadline: data.get('deadline') ? new Date(String(data.get('deadline'))).toISOString() : '',
            firm: data.get('firm') === 'on',
            status,
            progress:
              status === 'done'
                ? 100
                : status === 'planned'
                  ? 0
                  : Math.min(99, Math.max(0, Number(data.get('progress')) || 0)),
            nextStep: String(data.get('nextStep')).trim(),
            dependencies,
            source:
              initial && initial.ownerId === String(data.get('owner')) ? initial.source : 'Your instruction',
            definitionOfDone: String(data.get('done')).trim(),
          });
        }}
      >
        <label>
          Milestone
          <input
            autoFocus
            required
            name="title"
            maxLength={120}
            placeholder="Prepare the weekly client update"
            defaultValue={initial?.title}
          />
        </label>
        <label>
          Context
          <textarea
            name="description"
            rows={2}
            placeholder="What should the owner know?"
            maxLength={2000}
            defaultValue={initial?.description}
          />
        </label>
        <div className="form-grid">
          <label>
            Owner
            <select name="owner" defaultValue={initial?.ownerId ?? ''}>
              <option value="">You · unassigned</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} · {e.jobTitle}
                </option>
              ))}
            </select>
          </label>
          <label>
            Who is it for?
            <input
              required
              name="recipient"
              placeholder="Client or stakeholder"
              maxLength={120}
              defaultValue={initial?.recipient ?? 'Our team'}
            />
          </label>
        </div>
        <label>
          Target date · your local timezone
          <input name="deadline" type="datetime-local" defaultValue={localDeadline} />
        </label>
        <label className="checkbox-label">
          <input name="firm" type="checkbox" defaultChecked={initial?.firm ?? true} />
          This is a firm promise
        </label>
        {initial && (
          <div className="form-grid">
            <label>
              Status
              <select name="status" defaultValue={initial.status}>
                <option value="planned">Planned</option>
                <option value="in-progress">In progress</option>
                <option value="review">Needs review</option>
                <option value="done">Done</option>
              </select>
            </label>
            <label>
              Progress (%)
              <input name="progress" type="number" min="0" max="100" defaultValue={initial.progress} />
            </label>
          </div>
        )}
        <label>
          What does done look like?
          <textarea
            required
            rows={2}
            name="done"
            maxLength={1000}
            placeholder="A reviewed draft with this week’s progress and next milestones"
            defaultValue={initial?.definitionOfDone}
          />
        </label>
        <label>
          Next step
          <input
            required
            name="nextStep"
            maxLength={300}
            placeholder="Collect the project notes"
            defaultValue={initial?.nextStep}
          />
        </label>
        {candidates.length > 0 && (
          <fieldset className="milestone-dependencies">
            <legend>Depends on</legend>
            <p>Connect the milestones that need to finish first.</p>
            {candidates.map((c) => (
              <label className="checkbox-label" key={c.id}>
                <input
                  type="checkbox"
                  name="dependencies"
                  value={c.id}
                  defaultChecked={initial?.dependencies.includes(c.id)}
                />
                {c.title}
              </label>
            ))}
          </fieldset>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-footer">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary">
            <Flag size={16} />
            Save milestone
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
}: {
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
  return (
    <Modal title={`A little time with ${employee.name}.`} onClose={onClose}>
      <div className="employee-detail-profile">
        <Avatar employee={employee} size={68} />
        <div>
          <h3>{employee.name}</h3>
          <p>{employee.jobTitle}</p>
          <button className="text-button edit-profile" onClick={onEdit}>
            Edit profile
          </button>
          <span className={`status-pill ${employee.status}`}>
            {employee.sessionId
              ? employee.status === 'working'
                ? employee.sessionId.startsWith('chatgpt-')
                  ? 'ChatGPT plan session'
                  : 'Astra cloud session'
                : employee.status
              : 'Ready for an assignment'}
          </span>
        </div>
      </div>
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
              : 'No session is running for this employee.'}
          </p>
        </div>
      </div>
      <div className="detail-section">
        <label>GIVE {employee.name.toUpperCase()} AN ASSIGNMENT</label>
        <textarea
          value={assignment}
          onChange={(e) => setAssignment(e.target.value)}
          rows={3}
          maxLength={12000}
          placeholder="Prepare the client’s weekly update. Bring back a draft, your sources, and anything that needs my input."
        />
        {state.folders.length > 0 && (
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
            Share the selected copies with my employee’s AI session for this assignment.
          </label>
        )}
        {!cloud.connected && (
          <div className="info-note">
            {window.ahq
              ? 'Sign in with ChatGPT in Settings to start work using your plan.'
              : 'Open the desktop app and sign in with ChatGPT to start an employee session.'}
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
            {running ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}
            {running ? 'Assigning…' : 'Assign task'}
          </button>
        ) : (
          <button className="button primary" onClick={onSettings}>
            Connect ChatGPT <ArrowRight size={15} />
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
  const [choice, setChoice] = useState('');
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
      {approval.status === 'pending' && approval.choices?.length && (
        <fieldset className="review-choice-list">
          <legend>{approval.question || 'What should I do next?'}</legend>
          {approval.choices.map((option) => (
            <label key={option}>
              <input
                type="radio"
                name="review-choice"
                value={option}
                checked={choice === option}
                disabled={busy}
                onChange={() => setChoice(option)}
              />
              <span>{option}</span>
            </label>
          ))}
        </fieldset>
      )}
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
                  No · request changes
                </button>
                {approval.choices?.length ? (
                  <button
                    disabled={busy || !choice}
                    className="button primary"
                    onClick={() =>
                      onDecide(
                        'changes-requested',
                        `My choice for “${approval.question || 'your question'}”: ${choice}. Continue with this choice and return the result for review.`,
                      )
                    }
                  >
                    Use this choice <ArrowRight size={15} />
                  </button>
                ) : (
                  <button disabled={busy} className="button primary" onClick={() => onDecide('approved')}>
                    {busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}Yes · approve
                  </button>
                )}
              </>
            ))}
        </div>
      </div>
    </Modal>
  );
}
