'use client';

import {
  Activity,
  Archive,
  ArrowRight,
  BadgeCheck,
  Bell,
  Bot,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Cloud,
  Command,
  ExternalLink,
  FileText,
  GitBranch,
  Inbox,
  KeyRound,
  LayoutGrid,
  Link2,
  ListTodo,
  LoaderCircle,
  LockKeyhole,
  Mail,
  Menu,
  MessageSquareText,
  MoreHorizontal,
  PanelLeftClose,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  Store,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { OrganizationSwitcher, SignInButton, SignedIn, SignedOut, UserButton } from '@clerk/nextjs';
import dynamic from 'next/dynamic';
import { useConvexAuth, useMutation, useQuery } from 'convex/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import type {
  ActionProposal,
  Connection,
  Dashboard,
  Employee,
  InboxItem,
  Listing,
  Message,
  ModelId,
  ProviderId,
  Project,
  Task,
} from '@/lib/contracts';
import { emptyDashboard } from '@/lib/contracts';
import { uiApi, type AdminDraft, type AdminToolRegistry } from '@/lib/ui-api';
import { providers as providerCatalog, getProvider } from '@/lib/providers';

const Github = GitBranch;
const OfficeView = dynamic(() => import('./office/office-view'), { ssr: false });

type Page =
  | 'office'
  | 'inbox'
  | 'employees'
  | 'tasks'
  | 'files'
  | 'activity'
  | 'marketplace'
  | 'integrations'
  | 'admin';

type EditorDraft = AdminDraft & { id: string };
type CorrectionResult = { kind: 'task'; taskId: string } | { kind: 'proposal'; proposalId: string };

type Actions = {
  bootstrap: (name: string) => Promise<unknown>;
  setBudget: (monthlyBudget: number) => Promise<unknown>;
  hire: (versionId: string) => Promise<unknown>;
  createTask: (employeeId: string, prompt: string, title: string, projectId?: string) => Promise<unknown>;
  createProject: (name: string, brief: string, employeeIds: string[]) => Promise<unknown>;
  updateProject: (projectId: string, name: string, brief: string, employeeIds: string[]) => Promise<unknown>;
  setProjectArchived: (projectId: string, archived: boolean) => Promise<unknown>;
  sendMessage: (taskId: string, text: string) => Promise<unknown>;
  cancelTask: (taskId: string) => Promise<unknown>;
  decide: (proposalId: string, approved: boolean) => Promise<unknown>;
  correct: (proposalId: string) => Promise<CorrectionResult>;
  disconnect: (connectionId: string) => Promise<unknown>;
  setConnectionTools: (
    connectionId: string,
    allowedTools: string[],
    resourceScope?: string,
  ) => Promise<unknown>;
  markRead: (itemId: string) => Promise<unknown>;
  assign: (itemId: string, employeeId: string, projectId?: string) => Promise<unknown>;
  saveDraft: (draft: Record<string, unknown>) => Promise<unknown>;
  publish: (draftId: string) => Promise<unknown>;
  retire: (versionId: string) => Promise<unknown>;
};

const unavailable = async () => undefined;
const unavailableCorrection = async (): Promise<CorrectionResult> => {
  throw new Error('Connect the backend before requesting a correction.');
};
const offlineActions: Actions = {
  bootstrap: unavailable,
  setBudget: unavailable,
  hire: unavailable,
  createTask: unavailable,
  createProject: unavailable,
  updateProject: unavailable,
  setProjectArchived: unavailable,
  sendMessage: unavailable,
  cancelTask: unavailable,
  decide: unavailable,
  correct: unavailableCorrection,
  disconnect: unavailable,
  setConnectionTools: unavailable,
  markRead: unavailable,
  assign: unavailable,
  saveDraft: unavailable,
  publish: unavailable,
  retire: unavailable,
};

const providers = providerCatalog.map((provider) => ({
  ...provider,
  short: provider.id === 'google-workspace' ? 'GW' : provider.name.slice(0, 2).toUpperCase(),
  inbox: 'Event delivery needs setup',
}));

const nav: Array<{ id: Page; label: string; icon: typeof LayoutGrid }> = [
  { id: 'office', label: 'Office', icon: LayoutGrid },
  { id: 'inbox', label: 'Inbox', icon: Inbox },
  { id: 'employees', label: 'Employees', icon: Users },
  { id: 'tasks', label: 'Tasks', icon: ListTodo },
  { id: 'files', label: 'Files', icon: FileText },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'marketplace', label: 'Marketplace', icon: Store },
  { id: 'integrations', label: 'Integrations', icon: Link2 },
];

export function AstraHq({ configured }: { configured: boolean }) {
  return configured ? (
    <ConnectedAstraHq />
  ) : (
    <WorkspaceShell
      configured={false}
      dashboard={emptyDashboard}
      listings={[]}
      drafts={[]}
      toolRegistry={[]}
      actions={offlineActions}
    />
  );
}

function ConnectedAstraHq() {
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const dashboard = useQuery(uiApi.dashboard, isAuthenticated ? {} : 'skip');
  const listings = useQuery(uiApi.listings, isAuthenticated ? {} : 'skip');
  const drafts = useQuery(uiApi.adminDrafts, isAuthenticated && dashboard?.isPlatformAdmin ? {} : 'skip');
  const toolRegistry = useQuery(
    uiApi.adminToolRegistry,
    isAuthenticated && dashboard?.isPlatformAdmin ? {} : 'skip',
  );
  const bootstrap = useMutation(uiApi.bootstrapWorkspace);
  const setBudget = useMutation(uiApi.setBudget);
  const hire = useMutation(uiApi.hire);
  const createTask = useMutation(uiApi.createTask);
  const createProject = useMutation(uiApi.createProject);
  const updateProject = useMutation(uiApi.updateProject);
  const setProjectArchived = useMutation(uiApi.setProjectArchived);
  const sendMessage = useMutation(uiApi.sendMessage);
  const cancelTask = useMutation(uiApi.cancelTask);
  const decide = useMutation(uiApi.decideAction);
  const correct = useMutation(uiApi.requestCorrection);
  const disconnect = useMutation(uiApi.disconnect);
  const setConnectionTools = useMutation(uiApi.setConnectionTools);
  const markRead = useMutation(uiApi.markInboxRead);
  const assign = useMutation(uiApi.assignInbox);
  const saveDraft = useMutation(uiApi.saveDraft);
  const publish = useMutation(uiApi.publishDraft);
  const retire = useMutation(uiApi.retireVersion);

  if (authLoading) return <CenteredLoader label="Opening Astra HQ" />;

  return (
    <>
      <SignedOut>
        <SignInScreen />
      </SignedOut>
      <SignedIn>
        {dashboard === undefined || listings === undefined ? (
          <CenteredLoader label="Loading your workspace" />
        ) : (
          <WorkspaceShell
            configured
            dashboard={dashboard}
            listings={listings}
            drafts={(drafts ?? []).map((draft) => ({ ...draft, id: draft.draftId }))}
            toolRegistry={toolRegistry ?? []}
            actions={{
              bootstrap: (name) => bootstrap({ name }),
              setBudget: (monthlyBudget) => setBudget({ monthlyBudget }),
              hire: (versionId) => hire({ versionId }),
              createTask: (employeeId, prompt, title, projectId) =>
                createTask({ employeeId, prompt, title, projectId }),
              createProject: (name, brief, employeeIds) => createProject({ name, brief, employeeIds }),
              updateProject: (projectId, name, brief, employeeIds) =>
                updateProject({ projectId, name, brief, employeeIds }),
              setProjectArchived: (projectId, archived) => setProjectArchived({ projectId, archived }),
              sendMessage: (taskId, text) => sendMessage({ taskId, text }),
              cancelTask: (taskId) => cancelTask({ taskId }),
              decide: (proposalId, approved) => decide({ proposalId, approved }),
              correct: (proposalId) => correct({ proposalId }),
              disconnect: (connectionId) => disconnect({ connectionId }),
              setConnectionTools: (connectionId, allowedTools, resourceScope) =>
                setConnectionTools({ connectionId, allowedTools, resourceScope }),
              markRead: (itemId) => markRead({ itemId }),
              assign: (itemId, employeeId, projectId) => assign({ itemId, employeeId, projectId }),
              saveDraft: (draft) => saveDraft(draft),
              publish: (draftId) => publish({ draftId }),
              retire: (versionId) => retire({ versionId }),
            }}
          />
        )}
      </SignedIn>
    </>
  );
}

