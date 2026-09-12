'use client';

import { useEffect, useState } from 'react';
import type { EditorDraft } from '../admin/draft-issues';
import { FloorPanel } from '../floors/floor-panel';
import type { Actions } from './actions';
import { IncidentStrip } from './incident-strip';
import { nav, pageTitle, type Page } from './nav';
import { NewTaskPanel } from './new-task-panel';
import { SetupBanner, Toast } from './notices';
import { PageContent } from './page-content';
import { ReviewBar } from './review-bar';
import { SettingsPanel } from './settings-panel';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';
import type {
  ActionProposal,
  Dashboard,
  Listing,
  Floor,
  ProviderConfig,
  ProviderReadiness,
  RegistryTool,
} from '@/lib/contracts';
import './app.css';

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
  const [floorEditor, setFloorEditor] = useState<Floor | 'new' | null>(null);
  const [selectedFloorId, setSelectedFloorId] = useState<string | null>(null);
  const [taskFloorId, setTaskFloorId] = useState<string | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [selectedMeeting, setSelectedMeeting] = useState<string | null>(null);
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

  function openNewTask(floorId: string | null = null, employeeId: string | null = null) {
    setTaskFloorId(floorId);
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
          onSettings={() => setSettingsOpen(true)}
          onReview={(taskId) => {
            setSelectedTask(taskId);
            go('tasks');
          }}
          notificationActions={actions}
          onOpen={go}
        />

        <ReviewBar
          proposals={dashboard.proposals}
          onDecide={(id, approved) =>
            void run(() => actions.decide(id, approved), approved ? 'Action approved' : 'Action rejected')
          }
          onOpenTask={(taskId) => {
            setSelectedTask(taskId);
            go('tasks');
          }}
        />

        <IncidentStrip dashboard={dashboard} actions={actions} run={run} go={go} />

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
            selectedFloorId={selectedFloorId}
            onSelectFloor={setSelectedFloorId}
            selectedEmployee={selectedEmployee}
            onSelectEmployee={setSelectedEmployee}
            selectedTask={selectedTask}
            onSelectTask={setSelectedTask}
            selectedProject={selectedProject}
            onSelectProject={setSelectedProject}
            selectedMeeting={selectedMeeting}
            onSelectMeeting={setSelectedMeeting}
            onNewTask={openNewTask}
            onFloorEditor={setFloorEditor}
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
          canManageWorkspace={canManageWorkspace}
          actions={actions}
          run={run}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {newTaskOpen && (
        <NewTaskPanel
          employees={dashboard.employees}
          floors={dashboard.floors}
          defaultEmployee={selectedEmployee}
          defaultFloorId={taskFloorId}
          configured={configured}
          onClose={() => setNewTaskOpen(false)}
          onCreate={async (employeeId, title, prompt, floorId) => {
            const created = await run(
              () => actions.createTask(employeeId, prompt, title, floorId),
              'Task started',
            );
            if (created) {
              setNewTaskOpen(false);
              go('tasks');
            }
          }}
        />
      )}
      {floorEditor && (
        <FloorPanel
          floor={floorEditor === 'new' ? null : floorEditor}
          employees={dashboard.employees}
          configured={configured && Boolean(workspace)}
          onClose={() => setFloorEditor(null)}
          onSave={async (name, brief, employeeIds) => {
            let createdFloorId: string | undefined;
            const saved = await run(
              async () => {
                if (floorEditor === 'new') {
                  createdFloorId = (await actions.createFloor(name, brief, employeeIds))?.floorId;
                } else {
                  await actions.updateFloor(floorEditor.id, name, brief, employeeIds);
                }
              },
              floorEditor === 'new' ? 'Floor created' : 'Floor updated',
            );
            if (saved) {
              if (createdFloorId) setSelectedFloorId(createdFloorId);
              setFloorEditor(null);
            }
          }}
          onArchive={async (floor, archived) => {
            const saved = await run(
              () => actions.setFloorArchived(floor.id, archived),
              archived ? 'Floor archived' : 'Floor restored',
            );
            if (saved) {
              if (archived) setSelectedFloorId(null);
              setFloorEditor(null);
            }
          }}
        />
      )}
      {notice && <Toast text={notice} onDismiss={() => setNotice(null)} />}
    </div>
  );
}
