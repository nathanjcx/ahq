import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDownLeft,
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
  Pause,
  Play,
  Plus,
  Search,
  Settings,
  Sparkles,
  Target,
  Users,
  Volume2,
  VolumeX,
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
  employeeColors,
  folderBrief,
  initialState,
  isState,
  profileSuggestion,
  readLocalState,
  STORAGE_KEY,
  timeNow,
  uid,
} from './lib/store';
import { allowedPath, containsSecret, MAX_FILES, MAX_FILE_SIZE, MAX_FOLDER_SIZE } from '../shared/workspace';
import Avatar from './components/Avatar';
import { applyDecision, applySession } from './lib/workflow';
import Modal from './components/Modal';
import SceneBoundary from './components/SceneBoundary';
import Markdown from './components/Markdown';
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
  { id: 'needs-you', label: 'Needs you', icon: Inbox },
] as const;
const pageNames: Record<Page, string> = {
  office: 'Office',
  employees: 'Employees',
  announce: 'Announce',
  commitments: 'Commitments',
  conversations: 'Conversations',
  'needs-you': 'Needs you',
  settings: 'Workspace settings',
};
export type UpdateState = (update: (s: AppState) => AppState) => void;
export default function App() {
  const [state, setState] = useState<AppState>(readLocalState);
  const [ready, setReady] = useState(!window.ahq);
  const [page, setPage] = useState<Page>('office');
  const [conversationTarget, setConversationTarget] = useState('team');
  const [cloud, setCloud] = useState<CloudSettings>({ endpoint: '', configured: false, connected: false });
  const [toast, setToast] = useState('');
  const [modal, setModal] = useState<
    'employee' | 'commitment' | 'goal' | 'search' | 'help' | 'folder' | null
  >(null);
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
  const [labels, setLabels] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [timeView, setTimeView] = useState<'past' | 'present' | 'future'>('present');
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const folderInput = useRef<HTMLInputElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const notify = useCallback((text: string) => setToast(text), []);
  const update: UpdateState = useCallback((fn) => setState((previous) => fn(previous)), []);
  useEffect(() => {
    if (!window.ahq) return;
    let cancelled = false;
    Promise.all([window.ahq.loadState(), window.ahq.getCloudSettings()])
      .then(([saved, settings]) => {
        if (!cancelled) {
          if (isState(saved)) setState(saved);
          setCloud(settings);
          setReady(true);
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
      if (a.sessionId) {
        if (!window.ahq) throw new Error('Open the desktop app to review a cloud output.');
        await window.ahq.decideSession({
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
        return applyDecision(s, a.id, a.version, decision, feedback);
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
                <button className="button primary" onClick={() => setModal('employee')}>
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
              <div className="goal-banner">
                <span className="goal-icon">
                  <Target size={19} />
                </span>
                <span className="goal-label">OUR NORTH STAR</span>
                <p>{state.goal}</p>
                <button className="text-button" onClick={() => setModal('goal')}>
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
                      <span>{state.employees.length} teammates</span>
                    </div>
                    <div>
                      <span className="office-weather">
                        ☀<span>A little room to grow</span>
                      </span>
                      <button
                        className="icon-button"
                        aria-label="Office display settings"
                        onClick={() => setLabels((v) => !v)}
                        aria-pressed={labels}
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
                          employees={state.employees}
                          animate={
                            playing && !state.reducedMotion && !systemReducedMotion && timeView === 'present'
                          }
                          demo={state.demo}
                          onSelect={(e) => setSelectedEmployee(e.id)}
                          zoom={zoom}
                          labels={labels && timeView === 'present'}
                        />
                      </Suspense>
                    </SceneBoundary>
                    <div className="office-hint">
                      <span className={cloud.connected ? 'status-dot' : 'sample-dot'} />
                      {cloud.connected
                        ? `${state.employees.filter((e) => e.status === 'working').length} cloud sessions active`
                        : 'A preview of your future team'}
                      <span>·</span>
                      <span>Select anyone to say hello</span>
                    </div>
                    <div className="scene-controls">
                      <button
                        aria-label="Zoom out"
                        onClick={() => setZoom((z) => Math.max(0.7, z - 0.12))}
                        disabled={zoom <= 0.7}
                      >
                        <Minus size={17} />
                      </button>
                      <button aria-label="Reset office view" onClick={() => setZoom(1)}>
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
                    {timeView !== 'present' && (
                      <div className="time-overlay">
                        <span className="eyebrow">
                          {timeView === 'past' ? 'RECORDED HISTORY' : 'TENTATIVE · NOT YET STARTED'}
                        </span>
                        <h3>{timeView === 'past' ? 'Every step has a story.' : 'A little look ahead.'}</h3>
                        {timeView === 'past'
                          ? state.events
                              .slice(-3)
                              .reverse()
                              .map((e) => (
                                <div className="time-event" key={e.id}>
                                  <span>{clockTime(e.time)}</span>
                                  <p>
                                    {e.text}
                                    <small>
                                      {e.source === 'example'
                                        ? 'Sample event'
                                        : e.source === 'cloud'
                                          ? 'Astra cloud'
                                          : 'Your workspace'}
                                    </small>
                                  </p>
                                </div>
                              ))
                          : state.commitments
                              .filter((c) => c.status !== 'done')
                              .slice(0, 3)
                              .map((c) => (
                                <button
                                  className="time-event"
                                  key={c.id}
                                  onClick={() => setSelectedCommitment(c.id)}
                                >
                                  <span>{dueLabel(c.deadline)}</span>
                                  <p>
                                    {c.title}
                                    <small>Forecast · {c.nextStep}</small>
                                  </p>
                                  <ArrowRight size={16} />
                                </button>
                              ))}
                        <button className="text-button" onClick={() => setTimeView('present')}>
                          Back to the office <ArrowRight size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="office-footer">
                    <div className="avatar-stack">
                      {state.employees.slice(0, 6).map((e) => (
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
                  <section className="team-chat">
                    <div className="section-heading">
                      <h2>
                        <MessageCircle size={17} />
                        Around the office
                      </h2>
                      <span className="subtle-dot" />
                    </div>
                    <button className="channel-link" onClick={() => navigate('conversations')}>
                      # team-lounge <ChevronDown size={12} />
                      <span>{state.demo ? 'SAMPLE' : 'TEAM'}</span>
                    </button>
                    <div className="chat-preview">
                      {state.messages
                        .filter((m) => m.channel === 'team')
                        .slice(-3)
                        .map((m) => {
                          const employee = employeeById(state.employees, m.authorId);
                          return (
                            <div className="chat-message" key={m.id}>
                              <Avatar employee={employee} size={31} />
                              <div>
                                <div className="message-byline">
                                  <strong>{employee?.name ?? 'You'}</strong>
                                  <time>{clockTime(m.time)}</time>
                                  {m.id.startsWith('m') && <span className="sample-label">EXAMPLE</span>}
                                </div>
                                <p>{m.text}</p>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                    <button className="chat-see-all" onClick={() => navigate('conversations')}>
                      Pull up a chair <ArrowRight size={14} />
                    </button>
                  </section>
                  <section className="needs-preview">
                    <div className="section-heading">
                      <h2>
                        <Inbox size={17} />A moment of your time
                      </h2>
                      <span className="count-badge">{pending.length}</span>
                    </div>
                    <p className="section-description">Your perspective makes the difference.</p>
                    {pending.slice(0, 2).map((a, i) => (
                      <button
                        className={`review-preview ${i === 0 ? 'featured' : ''}`}
                        key={a.id}
                        onClick={() => setSelectedApproval(a.id)}
                      >
                        <div className="review-preview-top">
                          <span className={`approval-symbol ${i === 0 ? 'warm' : ''}`}>
                            {i === 0 ? <Sparkles size={18} /> : <BookOpen size={18} />}
                          </span>
                          <span>
                            {employeeById(state.employees, a.employeeId)?.name ?? 'Workspace'}
                            <small>{a.kind === 'decision' ? 'A decision for you' : 'Ready for review'}</small>
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
                    {pending.length === 0 && (
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
              <section className="timeline">
                <div className="timeline-intro">
                  <span className="timeline-mark">
                    <Coffee size={19} />
                  </span>
                  <div>
                    <strong>One step at a time.</strong>
                    <span>Room to move. Promises to keep.</span>
                  </div>
                </div>
                <div className="timeline-track">
                  <div className="timeline-tabs">
                    {(['past', 'present', 'future'] as const).map((t) => (
                      <button
                        className={timeView === t ? 'selected' : ''}
                        key={t}
                        onClick={() => setTimeView(t)}
                      >
                        {t.charAt(0).toUpperCase() + t.slice(1)}
                        {t === 'present' && <span className="live-tag">NOW</span>}
                      </button>
                    ))}
                  </div>
                  <div className="time-line">
                    <i />
                    <i />
                    <i />
                  </div>
                  <div className="timeline-labels">
                    <span>A little progress</span>
                    <span>Right here, right now</span>
                    <span>Good things ahead</span>
                  </div>
                </div>
                <div className="playback">
                  <button
                    className="icon-button"
                    aria-label={playing ? 'Pause sample animation' : 'Play sample animation'}
                    aria-pressed={playing}
                    onClick={() => setPlaying((p) => !p)}
                  >
                    {playing ? <Pause size={16} /> : <Play size={16} />}
                  </button>
                  <button
                    className="icon-button"
                    aria-label={state.sound ? 'Mute review chime' : 'Enable review chime'}
                    aria-pressed={state.sound}
                    onClick={() => {
                      update((s) => ({ ...s, sound: !s.sound }));
                      if (!state.sound) playReviewChime();
                    }}
                  >
                    {state.sound ? <Volume2 size={16} /> : <VolumeX size={16} />}
                  </button>
                </div>
              </section>
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
          {page === 'announce' && <AnnouncePage {...common} onEditGoal={() => setModal('goal')} />}
          {page === 'commitments' && (
            <CommitmentsPage
              {...common}
              onSelect={(c) => setSelectedCommitment(c.id)}
              onCreate={() => setModal('commitment')}
            />
          )}
          {page === 'conversations' && <ConversationsPage {...common} initialChannel={conversationTarget} />}
          {page === 'needs-you' && <NeedsYouPage {...common} onReview={(a) => setSelectedApproval(a.id)} />}
          {page === 'settings' && (
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
                text: 'A name, a job title, a personality, and skills. That’s the whole profile.',
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
                text: 'Set up your Astra gateway in the desktop app to run real cloud sessions.',
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
  onClose,
  onCreate,
}: {
  initial?: Employee;
  onClose: () => void;
  onCreate: (e: Pick<Employee, 'name' | 'jobTitle' | 'personality' | 'skills'>) => void;
}) {
  const [fields, setFields] = useState({
    name: initial?.name ?? '',
    jobTitle: initial?.jobTitle ?? '',
    personality: initial?.personality ?? '',
    skills: initial?.skills ?? '',
  });
  return (
    <Modal
      title={initial ? `A little more about ${initial.name}.` : 'A new face. A little possibility.'}
      subtitle="Good teammates start with a clear role. You can make it their own."
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (Object.values(fields).every((v) => v.trim()))
            onCreate({
              name: fields.name.trim(),
              jobTitle: fields.jobTitle.trim(),
              personality: fields.personality.trim(),
              skills: fields.skills.trim(),
            });
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
          Skills describe the role. Connected resources and permissions are set separately.
        </p>
        <div className="modal-footer">
          <button type="button" className="button secondary" onClick={onClose}>
            Maybe later
          </button>
          <button className="button primary" type="submit">
            <Plus size={16} />
            {initial ? 'Save profile' : 'Welcome to the team'}
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
                ? 'Astra cloud session'
                : employee.status
              : 'Ready for a cloud assignment'}
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
              : 'No cloud session is running for this employee.'}
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
            Share the selected copies with my configured Astra cloud service for this assignment.
          </label>
        )}
        {!cloud.connected && (
          <div className="info-note">
            {window.ahq
              ? 'Connect your Astra gateway in settings to start real cloud work.'
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
