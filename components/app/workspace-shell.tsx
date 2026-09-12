'use client';

import { useEffect, useState } from 'react';
import type {
  ActionProposal,
  Dashboard,
  Listing,
  Project,
  ProviderConfig,
  ProviderReadiness,
  RegistryTool,
} from '@/lib/contracts';
import type { EditorDraft } from '../admin/draft-issues';
import { ProjectPanel } from '../floors/project-panel';
import type { Actions } from './actions';
import { nav, pageTitle, type Page } from './nav';
import { NewTaskPanel } from './new-task-panel';
import { SetupBanner, Toast } from './notices';
import { PageContent } from './page-content';
import { SettingsPanel } from './settings-panel';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';

export function WorkspaceShell({
  configured,
  readiness,
  dashboard,
  listings,
  drafts,
  registryTools,
  providerConfigs,
  actions,
}: {
  configured: boolean;
  readiness: ProviderReadiness[];
  dashboard: Dashboard;
  listings: Listing[];
  drafts: EditorDraft[];
  registryTools: RegistryTool[];
  providerConfigs?: ProviderConfig[];
  actions: Actions;
}) {
  const [page, setPage] = useState<Page>('office');
  useEffect(() => {
    const sync = () => {
      const value = window.location.hash.slice(1);
      if (nav.some((item) => item.id === value) || value === 'admin' || value === 'operations')
        setPage(value as Page);
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
      <Sidebar
        dashboard={dashboard}
        configured={configured}
        page={page}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onNavigate={go}
        onSettings={() => setSettingsOpen(true)}
      />

      {sidebarOpen && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <main className="main">
        <Topbar
          title={pageTitle(page)}
          configured={configured}
          proposals={dashboard.proposals}
          canCreateTask={Boolean(workspace) && hasReadyEmployee}
          onOpenNavigation={() => setSidebarOpen(true)}
          onNewTask={() => openNewTask()}
          onReview={(taskId) => {
            setSelectedTask(taskId);
            go('tasks');
          }}
        />

        {!configured && <SetupBanner onSetup={() => setSettingsOpen(true)} />}
        <div className="page-wrap">
          <PageContent
            page={page}
            dashboard={dashboard}
            listings={listings}
            drafts={drafts}
            registryTools={registryTools}
            providerConfigs={providerConfigs}
            readiness={readiness}
            configured={configured}
            canManageWorkspace={canManageWorkspace}
            actions={actions}
            run={run}
            go={go}
            onNotice={setNotice}
            selectedProjectId={selectedProjectId}
            onSelectProject={setSelectedProjectId}
            selectedEmployee={selectedEmployee}
            onSelectEmployee={setSelectedEmployee}
            selectedTask={selectedTask}
            onSelectTask={setSelectedTask}
            onNewTask={openNewTask}
            onProjectEditor={setProjectEditor}
            onCorrect={(id) => {
              const proposal = dashboard.proposals.find((item) => item.id === id);
              if (proposal) void requestCorrection(proposal);
            }}
          />
        </div>
      </main>

      {settingsOpen && (
        <SettingsPanel
          dashboard={dashboard}
          configured={configured}
          onClose={() => setSettingsOpen(false)}
          onBootstrap={(name) => run(() => actions.bootstrap(name), 'Workspace created')}
          onTokenCap={(cap) => run(() => actions.setTokenCap(cap), 'Token cap updated')}
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
      {notice && <Toast text={notice} onDismiss={() => setNotice(null)} />}
    </div>
  );
}