function WorkspaceShell({
  configured,
  dashboard,
  listings,
  drafts,
  toolRegistry,
  actions,
}: {
  configured: boolean;
  dashboard: Dashboard;
  listings: Listing[];
  drafts: EditorDraft[];
  toolRegistry: AdminToolRegistry;
  actions: Actions;
}) {
  const [page, setPage] = useState<Page>('office');
  useEffect(() => {
    const sync = () => {
      const value = window.location.hash.slice(1);
      if (nav.some((item) => item.id === value) || value === 'admin') setPage(value as Page);
    };
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [projectEditor, setProjectEditor] = useState<Project | 'new' | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [taskProjectId, setTaskProjectId] = useState<string | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const workspace = dashboard.workspace;
  const canManageWorkspace = workspace?.role === 'owner' || workspace?.role === 'admin';
  const hasReadyEmployee = dashboard.employees.some((employee) => employee.status === 'ready');
  const pageName =
    page === 'admin' ? 'Marketplace admin' : (nav.find((item) => item.id === page)?.label ?? 'Office');

  useEffect(() => {
    if (selectedProjectId && !dashboard.projects.some((project) => project.id === selectedProjectId)) {
      setSelectedProjectId(null);
    }
  }, [dashboard.projects, selectedProjectId]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function go(next: Page) {
    setPage(next);
    window.location.hash = next;
    setSidebarOpen(false);
  }

  function openNewTask(projectId: string | null = null, employeeId: string | null = null) {
    setTaskProjectId(projectId);
    setSelectedEmployee(employeeId);
    setNewTaskOpen(true);
  }

  const run = async (work: () => Promise<unknown>, success: string) => {
    try {
      await work();
      setNotice(success);
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'That did not work. Please try again.');
      return false;
    }
  };

  const requestCorrection = async (proposal: ActionProposal) => {
    try {
      const result = await actions.correct(proposal.id);
      setSelectedTask(
        result.kind === 'task'
          ? result.taskId
          : (dashboard.proposals.find((item) => item.id === result.proposalId)?.taskId ?? proposal.taskId),
      );
      go('tasks');
      setNotice(result.kind === 'task' ? 'Correction task created' : 'Correction ready for review');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The correction could not be created.');
    }
  };

  return (
    <div className="app-frame">
      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="brand-row">
          <button className="brand" onClick={() => go('office')} aria-label="Astra HQ home">
            <span className="brand-glyph" aria-hidden="true">
              <Sparkles size={18} />
            </span>
            <span>
              Astra <i>HQ</i>
            </span>
          </button>
          <button
            className="icon-button sidebar-close"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close navigation"
          >
            <PanelLeftClose size={18} />
          </button>
        </div>

        <button className="workspace-chip" disabled={!configured} onClick={() => setSettingsOpen(true)}>
          <span className="workspace-mark">{workspace?.name?.slice(0, 1).toUpperCase() || 'A'}</span>
          <span>
            <strong>{workspace?.name || 'Your workspace'}</strong>
            <small>{workspace ? `${dashboard.employees.length} employees` : 'Ready to set up'}</small>
          </span>
          <ChevronDown size={14} />
        </button>

        <nav aria-label="Main navigation">
          <span className="nav-heading">WORKSPACE</span>
          {nav.map((item) => {
            const Icon = item.icon;
            const count =
              item.id === 'inbox'
                ? dashboard.inbox.filter((i) => i.status === 'unread').length
                : item.id === 'tasks'
                  ? dashboard.tasks.filter((t) => t.status === 'running' || t.status === 'awaiting_approval')
                      .length
                  : 0;
            return (
              <button
                key={item.id}
                className="nav-item"
                data-active={page === item.id}
                onClick={() => go(item.id)}
              >
                <Icon size={17} />
                <span>{item.label}</span>
                {count > 0 && <span className="nav-badge">{count}</span>}
              </button>
            );
          })}
          {dashboard.isPlatformAdmin && (
            <>
              <span className="nav-heading nav-admin-heading">PLATFORM</span>
              <button className="nav-item" data-active={page === 'admin'} onClick={() => go('admin')}>
                <ShieldCheck size={17} />
                <span>Marketplace admin</span>
              </button>
            </>
          )}
        </nav>

        <div className="sidebar-footer">
          {canManageWorkspace && (
            <div className="budget-mini">
              <span>
                <CircleDollarSign size={14} /> Monthly budget
              </span>
              <strong>
                {workspace
                  ? `$${Math.round(workspace.spent)} of $${Math.round(workspace.monthlyBudget)}`
                  : 'Not configured'}
              </strong>
              <div className="budget-track">
                <span
                  style={{
                    width: workspace?.monthlyBudget
                      ? `${Math.min(100, (workspace.spent / workspace.monthlyBudget) * 100)}%`
                      : '0%',
                  }}
                />
              </div>
            </div>
          )}
          <button className="account-row" onClick={() => setSettingsOpen(true)}>
            <span className="avatar avatar-user">
              <Settings size={16} />
            </span>
            <span>
              <strong>Workspace settings</strong>
              <small>{workspace?.role || 'Configuration'}</small>
            </span>
            <MoreHorizontal size={16} />
          </button>
        </div>
      </aside>

      {sidebarOpen && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <main className="main">
        <header className="topbar">
          <div className="topbar-title">
            <button
              className="icon-button mobile-menu"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open navigation"
            >
              <Menu size={20} />
            </button>
            <span>{pageName}</span>
          </div>
          <div className="topbar-actions">
            <button
              className="icon-button notification-button"
              aria-label="Open action reviews"
              title={
                dashboard.proposals.some((proposal) => proposal.status === 'pending')
                  ? 'Open action reviews'
                  : 'No action reviews'
              }
              disabled={!dashboard.proposals.some((proposal) => proposal.status === 'pending')}
              onClick={() => {
                const pending = dashboard.proposals.find((proposal) => proposal.status === 'pending');
                if (pending) {
                  setSelectedTask(pending.taskId);
                  go('tasks');
                }
              }}
            >
              <Bell size={17} />
              {dashboard.proposals.some((p) => p.status === 'pending') && <i />}
            </button>
            <button
              className="primary-button compact"
              disabled={!workspace || !hasReadyEmployee}
              onClick={() => openNewTask()}
            >
              <Plus size={16} />
              New task
            </button>
            {configured && (
              <div className="clerk-organization">
                <OrganizationSwitcher afterSelectOrganizationUrl="/" />
              </div>
            )}
            {configured && (
              <div className="clerk-user">
                <UserButton />
              </div>
            )}
          </div>
        </header>

        {!configured && <SetupBanner onSetup={() => setSettingsOpen(true)} />}
        <div className="page-wrap">
          {page === 'office' && (
            <FloorsOfficePage
              dashboard={dashboard}
              configured={configured}
              onPage={go}
              onEmployee={(id) => {
                setSelectedEmployee(id);
                go('employees');
              }}
              onTask={(id) => {
                setSelectedTask(id);
                go('tasks');
              }}
              selectedProjectId={selectedProjectId}
              onSelectProject={setSelectedProjectId}
              onNewProject={() => setProjectEditor('new')}
              onEditProject={setProjectEditor}
              onNewTask={(projectId) => openNewTask(projectId)}
            />
          )}
          {page === 'inbox' && (
            <InboxPage
              items={dashboard.inbox}
              employees={dashboard.employees}
              projects={dashboard.projects}
              configured={configured}
              onRead={(id) => run(() => actions.markRead(id), 'Marked as read')}
              onAssign={(itemId, employeeId, projectId) =>
                run(() => actions.assign(itemId, employeeId, projectId), 'Assigned to your employee')
              }
            />
          )}
          {page === 'employees' && (
            <EmployeesPage
              employees={dashboard.employees}
              connections={dashboard.connections}
              selectedId={selectedEmployee}
              onSelect={setSelectedEmployee}
              onMarketplace={() => go('marketplace')}
              onTask={(id) => {
                openNewTask(null, id);
              }}
            />
          )}
          {page === 'tasks' && (
            <TasksPage
              tasks={dashboard.tasks}
              projects={dashboard.projects}
              proposals={dashboard.proposals}
              selectedId={selectedTask}
              configured={configured}
              onSelect={setSelectedTask}
              onNew={() => openNewTask()}
              onSend={(taskId, text) => run(() => actions.sendMessage(taskId, text), 'Message sent')}
              onCancel={(taskId) => run(() => actions.cancelTask(taskId), 'Task cancelled')}
              onDecide={(id, approved) =>
                run(() => actions.decide(id, approved), approved ? 'Action approved' : 'Action rejected')
              }
              onCorrect={(id) => {
                const proposal = dashboard.proposals.find((item) => item.id === id);
                if (proposal) void requestCorrection(proposal);
              }}
            />
          )}
          {page === 'files' && <FilesPage dashboard={dashboard} onTasks={() => go('tasks')} />}
          {page === 'activity' && <ActivityPage dashboard={dashboard} />}
          {page === 'marketplace' && (
            <MarketplacePage
              listings={listings}
              employees={dashboard.employees}
              connections={dashboard.connections}
              configured={configured}
              isAdmin={dashboard.isPlatformAdmin}
              onHire={(id) => run(() => actions.hire(id), 'Employee added to your workspace')}
              onAdmin={() => go('admin')}
            />
          )}
          {page === 'integrations' && (
            <IntegrationsPage
              connections={dashboard.connections}
              configured={configured}
              onDisconnect={(id) => run(() => actions.disconnect(id), 'Integration disconnected')}
              onSetTools={(id, tools, scope) =>
                run(() => actions.setConnectionTools(id, tools, scope), 'Integration access updated')
              }
              onNotice={setNotice}
            />
          )}
          {page === 'admin' && dashboard.isPlatformAdmin && (
            <AdminPage
              drafts={drafts}
              listings={listings}
              toolRegistry={toolRegistry}
              onSave={(draft) => run(() => actions.saveDraft(draft), 'Draft saved')}
              onPublish={(id) => run(() => actions.publish(id), 'Employee published')}
              onRetire={(id) => run(() => actions.retire(id), 'Version retired')}
            />
          )}
        </div>
      </main>

      {settingsOpen && (
        <SettingsPanel
          dashboard={dashboard}
          configured={configured}
          onClose={() => setSettingsOpen(false)}
          onBootstrap={(name) => run(() => actions.bootstrap(name), 'Workspace created')}
          onBudget={(amount) => run(() => actions.setBudget(amount), 'Budget updated')}
        />
      )}
      {newTaskOpen && (
        <NewTaskPanel
          employees={dashboard.employees}
          projects={dashboard.projects}
          defaultEmployee={selectedEmployee}
          defaultProjectId={taskProjectId}
          configured={configured}
          onClose={() => setNewTaskOpen(false)}
          onCreate={async (employeeId, title, prompt, projectId) => {
            const created = await run(
              () => actions.createTask(employeeId, prompt, title, projectId),
              'Task started',
            );
            if (created) {
              setNewTaskOpen(false);
              go('tasks');
            }
          }}
        />
      )}
      {projectEditor && (
        <ProjectPanel
          project={projectEditor === 'new' ? null : projectEditor}
          employees={dashboard.employees}
          configured={configured && Boolean(workspace)}
          onClose={() => setProjectEditor(null)}
          onSave={async (name, brief, employeeIds) => {
            let createdProjectId: string | undefined;
            const saved = await run(
              async () => {
                if (projectEditor === 'new') {
                  const result = await actions.createProject(name, brief, employeeIds);
                  createdProjectId = (result as { projectId: string }).projectId;
                } else {
                  await actions.updateProject(projectEditor.id, name, brief, employeeIds);
                }
              },
              projectEditor === 'new' ? 'Floor created' : 'Floor updated',
            );
            if (saved) {
              if (createdProjectId) setSelectedProjectId(createdProjectId);
              setProjectEditor(null);
            }
          }}
          onArchive={async (project, archived) => {
            const saved = await run(
              () => actions.setProjectArchived(project.id, archived),
              archived ? 'Floor archived' : 'Floor restored',
            );
            if (saved) {
              if (archived) setSelectedProjectId(null);
              setProjectEditor(null);
            }
          }}
        />
      )}
      {notice && (
        <div className="toast" role="status">
          <CheckCircle2 size={17} />
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

function SetupBanner({ onSetup }: { onSetup: () => void }) {
  return (
    <div className="setup-banner" role="status">
      <span className="setup-banner-icon">
        <Cloud size={16} />
      </span>
      <span>
        <strong>Preview mode</strong> Add Clerk and Convex environment variables to connect this interface to
        your workspace.
      </span>
      <button className="setup-link" onClick={onSetup}>
        View setup <ArrowRight size={14} />
      </button>
    </div>
  );
}

function PageIntro({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-intro">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}

function FloorsOfficePage({
  dashboard,
  configured,
  onPage,
  onEmployee,
  onTask,
  selectedProjectId,
  onSelectProject,
  onNewProject,
  onEditProject,
  onNewTask,
}: {
  dashboard: Dashboard;
  configured: boolean;
  onPage: (page: Page) => void;
  onEmployee: (id: string) => void;
  onTask: (id: string) => void;
  selectedProjectId: string | null;
  onSelectProject: (id: string | null) => void;
  onNewProject: () => void;
  onEditProject: (project: Project) => void;
  onNewTask: (projectId: string | null) => void;
}) {
  const orderedProjects = [...dashboard.projects].sort((a, b) => a.createdAt - b.createdAt);
  const activeProjects = orderedProjects.filter((project) => !project.archivedAt);
  const archivedProjects = orderedProjects.filter((project) => project.archivedAt);
  const selectedProject = dashboard.projects.find((project) => project.id === selectedProjectId) ?? null;
  const assignedEmployeeIds = new Set(activeProjects.flatMap((project) => project.employeeIds));
  const floorEmployees = selectedProject
    ? selectedProject.employeeIds
        .map((id) => dashboard.employees.find((employee) => employee.id === id))
        .filter((employee): employee is Employee => Boolean(employee))
    : dashboard.employees.filter((employee) => !assignedEmployeeIds.has(employee.id));
  const floorTasks = dashboard.tasks.filter((task) =>
    selectedProject ? task.projectId === selectedProject.id : !task.projectId,
  );
  const activeTasks = floorTasks.filter((task) =>
    ['queued', 'running', 'awaiting_approval'].includes(task.status),
  );
  const officeEmployees = floorEmployees
    .filter((employee) => employee.status === 'ready')
    .map((employee) => {
      const work = activeTasks.find((task) => task.employeeId === employee.id);
      return {
        id: employee.id,
        name: employee.name,
        role: employee.role,
        color: employee.color,
        status: work?.status === 'awaiting_approval' ? 'review' : work ? 'working' : 'ready',
      };
    });
  const floorIndex = orderedProjects.findIndex((project) => project.id === selectedProject?.id);
  const floorLabel = selectedProject && floorIndex >= 0 ? `Floor ${floorIndex + 1}` : 'Lobby';
  const isArchived = Boolean(selectedProject?.archivedAt);

  return (
    <div className="office-page">
      <PageIntro
        eyebrow="PROJECT FLOORS"
        title={
          dashboard.workspace
            ? `Good ${timeGreeting()}, ${dashboard.workspace.name}`
            : 'Your team starts here'
        }
        description={
          dashboard.workspace
            ? 'Move between project floors, see who is staffed, and keep unassigned work in the lobby.'
            : 'Connect your workspace, hire your first employee, and give them a clear assignment.'
        }
        action={
          <button
            className="primary-button"
            disabled={!configured || !dashboard.workspace}
            onClick={onNewProject}
          >
            <Plus size={17} /> New project floor
          </button>
        }
      />
      <div className="building-layout">
        <aside className="floor-directory card" aria-label="Building directory">
          <div className="directory-head">
            <span className="building-mark" aria-hidden="true">
              <Building2 size={19} />
            </span>
            <div>
              <span className="eyebrow">BUILDING DIRECTORY</span>
              <h2>{dashboard.workspace?.name || 'Astra HQ'}</h2>
            </div>
          </div>
          <div className="directory-list">
            <button data-active={!selectedProject} onClick={() => onSelectProject(null)}>
              <span className="floor-number">L</span>
              <span>
                <strong>Lobby</strong>
                <small>{dashboard.tasks.filter((task) => !task.projectId).length} unassigned tasks</small>
              </span>
              <ChevronRight size={14} />
            </button>
            {activeProjects.map((project) => (
              <button
                key={project.id}
                data-active={selectedProject?.id === project.id}
                onClick={() => onSelectProject(project.id)}
              >
                <span className="floor-number">
                  {String(orderedProjects.findIndex((entry) => entry.id === project.id) + 1).padStart(2, '0')}
                </span>
                <span>
                  <strong>{project.name}</strong>
                  <small>
                    {project.employeeIds.length} {project.employeeIds.length === 1 ? 'employee' : 'employees'}
                  </small>
                </span>
                <ChevronRight size={14} />
              </button>
            ))}
          </div>
          {!activeProjects.length && (
            <div className="directory-empty">
              <p>Create a floor for each project, then staff it with the employees it needs.</p>
              <button
                className="text-button"
                onClick={onNewProject}
                disabled={!configured || !dashboard.workspace}
              >
                Add first floor
              </button>
            </div>
          )}
          {archivedProjects.length > 0 && (
            <div className="directory-archive">
              <span>ARCHIVED</span>
              {archivedProjects.map((project) => (
                <button
                  key={project.id}
                  data-active={selectedProject?.id === project.id}
                  onClick={() => onSelectProject(project.id)}
                >
                  <Archive size={13} />
                  <span>
                    {String(orderedProjects.findIndex((entry) => entry.id === project.id) + 1).padStart(
                      2,
                      '0',
                    )}{' '}
                    · {project.name}
                  </span>
                </button>
              ))}
            </div>
          )}
          <div className="directory-footer">
            <span>{activeProjects.length}</span>
            <p>active project {activeProjects.length === 1 ? 'floor' : 'floors'}</p>
          </div>
        </aside>

        <section className="floor-workspace card" aria-live="polite">
          <header className="floor-heading">
            <div>
              <span className="eyebrow">{isArchived ? 'ARCHIVED FLOOR' : floorLabel.toUpperCase()}</span>
              <h2>{selectedProject?.name || 'Lobby'}</h2>
              <p>{selectedProject?.brief || 'Tasks created without a project stay here.'}</p>
            </div>
            <div className="floor-heading-actions">
              {selectedProject && (
                <button className="secondary-button compact" onClick={() => onEditProject(selectedProject)}>
                  <Pencil size={14} /> {isArchived ? 'Manage' : 'Edit floor'}
                </button>
              )}
              {!isArchived && (
                <button
                  className="primary-button compact"
                  disabled={!officeEmployees.length}
                  onClick={() => onNewTask(selectedProject?.id ?? null)}
                >
                  <Plus size={15} /> Assign work
                </button>
              )}
            </div>
          </header>

          <div className="floor-overview">
            <div className="office-canvas floor-canvas">
              <div className="office-toolbar">
                <span>
                  <span className="live-dot" /> {isArchived ? 'ARCHIVED OFFICE' : 'LIVE OFFICE'}
                </span>
                <span>
                  {floorEmployees.length} {floorEmployees.length === 1 ? 'employee' : 'employees'}
                </span>
              </div>
              <div className="office-stage floor-stage">
                <OfficeView
                  employees={officeEmployees}
                  onSelect={onEmployee}
                  label={selectedProject ? `${floorLabel} · ${selectedProject.name}` : 'Lobby'}
                  emptyMessage={
                    selectedProject
                      ? 'This floor is ready. Edit the floor to add its project team.'
                      : 'The lobby is clear. Employees staffed on project floors appear there.'
                  }
                />
              </div>
              <div className="office-legend">
                <span>
                  <i className="status-dot working" /> Working
                </span>
                <span>
                  <i className="status-dot waiting" /> Needs review
                </span>
                <span>
                  <i className="status-dot idle" /> Available
                </span>
              </div>
            </div>

            <aside className="floor-team">
              <div className="section-title">
                <div>
                  <span className="eyebrow">STAFFING</span>
                  <h3>{selectedProject ? 'Project team' : 'Unassigned team'}</h3>
                </div>
                <span className="staff-count">{floorEmployees.length}</span>
              </div>
              {floorEmployees.length ? (
                <div className="floor-team-list">
                  {floorEmployees.map((employee) => (
                    <button key={employee.id} onClick={() => onEmployee(employee.id)}>
                      <Avatar employee={employee} />
                      <span>
                        <strong>{employee.name}</strong>
                        <small>{employee.role}</small>
                      </span>
                      <span
                        className={`availability ${employee.status.toLowerCase().includes('work') ? 'busy' : ''}`}
                      >
                        {employee.status}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <EmptyMini
                  icon={<Users size={19} />}
                  title={selectedProject ? 'No one staffed yet' : 'No one waiting in the lobby'}
                  text={
                    selectedProject
                      ? 'Edit this floor to add one or more employees.'
                      : 'Employees without an active project appear here.'
                  }
                />
              )}
              {selectedProject && !isArchived && (
                <button className="floor-team-edit" onClick={() => onEditProject(selectedProject)}>
                  <UserPlus size={14} /> Manage staffing
                </button>
              )}
            </aside>
          </div>

          <div className="floor-queue">
            <div className="section-title">
              <div>
                <span className="eyebrow">YOUR WORK QUEUE</span>
                <h3>
                  {activeTasks.length
                    ? `${activeTasks.length} active ${activeTasks.length === 1 ? 'task' : 'tasks'}`
                    : 'Nothing in motion'}
                </h3>
              </div>
              <button className="text-button" onClick={() => onPage('tasks')}>
                All tasks <ArrowRight size={14} />
              </button>
            </div>
            {activeTasks.length ? (
              <div className="floor-task-list">
                {activeTasks.slice(0, 5).map((task) => (
                  <button key={task.id} onClick={() => onTask(task.id)}>
                    <StatusMark status={task.status} />
                    <span>
                      <strong>{task.title}</strong>
                      <small>{task.employeeName}</small>
                    </span>
                    <span className="queue-meta">
                      {statusLabel(task.status)}
                      <small>{relativeTime(task.updatedAt)}</small>
                    </span>
                    <ChevronRight size={14} />
                  </button>
                ))}
              </div>
            ) : (
              <div className="floor-queue-empty">
                <Clock3 size={18} />
                <p>
                  {configured
                    ? selectedProject
                      ? 'Your assignments for this project will collect here.'
                      : 'Your unassigned tasks and older work will collect here.'
                    : 'Connect the backend to see live work.'}
                </p>
              </div>
            )}
          </div>
        </section>
      </div>
      <div className="office-summary" aria-label="Workspace summary">
        <button onClick={() => onPage('inbox')}>
          <span>Inbox</span>
          <strong>{dashboard.inbox.filter((item) => item.status === 'unread').length}</strong>
          <small>unread items</small>
        </button>
        <button onClick={() => onPage('tasks')}>
          <span>Reviews</span>
          <strong>{dashboard.proposals.filter((proposal) => proposal.status === 'pending').length}</strong>
          <small>need you</small>
        </button>
        <button onClick={() => onPage('activity')}>
          <span>Your active work</span>
          <strong>
            {dashboard.tasks.filter((task) => ['queued', 'running'].includes(task.status)).length}
          </strong>
          <small>across all floors</small>
        </button>
      </div>
    </div>
  );
}

function InboxPage({
  items,
  employees,
  projects,
  configured,
  onRead,
  onAssign,
}: {
  items: InboxItem[];
  employees: Employee[];
  projects: Project[];
  configured: boolean;
  onRead: (id: string) => void;
  onAssign: (itemId: string, employeeId: string, projectId?: string) => void;
}) {
  const [selected, setSelected] = useState(items[0]?.id ?? null);
  const item = items.find((entry) => entry.id === selected);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [projectId, setProjectId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const shown = filter === 'unread' ? items.filter((entry) => entry.status === 'unread') : items;
  const activeProjects = projects.filter((project) => !project.archivedAt);
  const selectedProject = activeProjects.find((project) => project.id === projectId);
  const eligibleEmployees = selectedProject
    ? employees.filter((employee) => selectedProject.employeeIds.includes(employee.id))
    : employees;
  useEffect(() => {
    if (employeeId && !eligibleEmployees.some((employee) => employee.id === employeeId)) setEmployeeId('');
  }, [eligibleEmployees, employeeId]);
  useEffect(() => {
    setProjectId('');
    setEmployeeId('');
  }, [selected]);
  return (
    <div>
      <PageIntro
        eyebrow="CONNECTED WORK"
        title="Inbox"
        description="New work from your approved integrations, ready to review or assign."
      />
      <div className="split-card card">
        <div className="list-pane">
          <div className="pane-toolbar">
            <div className="segmented">
              <button data-active={filter === 'all'} onClick={() => setFilter('all')}>
                All
              </button>
              <button data-active={filter === 'unread'} onClick={() => setFilter('unread')}>
                Unread
              </button>
            </div>
            <button className="icon-button" aria-label="Refresh inbox">
              <RefreshCw size={15} />
            </button>
          </div>
          {shown.length ? (
            <div className="inbox-list">
              {shown.map((entry) => (
                <button
                  key={entry.id}
                  data-active={selected === entry.id}
                  onClick={() => {
                    setSelected(entry.id);
                    if (entry.status === 'unread') onRead(entry.id);
                  }}
                >
                  <ProviderMark provider={entry.provider} />
                  <span>
                    <strong>{entry.title}</strong>
                    <small>{entry.preview}</small>
                    <time>{relativeTime(entry.createdAt)}</time>
                  </span>
                  {entry.status === 'unread' && <i className="unread-dot" />}
                </button>
              ))}
            </div>
          ) : (
            <EmptyPane
              icon={<Inbox size={23} />}
              title="Inbox zero"
              text={
                configured
                  ? 'New items from connected services will arrive here.'
                  : 'Connect the backend, then add an integration to receive work.'
              }
            />
          )}
        </div>
        <div className="detail-pane">
          {item ? (
            <>
              <div className="detail-heading">
                <ProviderMark provider={item.provider} />
                <div>
                  <span className="eyebrow">{providerName(item.provider)}</span>
                  <h2>{item.title}</h2>
                  <p>{relativeTime(item.createdAt)}</p>
                </div>
              </div>
              <div className="inbox-preview">{item.preview}</div>
              <div className="detail-actions">
                <label>
                  Project floor
                  <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                    <option value="">Lobby · Unassigned</option>
                    {activeProjects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Employee
                  <select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>
                    <option value="">Choose an employee</option>
                    {eligibleEmployees.map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="primary-button compact"
                  disabled={!employeeId || !configured}
                  onClick={() => onAssign(item.id, employeeId, projectId || undefined)}
                >
                  Assign
                </button>
                {item.sourceUrl && (
                  <a className="secondary-button" href={item.sourceUrl} target="_blank" rel="noreferrer">
                    Open source <ExternalLink size={15} />
                  </a>
                )}
              </div>
            </>
          ) : (
            <EmptyPane
              icon={<MessageSquareText size={25} />}
              title="Choose an item"
              text="The source, details, and assignment controls will appear here."
            />
          )}
        </div>
      </div>
    </div>
  );
}

function EmployeesPage({
  employees,
  connections,
  selectedId,
  onSelect,
  onMarketplace,
  onTask,
}: {
  employees: Employee[];
  connections: Connection[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMarketplace: () => void;
  onTask: (id: string) => void;
}) {
  const selected = employees.find((employee) => employee.id === selectedId) ?? employees[0];
  return (
    <div>
      <PageIntro
        eyebrow="YOUR TEAM"
        title="Employees"
        description="Every employee is pinned to a reviewed version with clear access and limits."
        action={
          <button className="primary-button" onClick={onMarketplace}>
            <UserPlus size={17} />
            Hire employee
          </button>
        }
      />
      {employees.length ? (
        <div className="employee-layout">
          <div className="employee-grid">
            {employees.map((employee) => (
              <button
                className="employee-card card"
                key={employee.id}
                data-active={selected?.id === employee.id}
                onClick={() => onSelect(employee.id)}
              >
                <Avatar employee={employee} large />
                <span
                  className={`availability ${employee.status.toLowerCase().includes('work') ? 'busy' : ''}`}
                />
                <div>
                  <h3>{employee.name}</h3>
                  <p>{employee.role}</p>
                </div>
                <span className="model-pill">{modelName(employee.model)}</span>
              </button>
            ))}
          </div>
          {selected && (
            <aside className="employee-profile card">
              <div className="profile-top">
                <Avatar employee={selected} large />
                <div>
                  <span className="eyebrow">EMPLOYEE PROFILE</span>
                  <h2>{selected.name}</h2>
                  <p>{selected.role}</p>
                </div>
              </div>
              <dl className="profile-facts">
                <div>
                  <dt>Status</dt>
                  <dd>
                    <i className="status-dot working" />
                    {selected.status}
                  </dd>
                </div>
                <div>
                  <dt>Model</dt>
                  <dd>{modelName(selected.model)}</dd>
                </div>
                <div>
                  <dt>Version</dt>
                  <dd>{selected.versionId.slice(0, 8)}</dd>
                </div>
              </dl>
              <div className="profile-section">
                <h3>Readiness</h3>
                {selected.status === 'retired' ? (
                  <p className="readiness-warn">
                    <Archive size={14} />
                    This employee version is retired
                  </p>
                ) : selected.missingCapabilities.length ? (
                  selected.missingCapabilities.map((capability) => (
                    <p className="readiness-warn" key={capability}>
                      <Link2 size={14} />
                      Missing {capability}
                    </p>
                  ))
                ) : (
                  <p className="readiness-ok">
                    <BadgeCheck size={15} />
                    All required connections are ready
                  </p>
                )}
              </div>
              <div className="profile-connections">
                <h3>Available connections</h3>
                <div>
                  {connections
                    .filter((connection) => connection.status === 'connected')
                    .map((connection) => (
                      <span key={connection.id}>
                        <ProviderMark provider={connection.provider} small />
                        {connection.name}
                      </span>
                    ))}
                </div>
              </div>
              <button
                className="primary-button full"
                disabled={selected.status !== 'ready'}
                onClick={() => onTask(selected.id)}
              >
                <Play size={15} />
                Assign new task
              </button>
            </aside>
          )}
        </div>
      ) : (
        <EmptySection
          icon={<Users size={28} />}
          title="Build your first team"
          text="The marketplace contains published employees with clear skills, limits, and integration requirements."
          action={
            <button className="primary-button" onClick={onMarketplace}>
              Browse marketplace <ArrowRight size={16} />
            </button>
          }
        />
      )}
    </div>
  );
}

function taskFloorName(task: Task, projects: Project[]) {
  return (
    task.projectContext?.name ?? projects.find((project) => project.id === task.projectId)?.name ?? 'Lobby'
  );
}

function TasksPage({
  tasks,
  projects,
  proposals,
  selectedId,
  configured,
  onSelect,
  onNew,
  onSend,
  onCancel,
  onDecide,
  onCorrect,
}: {
  tasks: Task[];
  projects: Project[];
  proposals: ActionProposal[];
  selectedId: string | null;
  configured: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onSend: (taskId: string, text: string) => void;
  onCancel: (taskId: string) => void;
  onDecide: (id: string, approved: boolean) => void;
  onCorrect: (id: string) => void;
}) {
  const [projectFilter, setProjectFilter] = useState('all');
  const shownTasks = tasks.filter((task) =>
    projectFilter === 'all'
      ? true
      : projectFilter === 'lobby'
        ? !task.projectId
        : task.projectId === projectFilter,
  );
  const selected = shownTasks.find((task) => task.id === selectedId) ?? shownTasks[0];
  return (
    <div>
      <PageIntro
        eyebrow="ASSIGNMENTS"
        title="Tasks"
        description="Follow work as it happens. Review external changes before they run."
        action={
          <button className="primary-button" onClick={onNew} disabled={!configured}>
            <Plus size={17} />
            New task
          </button>
        }
      />
      {tasks.length ? (
        <div className="task-layout card">
          <div className="task-list">
            <div className="pane-toolbar">
              <strong>
                {shownTasks.length} {shownTasks.length === 1 ? 'task' : 'tasks'}
              </strong>
              <label className="task-floor-filter">
                <span className="sr-only">Filter by project floor</span>
                <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
                  <option value="all">All floors</option>
                  <option value="lobby">Lobby</option>
                  {projects
                    .filter((project) => !project.archivedAt)
                    .map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            {shownTasks.map((task) => (
              <button key={task.id} data-active={selected?.id === task.id} onClick={() => onSelect(task.id)}>
                <StatusMark status={task.status} />
                <span>
                  <strong>{task.title}</strong>
                  <small>
                    {task.employeeName} · {relativeTime(task.updatedAt)}
                  </small>
                  <span className="task-floor-label">{taskFloorName(task, projects)}</span>
                </span>
              </button>
            ))}
            {!shownTasks.length && (
              <EmptyPane
                icon={<ListTodo size={22} />}
                title="No tasks on this floor"
                text="Choose another floor or create a task."
              />
            )}
          </div>
          {selected && (
            <TaskConversation
              task={selected}
              floorName={taskFloorName(selected, projects)}
              proposals={proposals.filter((proposal) => proposal.taskId === selected.id)}
              onSend={onSend}
              onCancel={onCancel}
              onDecide={onDecide}
              onCorrect={onCorrect}
            />
          )}
        </div>
      ) : (
        <EmptySection
          icon={<ListTodo size={28} />}
          title="No assignments yet"
          text="Choose an employee, describe the outcome you need, and follow their work here."
          action={
            <button className="primary-button" disabled={!configured} onClick={onNew}>
              <Plus size={16} />
              Create first task
            </button>
          }
        />
      )}
    </div>
  );
}

function TaskConversation({
  task,
  floorName,
  proposals,
  onSend,
  onCancel,
  onDecide,
  onCorrect,
}: {
  task: Task;
  floorName: string;
  proposals: ActionProposal[];
  onSend: (taskId: string, text: string) => void;
  onCancel: (taskId: string) => void;
  onDecide: (id: string, approved: boolean) => void;
  onCorrect: (id: string) => void;
}) {
  const messages = useQuery(uiApi.messages, { taskId: task.id });
  const [text, setText] = useState('');
  function submit(event: FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    onSend(task.id, value);
    setText('');
  }
  return (
    <div className="conversation">
      <div className="conversation-head">
        <div>
          <span className="eyebrow">
            {floorName} · {task.employeeName}
          </span>
          <h2>{task.title}</h2>
        </div>
        <div>
          <span className={`task-status status-${task.status}`}>
            <StatusMark status={task.status} />
            {statusLabel(task.status)}
          </span>
          {['queued', 'running', 'awaiting_approval'].includes(task.status) && (
            <button className="icon-button" onClick={() => onCancel(task.id)} aria-label="Cancel task">
              <Square size={14} />
            </button>
          )}
        </div>
      </div>
      <div className="message-stream">
        {task.projectContext && (
          <details className="task-project-context">
            <summary>Project brief at task start</summary>
            <p>{task.projectContext.brief}</p>
          </details>
        )}
        {task.prompt &&
          !messages?.some((message) => message.role === 'user' && message.text === task.prompt) && (
            <MessageBubble
              message={{
                id: 'prompt',
                taskId: task.id,
                role: 'user',
                text: task.prompt,
                createdAt: task.createdAt,
              }}
            />
          )}
        {messages === undefined ? (
          <div className="messages-loading">
            <LoaderCircle size={17} className="spin" />
            Loading conversation
          </div>
        ) : (
          messages.map((message) => <MessageBubble key={message.id} message={message} />)
        )}
        {proposals.map((proposal) => (
          <ProposalCard key={proposal.id} proposal={proposal} onDecide={onDecide} onCorrect={onCorrect} />
        ))}
        {task.status === 'running' && (
          <div className="working-line">
            <span>
              <i />
              <i />
              <i />
            </span>
            {task.employeeName} is working
          </div>
        )}
      </div>
      <form className="composer" onSubmit={submit}>
        <textarea
          aria-label="Message employee"
          placeholder={`Message ${task.employeeName}…`}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <div>
          <span>Shift + Enter for a new line</span>
          <button className="send-button" disabled={!text.trim()} aria-label="Send message">
            <Send size={16} />
          </button>
        </div>
      </form>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  if (message.role === 'system')
    return (
      <div className="system-message">
        <Clock3 size={13} />
        {message.text}
      </div>
    );
  return (
    <div className={`message ${message.role}`}>
      <span className="message-avatar">
        {message.role === 'user' ? <Users size={14} /> : <Bot size={15} />}
      </span>
      <div>
        <span>{message.role === 'user' ? 'You' : message.phase || 'Employee'}</span>
        <div className="message-markdown">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              img: ({ src, alt }) => {
                const href = safeHttpsUrl(src);
                return href ? (
                  <a href={href} target="_blank" rel="noreferrer">
                    {alt || 'Open image'}
                  </a>
                ) : (
                  <span>{alt || 'Image unavailable'}</span>
                );
              },
            }}
          >
            {message.text}
          </ReactMarkdown>
        </div>
        <time>{relativeTime(message.createdAt)}</time>
      </div>
    </div>
  );
}

function ProposalCard({
  proposal,
  onDecide,
  onCorrect,
}: {
  proposal: ActionProposal;
  onDecide: (id: string, approved: boolean) => void;
  onCorrect: (id: string) => void;
}) {
  const args = safeJson(proposal.arguments);
  return (
    <div className="proposal-card">
      <div className="proposal-head">
        <span className="proposal-icon">
          <ShieldCheck size={18} />
        </span>
        <div>
          <span className="eyebrow">ACTION REVIEW · {providerName(proposal.provider).toUpperCase()}</span>
          <h3>{proposal.summary}</h3>
        </div>
        <span className={`proposal-status proposal-${proposal.status}`}>
          {proposal.status.replace('_', ' ')}
        </span>
      </div>
      <div className="proposal-diff">
        <span>Proposed change</span>
        <pre>{args}</pre>
      </div>
      {proposal.result && (
        <div className="proposal-diff">
          <span>Result</span>
          <pre>{safeJson(proposal.result)}</pre>
        </div>
      )}
      <p className="correction-note">
        <RotateCcw size={14} />
        <span>
          <strong>{correctionLabel(proposal.correction)}</strong> {proposal.correctionReason}
        </span>
      </p>
      {proposal.status === 'pending' ? (
        <div className="proposal-actions">
          <button className="secondary-button danger" onClick={() => onDecide(proposal.id, false)}>
            Reject
          </button>
          <button className="primary-button" onClick={() => onDecide(proposal.id, true)}>
            <Check size={15} />
            Approve action
          </button>
        </div>
      ) : proposal.status === 'succeeded' && !['irreversible', 'unknown'].includes(proposal.correction) ? (
        <button className="text-button correction-button" onClick={() => onCorrect(proposal.id)}>
          <RotateCcw size={14} />
          Request correction
        </button>
      ) : null}
    </div>
  );
}

function FilesPage({ dashboard, onTasks }: { dashboard: Dashboard; onTasks: () => void }) {
  return (
    <div>
      <PageIntro
        eyebrow="OUTPUTS"
        title="Files"
        description="Artifacts created by your employees, with their task and source history attached."
      />
      {dashboard.artifacts.length ? (
        <div className="file-grid">
          {dashboard.artifacts.map((artifact) => (
            <a className="file-card card" key={artifact.id} href={`/api/files/${artifact.id}`}>
              <span className="file-icon">
                <FileText size={22} />
              </span>
              <div>
                <h3>{artifact.name}</h3>
                <p>
                  {fileSize(artifact.size)} · {artifact.mediaType}
                </p>
                <time>{relativeTime(artifact.createdAt)}</time>
              </div>
              <ArrowRight size={16} />
            </a>
          ))}
        </div>
      ) : (
        <EmptySection
          icon={<Archive size={29} />}
          title="No files yet"
          text="Reports, documents, and other employee outputs will collect here with a clear audit trail."
          action={
            <button className="secondary-button" onClick={onTasks}>
              View tasks
            </button>
          }
        />
      )}
    </div>
  );
}

function ActivityPage({ dashboard }: { dashboard: Dashboard }) {
  return (
    <div>
      <PageIntro
        eyebrow="HISTORY"
        title="Activity"
        description="A read-only account of work, reviews, and actions across your workspace."
      />
      <div className="activity-card card">
        <div className="activity-notice">
          <LockKeyhole size={15} />
          <span>Replay shows recorded history. It never reruns a model or repeats an external action.</span>
        </div>
        {dashboard.events.length ? (
          <ol className="activity-list">
            {dashboard.events.map((event) => (
              <li key={event.id}>
                <span className="timeline-mark">
                  <i />
                </span>
                <div>
                  <span className="eyebrow">{event.type.replaceAll('_', ' ')}</span>
                  <h3>{event.text}</h3>
                  <p>
                    {event.employeeName ? `${event.employeeName} · ` : ''}
                    {relativeTime(event.createdAt)}
                  </p>
                  {event.gap && <span className="event-gap">Some intermediate events were unavailable</span>}
                </div>
                <span className="sequence">#{event.sequence}</span>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyPane
            icon={<Activity size={25} />}
            title="History starts with real work"
            text="Task events and reviewed external actions will appear here after the backend is connected."
          />
        )}
      </div>
    </div>
  );
}

function MarketplacePage({
  listings,
  employees,
  connections,
  configured,
  isAdmin,
  onHire,
  onAdmin,
}: {
  listings: Listing[];
  employees: Employee[];
  connections: Connection[];
  configured: boolean;
  isAdmin: boolean;
  onHire: (id: string) => void;
  onAdmin: () => void;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [selected, setSelected] = useState<Listing | null>(null);
  const categories = [...new Set(listings.map((listing) => listing.category))].sort();
  const shown = listings.filter((listing) => {
    const haystack = `${listing.name} ${listing.role} ${listing.category} ${listing.description} ${listing.strengths.join(' ')} ${listing.capabilities.map((capability) => providerName(capability.provider)).join(' ')}`;
    return (
      haystack.toLowerCase().includes(query.toLowerCase()) &&
      (category === 'all' || listing.category === category)
    );
  });
  return (
    <div>
      <PageIntro
        eyebrow="EMPLOYEE MARKETPLACE"
        title="Meet your next hire"
        description="Published employees with versioned skills, clear limits, and no marketplace fee."
        action={
          isAdmin ? (
            <button className="secondary-button" onClick={onAdmin}>
              <ShieldCheck size={16} />
              Manage listings
            </button>
          ) : undefined
        }
      />
      <div className="market-toolbar">
        <label className="market-search">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by role or skill"
          />
        </label>
        <label className="category-filter">
          <SlidersHorizontal size={15} />
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            aria-label="Filter by category"
          >
            <option value="all">All categories</option>
            {categories.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>
      {shown.length ? (
        <div className="market-grid">
          {shown.map((listing) => {
            const hired = employees.some((employee) => employee.versionId === listing.versionId);
            const missing = missingRequiredCapabilities(listing, connections);
            return (
              <article className="listing-card card" key={listing.versionId}>
                <button
                  type="button"
                  className="listing-visual"
                  style={{ '--listing-color': listing.color } as React.CSSProperties}
                  onClick={() => setSelected(listing)}
                  aria-label={`View ${listing.name}`}
                >
                  {listing.media[0]?.type === 'image' ? (
                    <img src={listing.media[0].url} alt={listing.media[0].alt} />
                  ) : (
                    <>
                      <span className="listing-orbit">
                        <Bot size={32} />
                      </span>
                      <i className="pixel-star star-one" />
                      <i className="pixel-star star-two" />
                    </>
                  )}
                </button>
                <div className="listing-copy">
                  <span className="category-pill">{listing.category}</span>
                  <h2>{listing.name}</h2>
                  <p className="listing-role">{listing.role}</p>
                  <p className="listing-description">{listing.description}</p>
                  <div className="capability-row">
                    {listing.capabilities.slice(0, 4).map((capability) => (
                      <span key={capability.provider}>
                        <ProviderMark provider={capability.provider} small />
                        {providerName(capability.provider)}
                      </span>
                    ))}
                  </div>
                  <div className="listing-footer">
                    <span>
                      <strong>Free to hire</strong>
                      <small>Usage billed separately</small>
                    </span>
                    <button className="primary-button" onClick={() => setSelected(listing)}>
                      View details <ArrowRight size={15} />
                    </button>
                  </div>
                  {missing.length > 0 && !hired && (
                    <p className="listing-requirement">
                      <LockKeyhole size={13} /> Connect {missing.map(providerName).join(', ')} to hire
                    </p>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="empty-market card">
          <div className="market-shelves" aria-hidden="true">
            <span>
              <i />
              <i />
              <i />
            </span>
            <span>
              <i />
              <i />
            </span>
          </div>
          <span className="eyebrow">CURATED BY YOUR PLATFORM TEAM</span>
          <h2>
            {query || category !== 'all'
              ? 'No employees match these filters'
              : 'The marketplace is ready for its first employee'}
          </h2>
          <p>
            {query || category !== 'all'
              ? 'Try another role, capability, or category.'
              : 'Only reviewed, published employees appear here. Platform admins can author private instructions and publish a version when it is ready.'}
          </p>
          {isAdmin && !query && category === 'all' && (
            <button className="primary-button" onClick={onAdmin}>
              Create the first listing <ArrowRight size={16} />
            </button>
          )}
        </div>
      )}
      {selected && (
        <MarketplaceDetail
          listing={selected}
          hired={employees.some((employee) => employee.versionId === selected.versionId)}
          configured={configured}
          missing={missingRequiredCapabilities(selected, connections)}
          onClose={() => setSelected(null)}
          onHire={() => onHire(selected.versionId)}
        />
      )}
    </div>
  );
}

function MarketplaceDetail({
  listing,
  hired,
  configured,
  missing,
  onClose,
  onHire,
}: {
  listing: Listing;
  hired: boolean;
  configured: boolean;
  missing: ProviderId[];
  onClose: () => void;
  onHire: () => void;
}) {
  const [mediaIndex, setMediaIndex] = useState(0);
  const [mediaFailed, setMediaFailed] = useState(false);
  const media = listing.media[mediaIndex];
  const canHire = configured && !hired && missing.length === 0;
  useEffect(() => setMediaFailed(false), [mediaIndex]);
  return (
    <Sheet wide title={listing.name} subtitle={listing.role} onClose={onClose}>
      <div className="market-detail">
        <div className="market-gallery" style={{ '--listing-color': listing.color } as CSSProperties}>
          <div className="market-gallery-stage">
            {media && mediaFailed && (
              <div className="market-media-error">
                <Archive size={24} />
                <strong>Preview unavailable</strong>
                {media.url.startsWith('https://') && (
                  <a href={media.url} target="_blank" rel="noreferrer">
                    Open source <ExternalLink size={13} />
                  </a>
                )}
              </div>
            )}
            {media?.type === 'image' && !mediaFailed && (
              <img src={media.url} alt={media.alt} onError={() => setMediaFailed(true)} />
            )}
            {media?.type === 'video' && !mediaFailed && (
              <video
                src={media.url}
                controls
                preload="metadata"
                aria-label={media.alt}
                onError={() => setMediaFailed(true)}
              />
            )}
            {!media && (
              <span className="listing-orbit">
                <Bot size={48} />
              </span>
            )}
          </div>
          {listing.media.length > 1 && (
            <div className="market-thumbnails" aria-label="Listing media">
              {listing.media.map((item, index) => (
                <button
                  key={`${item.url}-${index}`}
                  data-active={index === mediaIndex}
                  onClick={() => setMediaIndex(index)}
                >
                  {item.type === 'image' ? (
                    <img src={item.url} alt="" />
                  ) : (
                    <span>
                      <Play size={16} />
                    </span>
                  )}
                  <span className="sr-only">{item.alt}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="market-detail-copy">
          <span className="category-pill">{listing.category}</span>
          <h2>{listing.name}</h2>
          <p className="listing-role">{listing.role}</p>
          <p className="market-description">{listing.description}</p>
          <div className="strength-grid">
            <section>
              <h3>
                <CheckCircle2 size={16} /> Strengths
              </h3>
              {listing.strengths.length ? (
                <ul>
                  {listing.strengths.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p>No strengths listed.</p>
              )}
            </section>
            <section>
              <h3>
                <SlidersHorizontal size={16} /> Limits
              </h3>
              {listing.limitations.length ? (
                <ul>
                  {listing.limitations.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p>No limits listed.</p>
              )}
            </section>
          </div>
          <section className="market-capabilities">
            <h3>Integration access</h3>
            <p>The employee receives only these approved MCP tools.</p>
            {listing.capabilities.length ? (
              listing.capabilities.map((capability) => (
                <div key={capability.provider}>
                  <ProviderMark provider={capability.provider} />
                  <span>
                    <strong>{providerName(capability.provider)}</strong>
                    <small>{capability.optional ? 'Optional' : 'Required'}</small>
                  </span>
                  <code>{capability.tools.join(', ') || 'No tools'}</code>
                </div>
              ))
            ) : (
              <div className="capability-empty">No integrations required</div>
            )}
          </section>
          {missing.length > 0 && (
            <div className="hire-blocked">
              <LockKeyhole size={16} />
              <span>
                <strong>Connections required</strong>
                <small>
                  Connect {missing.map(providerName).join(', ')} with every required tool before hiring.
                </small>
              </span>
            </div>
          )}
          <div className="market-hire-bar">
            <span>
              <strong>Free</strong>
              <small>OpenAI and provider usage billed separately</small>
            </span>
            <button
              className={hired ? 'secondary-button' : 'primary-button'}
              disabled={!canHire}
              onClick={onHire}
            >
              {hired ? (
                <>
                  <Check size={15} /> Already hired
                </>
              ) : (
                <>
                  Hire employee <ArrowRight size={15} />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}

function IntegrationsPage({
  connections,
  configured,
  onDisconnect,
  onSetTools,
  onNotice,
}: {
  connections: Connection[];
  configured: boolean;
  onDisconnect: (id: string) => void;
  onSetTools: (id: string, tools: string[], scope?: string) => void;
  onNotice: (text: string) => void;
}) {
  const [connecting, setConnecting] = useState<ProviderId | null>(null);
  const [managing, setManaging] = useState<Connection | null>(null);
  return (
    <div>
      <PageIntro
        eyebrow="CONNECTIONS"
        title="Integrations"
        description="Choose exactly which services, tools, and resources your employees may use."
      />
      <div className="security-callout">
        <ShieldCheck size={20} />
        <div>
          <strong>Access stays explicit</strong>
          <p>
            Every write is checked against the employee, connection, tool, and resource scope. Sensitive
            actions wait for your review.
          </p>
        </div>
        <span>MCP only</span>
      </div>
      <div className="integration-grid">
        {providers.map((provider) => {
          const providerConnections = connections.filter(
            (item) => item.provider === provider.id && item.status !== 'disconnected',
          );
          const connectedCount = providerConnections.filter((item) => item.status === 'connected').length;
          return (
            <article className="integration-card card" key={provider.id}>
              <div className="integration-top">
                <ProviderLogo provider={provider} />
                <span className={`connection-state ${connectedCount ? 'connected' : 'available'}`}>
                  <i />
                  {connectedCount ? `${connectedCount} connected` : 'Available'}
                </span>
              </div>
              <h2>{provider.name}</h2>
              <p>{provider.description}</p>
              <div className="integration-meta">
                <span>
                  <Inbox size={14} />
                  {providerConnections.some((connection) => connection.inboxMode === 'push')
                    ? 'Live inbox'
                    : provider.inbox}
                </span>
                {providerConnections.length > 0 && (
                  <span>
                    <KeyRound size={14} />
                    {providerConnections.reduce((count, item) => count + item.allowedTools.length, 0)} tools
                    allowed
                  </span>
                )}
              </div>
              {providerConnections.length > 0 ? (
                <div className="connection-accounts">
                  {providerConnections.map((connection) => (
                    <div className="connection-account" key={connection.id}>
                      <span>
                        <strong>{connection.name}</strong>
                        <small>
                          {connection.account} · {connection.allowedTools.length} tools
                        </small>
                      </span>
                      <span className={`connection-state ${connection.status}`}>
                        <i />
                        {connection.status}
                      </span>
                      <div>
                        <button className="text-button" onClick={() => setManaging(connection)}>
                          Manage
                        </button>
                        <button
                          className="text-button danger-text"
                          onClick={() => onDisconnect(connection.id)}
                        >
                          Disconnect
                        </button>
                      </div>
                    </div>
                  ))}
                  <button
                    className="secondary-button full"
                    disabled={!configured}
                    onClick={() => setConnecting(provider.id)}
                  >
                    <Plus size={15} /> Add another {provider.name} connection
                  </button>
                </div>
              ) : (
                <button
                  className="secondary-button full"
                  disabled={!configured}
                  onClick={() => setConnecting(provider.id)}
                >
                  Connect {provider.name} <ArrowRight size={15} />
                </button>
              )}
            </article>
          );
        })}
      </div>
      {connecting && (
        <ConnectPanel provider={connecting} onClose={() => setConnecting(null)} onNotice={onNotice} />
      )}
      {managing && (
        <ToolAccessPanel
          connection={managing}
          onClose={() => setManaging(null)}
          onSave={(tools, scope) => {
            onSetTools(managing.id, tools, scope);
            setManaging(null);
          }}
        />
      )}
    </div>
  );
}

type DiscoveredTool = { name: string; description?: string };

function ConnectPanel({
  provider,
  onClose,
  onNotice,
}: {
  provider: ProviderId;
  onClose: () => void;
  onNotice: (text: string) => void;
}) {
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const [scope, setScope] = useState('');
  const definition = getProvider(provider);
  const [serverUrl, setServerUrl] = useState(definition.serverUrl);
  const [busy, setBusy] = useState(false);
  const [tools, setTools] = useState<DiscoveredTool[]>([]);
  const [allowed, setAllowed] = useState<string[]>([]);

  async function request(discoverOnly: boolean) {
    const productName = definition.products?.find((product) => product.url === serverUrl)?.name;
    const response = await fetch('/api/integrations/connect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider,
        name: name.trim() || productName || providerName(provider),
        serverUrl,
        accessToken: token || undefined,
        allowedTools: discoverOnly ? [] : allowed,
        resourceScope: scope.trim(),
        discoverOnly,
      }),
    });
    const body = (await response.json()) as {
      authorizationUrl?: string;
      tools?: Array<DiscoveredTool | string>;
      error?: string;
    };
    if (!response.ok) throw new Error(body.error || 'Connection failed');
    if (body.authorizationUrl) {
      window.location.assign(body.authorizationUrl);
      return;
    }
    if (discoverOnly) {
      const discovered = (body.tools ?? []).map((tool) => (typeof tool === 'string' ? { name: tool } : tool));
      setTools(discovered);
      setAllowed([]);
    } else {
      onNotice('Connection added with the selected tools.');
      onClose();
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await request(tools.length === 0);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : 'Connection failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={`Connect ${providerName(provider)}`}
      subtitle="Credentials stay on the server. Review discovered MCP tools before granting access."
      onClose={onClose}
    >
      <form className="form-stack" onSubmit={submit}>
        {tools.length === 0 ? (
          <>
            {provider === 'google-workspace' && (
              <div className="workspace-guidance">
                <ShieldCheck size={17} />
                <div>
                  <strong>Google Workspace preview rules</strong>
                  <p>
                    Start with named drives, calendars, or mail scopes. Gmail sending and broad deletion stay
                    unavailable. Employees treat messages and documents as untrusted content, and
                    cross-service exports always need an explicit destination.
                  </p>
                </div>
              </div>
            )}
            <label>
              Connection name
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={`My ${providerName(provider)} account`}
              />
            </label>
            <p className="form-note">{definition.note}</p>
            {definition.products ? (
              <label>
                Google Workspace product
                <select value={serverUrl} onChange={(event) => setServerUrl(event.target.value)}>
                  {definition.products.map((product) => (
                    <option key={product.url} value={product.url}>
                      {product.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {!definition.serverUrl ? (
              <label>
                Approved MCP server URL
                <input
                  type="url"
                  required
                  value={serverUrl}
                  onChange={(event) => setServerUrl(event.target.value)}
                  placeholder="https://your-instance.example/mcp"
                />
              </label>
            ) : null}
            <label>
              Access token, if required
              <input
                type="password"
                autoComplete="off"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="Paste a service token or continue with OAuth"
              />
            </label>
            <label>
              Resource scope
              <textarea
                value={scope}
                onChange={(event) => setScope(event.target.value)}
                placeholder="Optional comma-separated resource IDs. Leave blank to use the provider account permissions."
              />
            </label>
            <div className="form-note">
              <LockKeyhole size={15} />A platform-approved server is selected from the registry. Arbitrary MCP
              URLs are rejected. Resource restrictions require a verified tool mapping; broad searches are
              blocked on restricted connections.
            </div>
            <button className="primary-button full" disabled={busy}>
              {busy ? <LoaderCircle className="spin" size={16} /> : <Link2 size={16} />}
              {busy ? 'Checking connection' : token ? 'Discover MCP tools' : 'Continue with OAuth'}
            </button>
          </>
        ) : (
          <>
            <div className="permission-heading">
              <span className="eyebrow">DISCOVERED TOOLS</span>
              <h3>Choose what this connection can do</h3>
              <p>Nothing is granted until you select and save it.</p>
            </div>
            <ToolChecklist tools={tools} selected={allowed} onChange={setAllowed} />
            <button className="primary-button full" disabled={busy || allowed.length === 0}>
              {busy ? <LoaderCircle className="spin" size={16} /> : <ShieldCheck size={16} />}
              {busy ? 'Saving access' : `Allow ${allowed.length} ${allowed.length === 1 ? 'tool' : 'tools'}`}
            </button>
          </>
        )}
      </form>
    </Sheet>
  );
}

function ToolAccessPanel({
  connection,
  onClose,
  onSave,
}: {
  connection: Connection;
  onClose: () => void;
  onSave: (tools: string[], scope?: string) => void;
}) {
  const [selected, setSelected] = useState(connection.allowedTools);
  const [scope, setScope] = useState(connection.resourceScope);
  const tools = connection.tools.map((name) => ({ name }));
  return (
    <Sheet
      title={`Manage ${connection.name}`}
      subtitle="Changes take effect for new gateway calls as soon as you save."
      onClose={onClose}
    >
      <div className="form-stack">
        <label>
          Resource scope
          <textarea value={scope} onChange={(event) => setScope(event.target.value)} />
        </label>
        <ToolChecklist tools={tools} selected={selected} onChange={setSelected} />
        <div className="form-note">
          <ShieldCheck size={15} />
          Removing a tool revokes access immediately, including for running agent sessions.
        </div>
        <button className="primary-button full" onClick={() => onSave(selected, scope.trim())}>
          Save access
        </button>
      </div>
    </Sheet>
  );
}

function ToolChecklist({
  tools,
  selected,
  onChange,
}: {
  tools: DiscoveredTool[];
  selected: string[];
  onChange: (tools: string[]) => void;
}) {
  return (
    <div className="tool-checklist">
      {tools.map((tool) => {
        const checked = selected.includes(tool.name);
        return (
          <label key={tool.name}>
            <input
              type="checkbox"
              checked={checked}
              onChange={() =>
                onChange(checked ? selected.filter((name) => name !== tool.name) : [...selected, tool.name])
              }
            />
            <span>
              <strong>{tool.name}</strong>
              {tool.description && <small>{tool.description}</small>}
            </span>
          </label>
        );
      })}
    </div>
  );
}

function AdminPage({
  drafts,
  listings,
  toolRegistry,
  onSave,
  onPublish,
  onRetire,
}: {
  drafts: EditorDraft[];
  listings: Listing[];
  toolRegistry: AdminToolRegistry;
  onSave: (draft: Record<string, unknown>) => Promise<boolean>;
  onPublish: (id: string) => void;
  onRetire: (id: string) => void;
}) {
  const [editing, setEditing] = useState<EditorDraft | 'new' | null>(null);
  return (
    <div>
      <PageIntro
        eyebrow="PLATFORM ADMIN"
        title="Marketplace studio"
        description="Author private employee definitions and publish immutable versions for customer workspaces."
        action={
          <button className="primary-button" onClick={() => setEditing('new')}>
            <Plus size={16} />
            New employee
          </button>
        }
      />
      <div className="admin-summary">
        <span>
          <FileText size={18} />
          <strong>{drafts.length}</strong>
          <small>drafts</small>
        </span>
        <span>
          <BadgeCheck size={18} />
          <strong>{listings.length}</strong>
          <small>published versions</small>
        </span>
        <span>
          <LockKeyhole size={18} />
          <strong>Private</strong>
          <small>instructions stay server-side</small>
        </span>
      </div>
      <section className="admin-section">
        <div className="section-title">
          <div>
            <span className="eyebrow">WORK IN PROGRESS</span>
            <h2>Drafts</h2>
          </div>
        </div>
        {drafts.length ? (
          <div className="admin-list">
            {drafts.map((draft) => {
              const issues = draftPublishIssues(draft, toolRegistry);
              return (
                <article className="card" key={draft.id}>
                  <span className="draft-avatar" style={{ background: draft.color }}>
                    <Bot size={18} />
                  </span>
                  <div>
                    <h3>{draft.name || 'Untitled employee'}</h3>
                    <p>
                      {draft.role || 'Role not set'} · Updated {relativeTime(draft.updatedAt)}
                    </p>
                  </div>
                  <span className="model-pill">{modelName(draft.model)}</span>
                  <button className="secondary-button" onClick={() => setEditing(draft)}>
                    Edit
                  </button>
                  <button
                    className="primary-button"
                    disabled={issues.length > 0}
                    title={issues.join(' ')}
                    onClick={() => onPublish(draft.id)}
                  >
                    <BadgeCheck size={15} />
                    {issues.length ? 'Not ready' : 'Publish'}
                  </button>
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyMini
            icon={<FileText size={20} />}
            title="No drafts"
            text="Create an employee definition to start the review and publishing process."
          />
        )}
      </section>
      <section className="admin-section">
        <div className="section-title">
          <div>
            <span className="eyebrow">CUSTOMER CATALOG</span>
            <h2>Published</h2>
          </div>
        </div>
        {listings.length ? (
          <div className="admin-list">
            {listings.map((listing) => (
              <article className="card" key={listing.versionId}>
                <span className="draft-avatar" style={{ background: listing.color }}>
                  <Bot size={18} />
                </span>
                <div>
                  <h3>{listing.name}</h3>
                  <p>
                    {listing.role} · Published {relativeTime(listing.publishedAt)}
                  </p>
                </div>
                <span className="model-pill">{modelName(listing.model)}</span>
                <button className="secondary-button danger" onClick={() => onRetire(listing.versionId)}>
                  Retire version
                </button>
              </article>
            ))}
          </div>
        ) : (
          <EmptyMini
            icon={<Store size={20} />}
            title="Nothing published"
            text="The customer marketplace stays empty until an admin publishes a reviewed draft."
          />
        )}
      </section>
      {editing && (
        <EmployeeEditor
          draft={editing === 'new' ? undefined : editing}
          toolRegistry={toolRegistry}
          onClose={() => setEditing(null)}
          onSave={async (value) => {
            if (await onSave(value)) setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function EmployeeEditor({
  draft,
  toolRegistry,
  onClose,
  onSave,
}: {
  draft?: EditorDraft;
  toolRegistry: AdminToolRegistry;
  onClose: () => void;
  onSave: (value: Record<string, unknown>) => Promise<void>;
}) {
  const [name, setName] = useState(draft?.name ?? '');
  const [role, setRole] = useState(draft?.role ?? '');
  const [description, setDescription] = useState(draft?.description ?? '');
  const [category, setCategory] = useState(draft?.category ?? '');
  const [color, setColor] = useState(draft?.color ?? '#6f8d72');
  const [model, setModel] = useState<ModelId>(draft?.model ?? 'gpt-5.6-terra');
  const [instructions, setInstructions] = useState(draft?.instructions ?? '');
  const [strengths, setStrengths] = useState(draft?.strengths.join('\n') ?? '');
  const [limitations, setLimitations] = useState(draft?.limitations.join('\n') ?? '');
  const [capabilities, setCapabilities] = useState(() =>
    (draft?.capabilities ?? []).map((item) => ({ ...item, rowId: editorRowId() })),
  );
  const [skills, setSkills] = useState(() =>
    (draft?.skills ?? []).map((item) => ({ ...item, rowId: editorRowId() })),
  );
  const [media, setMedia] = useState(() =>
    (draft?.media ?? []).map((item) => ({ ...item, rowId: editorRowId() })),
  );
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const skillCharacters = skills.reduce((total, skill) => total + skill.content.length, 0);
  const skillLimitError =
    skills.length > 10
      ? 'An employee can have at most 10 skills.'
      : skillCharacters > 600_000
        ? 'Private skill content must total 600,000 characters or less.'
        : null;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (![name, role, description, category, color, instructions].every((value) => value.trim())) {
      setFormError('Complete every required listing and runtime field.');
      return;
    }
    const longStrength = lines(strengths).find((item) => item.length > 200);
    if (longStrength) {
      setFormError('Each strength must be 200 characters or less.');
      return;
    }
    const longLimitation = lines(limitations).find((item) => item.length > 300);
    if (longLimitation) {
      setFormError('Each limitation must be 300 characters or less.');
      return;
    }
    if (skills.some((skill) => !skill.name.trim() || !skill.version.trim())) {
      setFormError('Every skill needs a name and version.');
      return;
    }
    if (skillLimitError) {
      setFormError(skillLimitError);
      return;
    }
    setFormError(null);
    setSaving(true);
    try {
      const hashedSkills = await Promise.all(
        skills.map(async ({ rowId: _rowId, ...skill }) => ({
          ...skill,
          sha256: await sha256(skill.content),
        })),
      );
      await onSave({
        draftId: draft?.id,
        name,
        role,
        description,
        category,
        color,
        model,
        instructions,
        strengths: lines(strengths),
        limitations: lines(limitations),
        capabilities: capabilities.map(({ rowId: _rowId, ...capability }) => capability),
        media: media.map(({ rowId: _rowId, ...item }) => item),
        skills: hashedSkills,
      });
    } finally {
      setSaving(false);
    }
  }
  return (
    <Sheet
      wide
      title={draft ? `Edit ${draft.name || 'draft'}` : 'Create employee'}
      subtitle="Public listing details are separated from private instructions and skill files."
      onClose={onClose}
    >
      <form className="editor-form" onSubmit={submit}>
        <section>
          <span className="editor-step">01</span>
          <div>
            <h3>Marketplace listing</h3>
            <p>Customers see these details before hiring.</p>
          </div>
        </section>
        <div className="form-grid">
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
          </label>
          <label>
            Role
            <input value={role} onChange={(e) => setRole(e.target.value)} maxLength={120} required />
          </label>
          <label className="full-field">
            Description
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              required
            />
          </label>
          <label>
            Category
            <input value={category} onChange={(e) => setCategory(e.target.value)} maxLength={80} required />
          </label>
          <label>
            Accent color
            <span className="color-input">
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
              <input value={color} onChange={(e) => setColor(e.target.value)} maxLength={40} required />
            </span>
          </label>
          <label>
            Strengths, one per line
            <textarea value={strengths} onChange={(e) => setStrengths(e.target.value)} />
          </label>
          <label>
            Limitations, one per line
            <textarea value={limitations} onChange={(e) => setLimitations(e.target.value)} />
          </label>
        </div>
        <section>
          <span className="editor-step">02</span>
          <div>
            <h3>Runtime</h3>
            <p>These details remain private and versioned.</p>
          </div>
        </section>
        <div className="form-grid">
          <label>
            Model
            <select value={model} onChange={(e) => setModel(e.target.value as ModelId)}>
              <option value="gpt-5.6-luna">Luna · narrow, high-volume work</option>
              <option value="gpt-5.6-terra">Terra · routine multi-step work</option>
              <option value="gpt-5.6-sol">Sol · complex judgment</option>
              <option value="gpt-6-astra">Astra · hardest assignments</option>
            </select>
          </label>
          <label className="full-field">
            Private instructions
            <textarea
              className="code-area"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              maxLength={100_000}
              required
              spellCheck={false}
              placeholder="Describe the role, operating rules, and handoff requirements…"
            />
          </label>
        </div>
        <section>
          <span className="editor-step">03</span>
          <div>
            <h3>MCP capabilities</h3>
            <p>Required connections block hiring until every listed tool is granted.</p>
          </div>
          <button
            type="button"
            className="secondary-button editor-add"
            onClick={() =>
              setCapabilities((items) => [
                ...items,
                { rowId: editorRowId(), provider: 'linear', tools: [], optional: false },
              ])
            }
          >
            <Plus size={14} /> Add MCP
          </button>
        </section>
        <div className="editor-rows">
          {capabilities.map((capability) => {
            const registry = toolRegistry.find((item) => item.provider === capability.provider);
            const registeredTools = registry?.tools ?? [];
            const visibleTools = [
              ...registeredTools,
              ...capability.tools
                .filter((name) => !registeredTools.some((tool) => tool.name === name))
                .map((name) => ({
                  name,
                  description: 'Not in the current registry',
                  mode: 'blocked' as const,
                })),
            ];
            return (
              <div className="editor-row capability-editor" key={capability.rowId}>
                <div className="editor-row-head">
                  <label>
                    MCP provider
                    <select
                      value={capability.provider}
                      onChange={(event) =>
                        setCapabilities((items) =>
                          items.map((item) =>
                            item.rowId === capability.rowId
                              ? { ...item, provider: event.target.value as ProviderId, tools: [] }
                              : item,
                          ),
                        )
                      }
                    >
                      {providers.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={capability.optional}
                      onChange={(event) =>
                        setCapabilities((items) =>
                          items.map((item) =>
                            item.rowId === capability.rowId
                              ? { ...item, optional: event.target.checked }
                              : item,
                          ),
                        )
                      }
                    />
                    <span>
                      <strong>Optional</strong>
                      <small>Can run without it</small>
                    </span>
                  </label>
                  <button
                    type="button"
                    className="icon-button danger-text"
                    aria-label="Remove capability"
                    onClick={() =>
                      setCapabilities((items) => items.filter((item) => item.rowId !== capability.rowId))
                    }
                  >
                    <X size={16} />
                  </button>
                </div>
                {!registry?.configured && (
                  <p className="registry-warning">
                    <LockKeyhole size={13} /> Configure this provider in MCP_TOOL_REGISTRY_JSON before
                    publishing.
                  </p>
                )}
                <div className="registry-tools">
                  {visibleTools.length ? (
                    visibleTools.map((tool) => {
                      const checked = capability.tools.includes(tool.name);
                      return (
                        <label key={tool.name} data-mode={tool.mode}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={tool.mode === 'blocked' && !checked}
                            onChange={() =>
                              setCapabilities((items) =>
                                items.map((item) =>
                                  item.rowId === capability.rowId
                                    ? {
                                        ...item,
                                        tools: checked
                                          ? item.tools.filter((name) => name !== tool.name)
                                          : [...item.tools, tool.name],
                                      }
                                    : item,
                                ),
                              )
                            }
                          />
                          <span>
                            <strong>{tool.name}</strong>
                            <small>{tool.description || tool.mode}</small>
                          </span>
                          <em>{tool.mode}</em>
                        </label>
                      );
                    })
                  ) : (
                    <p>No tools are registered for this provider.</p>
                  )}
                </div>
              </div>
            );
          })}
          {!capabilities.length && (
            <EmptyMini
              icon={<Link2 size={19} />}
              title="No MCP access"
              text="This employee will run without external integrations."
            />
          )}
        </div>
        <section>
          <span className="editor-step">04</span>
          <div>
            <h3>Private skills</h3>
            <p>Add versioned skill files that the employee needs at runtime.</p>
          </div>
          <button
            type="button"
            className="secondary-button editor-add"
            disabled={skills.length >= 10}
            onClick={() =>
              setSkills((items) => [
                ...items,
                { rowId: editorRowId(), name: '', version: '1.0.0', sha256: '', content: '' },
              ])
            }
          >
            <Plus size={14} /> Add skill
          </button>
        </section>
        <div className="editor-rows">
          {skills.map((skill, index) => (
            <div className="editor-row" key={skill.rowId}>
              <div className="editor-row-head">
                <strong>Skill {index + 1}</strong>
                <button
                  type="button"
                  className="icon-button danger-text"
                  aria-label="Remove skill"
                  onClick={() => setSkills((items) => items.filter((item) => item.rowId !== skill.rowId))}
                >
                  <X size={16} />
                </button>
              </div>
              <div className="form-grid">
                <label>
                  Name
                  <input
                    value={skill.name}
                    maxLength={120}
                    required
                    onChange={(event) =>
                      setSkills((items) =>
                        items.map((item) =>
                          item.rowId === skill.rowId ? { ...item, name: event.target.value } : item,
                        ),
                      )
                    }
                    placeholder="triage-issues"
                  />
                </label>
                <label>
                  Version
                  <input
                    value={skill.version}
                    maxLength={80}
                    required
                    onChange={(event) =>
                      setSkills((items) =>
                        items.map((item) =>
                          item.rowId === skill.rowId ? { ...item, version: event.target.value } : item,
                        ),
                      )
                    }
                  />
                </label>
                <label className="full-field">
                  Skill content
                  <textarea
                    className="code-area"
                    value={skill.content}
                    required
                    onChange={(event) =>
                      setSkills((items) =>
                        items.map((item) =>
                          item.rowId === skill.rowId ? { ...item, content: event.target.value } : item,
                        ),
                      )
                    }
                    spellCheck={false}
                    placeholder="# Skill instructions"
                  />
                </label>
              </div>
            </div>
          ))}
          {!skills.length && (
            <EmptyMini
              icon={<FileText size={19} />}
              title="No private skills"
              text="Add only the instructions this employee needs."
            />
          )}
        </div>
        <section>
          <span className="editor-step">05</span>
          <div>
            <h3>Marketplace gallery</h3>
            <p>Add up to ten images or videos. Customers can view every item.</p>
          </div>
          <button
            type="button"
            className="secondary-button editor-add"
            disabled={media.length >= 10}
            onClick={() =>
              setMedia((items) => [...items, { rowId: editorRowId(), url: '', type: 'image', alt: '' }])
            }
          >
            <Plus size={14} /> Add media
          </button>
        </section>
        <div className="editor-rows">
          {media.map((item, index) => (
            <div className="editor-row media-editor" key={item.rowId}>
              <div className="editor-row-head">
                <strong>Gallery item {index + 1}</strong>
                <button
                  type="button"
                  className="icon-button danger-text"
                  aria-label="Remove media"
                  onClick={() => setMedia((items) => items.filter((entry) => entry.rowId !== item.rowId))}
                >
                  <X size={16} />
                </button>
              </div>
              <div className="form-grid">
                <label>
                  Type
                  <select
                    value={item.type}
                    onChange={(event) =>
                      setMedia((items) =>
                        items.map((entry) =>
                          entry.rowId === item.rowId
                            ? { ...entry, type: event.target.value as 'image' | 'video' }
                            : entry,
                        ),
                      )
                    }
                  >
                    <option value="image">Image</option>
                    <option value="video">Video</option>
                  </select>
                </label>
                <label>
                  {item.type === 'video' ? 'Direct MP4/WebM URL' : 'Image URL'}
                  <input
                    type="url"
                    required
                    value={item.url}
                    onChange={(event) =>
                      setMedia((items) =>
                        items.map((entry) =>
                          entry.rowId === item.rowId ? { ...entry, url: event.target.value } : entry,
                        ),
                      )
                    }
                    placeholder="https://cdn.example.com/preview.jpg"
                  />
                </label>
                <label className="full-field">
                  Accessible description
                  <input
                    required
                    value={item.alt}
                    onChange={(event) =>
                      setMedia((items) =>
                        items.map((entry) =>
                          entry.rowId === item.rowId ? { ...entry, alt: event.target.value } : entry,
                        ),
                      )
                    }
                    placeholder="Describe what this image or video shows"
                  />
                </label>
              </div>
            </div>
          ))}
          {!media.length && (
            <EmptyMini
              icon={<Archive size={19} />}
              title="No gallery media"
              text="The marketplace will use the employee color and icon."
            />
          )}
        </div>
        <div className="editor-footer">
          <div>
            {(formError || skillLimitError) && (
              <p className="editor-error" role="alert">
                {formError || skillLimitError}
              </p>
            )}
            <p>
              <LockKeyhole size={14} />
              Instructions and skills are never returned by public marketplace APIs.
            </p>
          </div>
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={saving || Boolean(skillLimitError)}>
            <Check size={15} />
            {saving ? 'Saving…' : 'Save draft'}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

function SettingsPanel({
  dashboard,
  configured,
  onClose,
  onBootstrap,
  onBudget,
}: {
  dashboard: Dashboard;
  configured: boolean;
  onClose: () => void;
  onBootstrap: (name: string) => void;
  onBudget: (amount: number) => void;
}) {
  const [name, setName] = useState(dashboard.workspace?.name ?? '');
  const [budget, setBudget] = useState(String(dashboard.workspace?.monthlyBudget || 250));
  return (
    <Sheet
      title="Workspace settings"
      subtitle="Identity, budget, and environment status for this workspace."
      onClose={onClose}
    >
      <div className="settings-stack">
        {configured ? (
          <div className="settings-status good">
            <CheckCircle2 size={18} />
            <span>
              <strong>Application connected</strong>
              <small>Clerk and Convex are configured.</small>
            </span>
          </div>
        ) : (
          <div className="settings-status">
            <Cloud size={18} />
            <span>
              <strong>Preview mode</strong>
              <small>Server environment variables are not available yet.</small>
            </span>
          </div>
        )}
        {!dashboard.workspace ? (
          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              onBootstrap(name.trim());
            }}
          >
            <label>
              Workspace name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Acme Operations"
                required
              />
            </label>
            <button className="primary-button full" disabled={!configured}>
              Create workspace
            </button>
          </form>
        ) : dashboard.workspace.role === 'owner' || dashboard.workspace.role === 'admin' ? (
          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              onBudget(Number(budget));
            }}
          >
            <label>
              Monthly OpenAI budget
              <div className="money-input">
                <span>$</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                />
              </div>
              <small>Work pauses before starting a task that would exceed this limit.</small>
            </label>
            <button className="primary-button full">Save budget</button>
          </form>
        ) : (
          <div className="settings-status">
            <LockKeyhole size={18} />
            <span>
              <strong>Budget managed by an administrator</strong>
              <small>Your workspace owner controls the monthly OpenAI limit.</small>
            </span>
          </div>
        )}
        <div id="setup" className="setup-list">
          <span className="eyebrow">SETUP CHECKLIST</span>
          <h3>Before the first real task</h3>
          <ol>
            <li>
              <span>1</span>
              <div>
                <strong>Connect authentication</strong>
                <small>Add the Clerk publishable and secret keys.</small>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <strong>Deploy application data</strong>
                <small>Set the Convex deployment URL and deploy functions.</small>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <strong>Start the worker and gateway</strong>
                <small>Add the OpenAI key and shared service secret on Railway.</small>
              </div>
            </li>
            <li>
              <span>4</span>
              <div>
                <strong>Connect one MCP provider</strong>
                <small>Grant the smallest useful set of tools and resources.</small>
              </div>
            </li>
          </ol>
        </div>
      </div>
    </Sheet>
  );
}

function ProjectPanel({
  project,
  employees,
  configured,
  onClose,
  onSave,
  onArchive,
}: {
  project: Project | null;
  employees: Employee[];
  configured: boolean;
  onClose: () => void;
  onSave: (name: string, brief: string, employeeIds: string[]) => Promise<void>;
  onArchive: (project: Project, archived: boolean) => Promise<void>;
}) {
  const [name, setName] = useState(project?.name ?? '');
  const [brief, setBrief] = useState(project?.brief ?? '');
  const [employeeIds, setEmployeeIds] = useState<string[]>(project?.employeeIds ?? []);
  const [busy, setBusy] = useState(false);
  const archived = Boolean(project?.archivedAt);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !brief.trim() || busy) return;
    setBusy(true);
    await onSave(name.trim(), brief.trim(), employeeIds);
    setBusy(false);
  }

  return (
    <Sheet
      title={project ? `Edit ${project.name}` : 'Create project floor'}
      subtitle="A project floor groups its shared brief, staffing, and your private task queue."
      onClose={onClose}
    >
      <form className="form-stack project-form" onSubmit={save}>
        <label>
          Project name
          <input
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            placeholder="Client research"
            required
          />
        </label>
        <label>
          Project brief
          <textarea
            className="large-textarea"
            value={brief}
            maxLength={5000}
            onChange={(event) => setBrief(event.target.value)}
            placeholder="Describe the mandate, priorities, and standing constraints for this project."
            required
          />
          <small>Shared with your workspace. New tasks receive a copy of this brief.</small>
        </label>
        <fieldset className="staffing-picker">
          <legend>Staff this floor</legend>
          <p>Employees can work on more than one project.</p>
          {employees.length ? (
            <div>
              {employees.map((employee) => {
                const checked = employeeIds.includes(employee.id);
                return (
                  <label key={employee.id} data-checked={checked}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setEmployeeIds((current) =>
                          checked ? current.filter((id) => id !== employee.id) : [...current, employee.id],
                        )
                      }
                    />
                    <Avatar employee={employee} />
                    <span>
                      <strong>{employee.name}</strong>
                      <small>{employee.role}</small>
                    </span>
                    <Check size={15} />
                  </label>
                );
              })}
            </div>
          ) : (
            <div className="staffing-picker-empty">
              <Users size={18} /> Hire an employee before staffing this floor.
            </div>
          )}
        </fieldset>
        <button
          className="primary-button full"
          disabled={!configured || busy || !name.trim() || !brief.trim()}
        >
          {busy ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}
          {project ? 'Save floor' : 'Create floor'}
        </button>
      </form>
      {project && (
        <div className="project-archive-control">
          <div>
            <strong>{archived ? 'Restore this floor' : 'Archive this floor'}</strong>
            <p>
              {archived
                ? 'Restoring returns it to the building directory and task forms.'
                : 'Archived floors stay available for history and can be restored.'}
            </p>
          </div>
          <button
            className="secondary-button"
            disabled={busy || !configured}
            onClick={async () => {
              setBusy(true);
              await onArchive(project, !archived);
              setBusy(false);
            }}
          >
            {archived ? <RotateCcw size={15} /> : <Archive size={15} />}
            {archived ? 'Restore' : 'Archive'}
          </button>
        </div>
      )}
    </Sheet>
  );
}

function NewTaskPanel({
  employees,
  projects,
  defaultEmployee,
  defaultProjectId,
  configured,
  onClose,
  onCreate,
}: {
  employees: Employee[];
  projects: Project[];
  defaultEmployee: string | null;
  defaultProjectId: string | null;
  configured: boolean;
  onClose: () => void;
  onCreate: (employeeId: string, title: string, prompt: string, projectId?: string) => void;
}) {
  const activeProjects = projects.filter((project) => !project.archivedAt);
  const [projectId, setProjectId] = useState(
    defaultProjectId && activeProjects.some((project) => project.id === defaultProjectId)
      ? defaultProjectId
      : '',
  );
  const selectedProject = activeProjects.find((project) => project.id === projectId);
  const ready = employees.filter(
    (employee) =>
      employee.status === 'ready' && (!selectedProject || selectedProject.employeeIds.includes(employee.id)),
  );
  const [employeeId, setEmployeeId] = useState(
    defaultEmployee && ready.some((e) => e.id === defaultEmployee) ? defaultEmployee : (ready[0]?.id ?? ''),
  );
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  useEffect(() => {
    if (!ready.some((employee) => employee.id === employeeId)) setEmployeeId(ready[0]?.id ?? '');
  }, [employeeId, ready]);
  return (
    <Sheet
      title="Assign new work"
      subtitle="Describe the outcome. Your employee will ask for review before sensitive external actions."
      onClose={onClose}
    >
      <form
        className="form-stack task-form"
        onSubmit={(event) => {
          event.preventDefault();
          onCreate(employeeId, title.trim(), prompt.trim(), projectId || undefined);
        }}
      >
        <label>
          Project floor
          <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            <option value="">Lobby · Unassigned</option>
            {activeProjects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <small>{selectedProject ? selectedProject.brief : 'This task will stay in the lobby.'}</small>
        </label>
        <label>
          Employee
          <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} required>
            <option value="" disabled>
              Select an employee
            </option>
            {ready.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.name} · {employee.role}
              </option>
            ))}
          </select>
          {selectedProject && !ready.length && (
            <small>Add a ready employee to this floor before assigning work.</small>
          )}
        </label>
        <label>
          Task title
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Prepare the weekly customer review"
            required
          />
        </label>
        <label>
          What needs to be done?
          <textarea
            className="large-textarea"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Include the outcome, relevant context, and any limits the employee should respect."
            required
          />
        </label>
        <div className="task-safety">
          <ShieldCheck size={16} />
          <span>External writes still follow workspace permissions and action review rules.</span>
        </div>
        <button className="primary-button full" disabled={!configured || !employeeId || !ready.length}>
          {employees.length ? 'Start task' : 'Hire an employee first'}
          <ArrowRight size={16} />
        </button>
      </form>
    </Sheet>
  );
}

function Sheet({
  title,
  subtitle,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), video[controls], [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!panel.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  return (
    <div className="sheet-layer">
      <button className="sheet-scrim" tabIndex={-1} aria-label="Close panel" onClick={onClose} />
      <aside
        ref={panelRef}
        className={`sheet ${wide ? 'sheet-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <div>
            <span className="eyebrow">ASTRA HQ</span>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          <button ref={closeRef} className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <div className="sheet-body">{children}</div>
      </aside>
    </div>
  );
}

function EmptySection({
  icon,
  title,
  text,
  action,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-section card">
      <span>{icon}</span>
      <h2>{title}</h2>
      <p>{text}</p>
      {action}
    </div>
  );
}
function EmptyPane({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="empty-pane">
      <span>{icon}</span>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function EmptyMini({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="empty-mini">
      <span>{icon}</span>
      <div>
        <strong>{title}</strong>
        <p>{text}</p>
      </div>
    </div>
  );
}
function Avatar({ employee, large = false }: { employee: Employee; large?: boolean }) {
  return (
    <span
      className={`avatar employee-avatar ${large ? 'avatar-large' : ''}`}
      style={{ '--employee-color': employee.color } as CSSProperties}
    >
      <Bot size={large ? 22 : 16} />
    </span>
  );
}
function StatusMark({ status }: { status: Task['status'] }) {
  return (
    <span className={`status-mark status-${status}`}>
      {status === 'completed' ? (
        <Check size={12} />
      ) : status === 'awaiting_approval' ? (
        <ShieldCheck size={12} />
      ) : status === 'failed' || status === 'cancelled' ? (
        <X size={12} />
      ) : status === 'uncertain' ? (
        <MoreHorizontal size={12} />
      ) : (
        <i />
      )}
    </span>
  );
}
function ProviderMark({ provider, small = false }: { provider: ProviderId; small?: boolean }) {
  const match = providers.find((item) => item.id === provider);
  return (
    <span
      className={`provider-mark ${small ? 'provider-small' : ''}`}
      style={{ '--provider-color': match?.color || '#607565' } as CSSProperties}
    >
      {match?.short || provider.slice(0, 2).toUpperCase()}
    </span>
  );
}
function ProviderLogo({ provider }: { provider: (typeof providers)[number] }) {
  if (provider.id === 'github')
    return (
      <span className="provider-logo" style={{ background: provider.color }}>
        <Github size={22} />
      </span>
    );
  if (provider.id === 'google-workspace')
    return (
      <span className="provider-logo google-logo">
        <Mail size={21} />
      </span>
    );
  if (provider.id === 'slack')
    return (
      <span className="provider-logo" style={{ background: provider.color }}>
        <MessageSquareText size={21} />
      </span>
    );
  if (provider.id === 'salesforce')
    return (
      <span className="provider-logo" style={{ background: provider.color }}>
        <Cloud size={22} />
      </span>
    );
  if (provider.id === 'linear')
    return (
      <span className="provider-logo" style={{ background: provider.color }}>
        <Command size={21} />
      </span>
    );
  return (
    <span className="provider-logo" style={{ background: provider.color }}>
      <Building2 size={21} />
    </span>
  );
}
function SignInScreen() {
  return (
    <div className="signin-screen">
      <div className="signin-card card">
        <span className="brand-glyph large">
          <Sparkles size={25} />
        </span>
        <span className="eyebrow">ASTRA HQ</span>
        <h1>Come into the office</h1>
        <p>Sign in to see your employees, connected work, and action reviews.</p>
        <SignInButton mode="modal">
          <button className="primary-button full">
            Sign in <ArrowRight size={16} />
          </button>
        </SignInButton>
        <small>
          <ShieldCheck size={13} />
          Workspace access is checked on every request.
        </small>
      </div>
    </div>
  );
}
function CenteredLoader({ label }: { label: string }) {
  return (
    <div className="centered-loader">
      <span className="brand-glyph">
        <Sparkles size={19} />
      </span>
      <LoaderCircle className="spin" size={20} />
      <p>{label}</p>
    </div>
  );
}

function providerName(provider: ProviderId) {
  return providers.find((entry) => entry.id === provider)?.name ?? provider;
}
function modelName(model: ModelId) {
  return { 'gpt-5.6-luna': 'Luna', 'gpt-5.6-terra': 'Terra', 'gpt-5.6-sol': 'Sol', 'gpt-6-astra': 'Astra' }[
    model
  ];
}
function statusLabel(status: Task['status']) {
  return status.replace('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}
function correctionLabel(kind: ActionProposal['correction']) {
  return {
    supported: 'Correction supported.',
    partial: 'Partial correction only.',
    manual: 'Manual correction.',
    irreversible: 'Cannot be reversed.',
    unknown: 'Correction is unverified.',
  }[kind];
}
function timeGreeting() {
  const hour = new Date().getHours();
  return hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
}
function relativeTime(timestamp: number) {
  const seconds = Math.max(1, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 7
    ? `${days}d ago`
    : new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function safeJson(value: string) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}
function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function safeHttpsUrl(value: unknown) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}
function lines(value: string) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}
function missingRequiredCapabilities(listing: Listing, connections: Connection[]) {
  return [
    ...new Set(
      listing.capabilities
        .filter((capability) => {
          if (capability.optional) return false;
          return !connections.some(
            (connection) =>
              connection.provider === capability.provider &&
              connection.status === 'connected' &&
              capability.tools.every((tool) => connection.allowedTools.includes(tool)),
          );
        })
        .map((capability) => capability.provider),
    ),
  ];
}
function draftPublishIssues(draft: EditorDraft, registry: AdminToolRegistry) {
  const issues: string[] = [];
  if (!draft.name.trim() || !draft.role.trim() || !draft.description.trim() || !draft.category.trim())
    issues.push('Complete the public listing.');
  if (!draft.instructions.trim()) issues.push('Add private instructions.');
  if (new Set(draft.capabilities.map((item) => item.provider)).size !== draft.capabilities.length)
    issues.push('Use one capability row per MCP provider.');
  for (const capability of draft.capabilities) {
    const providerRegistry = registry.find((item) => item.provider === capability.provider);
    if (!providerRegistry?.configured) {
      issues.push(`Configure ${providerName(capability.provider)} in the tool registry.`);
      continue;
    }
    if (!capability.tools.length)
      issues.push(`Choose at least one ${providerName(capability.provider)} tool.`);
    const known = new Set(
      providerRegistry.tools.filter((tool) => tool.mode !== 'blocked').map((tool) => tool.name),
    );
    if (capability.tools.some((tool) => !known.has(tool)))
      issues.push(`Review unavailable ${providerName(capability.provider)} tools.`);
  }
  if (draft.skills.some((skill) => !skill.name.trim() || !skill.version.trim() || !skill.content.trim()))
    issues.push('Complete every private skill.');
  if (draft.media.some((item) => !item.url.trim() || !item.alt.trim()))
    issues.push('Complete every gallery item.');
  return [...new Set(issues)];
}
function editorRowId() {
  return crypto.randomUUID();
}
async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
