'use client';

import type { Dashboard, Listing, Project, ProviderReadiness, RegistryTool } from '@/lib/contracts';
import type { EditorDraft } from '../admin/draft-issues';
import { MarketplaceStudioPage } from '../admin/marketplace-studio';
import { ActivityPage } from '../activity/activity-page';
import { EmployeesPage } from '../employees/employees-page';
import { FilesPage } from '../files/files-page';
import { FloorPage } from '../floors/floor-page';
import { InboxPage } from '../inbox/inbox-page';
import { IntegrationsPage } from '../integrations/integrations-page';
import { MarketplacePage } from '../marketplace/marketplace-page';
import { TasksPage } from '../tasks/tasks-page';
import type { Actions } from './actions';
import type { Page } from './nav';

export type PageContentProps = {
  page: Page;
  dashboard: Dashboard;
  listings: Listing[];
  drafts: EditorDraft[];
  registryTools: RegistryTool[];
  readiness: ProviderReadiness[];
  configured: boolean;
  canManageWorkspace: boolean;
  actions: Actions;
  run: (work: () => Promise<unknown>, success: string) => Promise<boolean>;
  go: (page: Page) => void;
  onNotice: (text: string) => void;
  selectedProjectId: string | null;
  onSelectProject: (id: string | null) => void;
  selectedEmployee: string | null;
  onSelectEmployee: (id: string | null) => void;
  selectedTask: string | null;
  onSelectTask: (id: string | null) => void;
  onNewTask: (projectId?: string | null, employeeId?: string | null) => void;
  onProjectEditor: (project: Project | 'new') => void;
  onCorrect: (proposalId: string) => void;
};

export function PageContent(props: PageContentProps) {
  const { page, dashboard, actions, run, go } = props;

  if (page === 'office')
    return (
      <FloorPage
        dashboard={dashboard}
        configured={props.configured}
        onPage={go}
        onEmployee={(id) => {
          props.onSelectEmployee(id);
          go('employees');
        }}
        onTask={(id) => {
          props.onSelectTask(id);
          go('tasks');
        }}
        selectedProjectId={props.selectedProjectId}
        onSelectProject={props.onSelectProject}
        onNewProject={() => props.onProjectEditor('new')}
        onEditProject={props.onProjectEditor}
        onNewTask={(projectId) => props.onNewTask(projectId)}
      />
    );

  if (page === 'inbox')
    return (
      <InboxPage
        items={dashboard.inbox}
        employees={dashboard.employees}
        projects={dashboard.projects}
        configured={props.configured}
        onRead={(id) => run(() => actions.markRead(id), 'Marked as read')}
        onAssign={(itemId, employeeId, projectId) =>
          run(() => actions.assign(itemId, employeeId, projectId), 'Assigned to your employee')
        }
      />
    );

  if (page === 'employees')
    return (
      <EmployeesPage
        employees={dashboard.employees}
        connections={dashboard.connections}
        selectedId={props.selectedEmployee}
        onSelect={props.onSelectEmployee}
        onMarketplace={() => go('marketplace')}
        onTask={(id) => props.onNewTask(null, id)}
      />
    );

  if (page === 'tasks')
    return (
      <TasksPage
        tasks={dashboard.tasks}
        projects={dashboard.projects}
        proposals={dashboard.proposals}
        selectedId={props.selectedTask}
        configured={props.configured}
        onSelect={props.onSelectTask}
        onNew={() => props.onNewTask()}
        onSend={(taskId, text) => run(() => actions.sendMessage(taskId, text), 'Message sent')}
        onCancel={(taskId) => run(() => actions.cancelTask(taskId), 'Task cancelled')}
        onDecide={(id, approved) =>
          run(() => actions.decide(id, approved), approved ? 'Action approved' : 'Action rejected')
        }
        onCorrect={props.onCorrect}
        employees={dashboard.employees}
        onSetVisibility={(taskId, visibility) =>
          run(() => actions.setTaskVisibility(taskId, visibility), 'Visibility updated')
        }
        onRequestHandoff={(projectId, toEmployeeId, brief, taskId) =>
          run(() => actions.requestHandoff(projectId, toEmployeeId, brief, taskId), 'Handoff requested')
        }
      />
    );

  if (page === 'files') return <FilesPage artifacts={dashboard.artifacts} onTasks={() => go('tasks')} />;

  if (page === 'activity') return <ActivityPage events={dashboard.events} />;

  if (page === 'marketplace')
    return (
      <MarketplacePage
        listings={props.listings}
        employees={dashboard.employees}
        connections={dashboard.connections}
        configured={props.configured}
        isAdmin={dashboard.isPlatformAdmin}
        onHire={(id) => run(() => actions.hire(id), 'Employee added to your workspace')}
        onAdmin={() => go('admin')}
      />
    );

  if (page === 'integrations')
    return (
      <IntegrationsPage
        connections={dashboard.connections}
        configured={props.configured}
        readiness={props.readiness}
        canManage={props.canManageWorkspace || dashboard.isPlatformAdmin}
        onDisconnect={(id) => run(() => actions.disconnect(id), 'Integration disconnected')}
        onUpdateAccess={(id, tools, scope, inbox) =>
          run(() => actions.updateConnectionAccess(id, tools, scope, inbox), 'Integration access updated')
        }
        onSetSharing={(id, visibility, subjects) =>
          run(() => actions.setConnectionSharing(id, visibility, subjects), 'Sharing updated')
        }
        onNotice={props.onNotice}
      />
    );

  if (page === 'admin' && dashboard.isPlatformAdmin)
    return (
      <MarketplaceStudioPage
        drafts={props.drafts}
        listings={props.listings}
        registryTools={props.registryTools}
        onSave={(draft) => run(() => actions.saveDraft(draft), 'Draft saved')}
        onPublish={(id) => run(() => actions.publish(id), 'Employee published')}
        onRetire={(id) => run(() => actions.retire(id), 'Version retired')}
      />
    );

  return null;
}
