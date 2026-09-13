'use client';

import { ActivityPage } from '../activity/activity-page';
import type { EditorDraft } from '../admin/draft-issues';
import { MarketplaceStudioPage } from '../admin/marketplace-studio';
import { OperationsPage } from '../admin/operations-page';
import { AuditPage } from '../audit/audit-page';
import { CalendarPage } from '../calendar/calendar-page';
import { EmployeesPage } from '../employees/employees-page';
import { FilesPage } from '../files/files-page';
import { FloorPage } from '../floors/floor-page';
import { InboxPage } from '../inbox/inbox-page';
import { IntegrationsPage } from '../integrations/integrations-page';
import { MarketplacePage } from '../marketplace/marketplace-page';
import { ProjectsPage } from '../projects/projects-page';
import { RecordsPage } from '../records/records-page';
import { TriagePage } from '../triage/triage-page';
import { WorkPage } from '../work/work-page';
import type { Page } from './nav';
import type { PageProps } from './page-props';
import type { Listing, Floor, ProviderConfig, ProviderReadiness, RegistryTool } from '@/lib/contracts';

export type PageContentProps = PageProps & {
  page: Page;
  tab?: string;
  listings: Listing[];
  drafts: EditorDraft[];
  registryTools: RegistryTool[];
  providerConfigs?: ProviderConfig[];
  readiness: ProviderReadiness[];
  onFloorEditor: (floor: Floor | 'new') => void;
  onCorrect: (proposalId: string) => void;
};

export function PageContent(props: PageContentProps) {
  const { page, tab, dashboard, actions, run, go } = props;
  const is = (target: Page, name?: string) => page === target && (!name || tab === name);

  if (is('office'))
    return (
      <FloorPage
        dashboard={dashboard}
        configured={props.configured}
        actions={actions}
        run={run}
        onPage={go}
        onEmployee={(id) => {
          props.onSelectEmployee(id);
          go('employees');
        }}
        onTask={(id) => {
          props.onSelectTask(id);
          go('tasks');
        }}
        selectedFloorId={props.selectedFloorId}
        onSelectFloor={props.onSelectFloor}
        onNewFloor={() => props.onFloorEditor('new')}
        onEditFloor={props.onFloorEditor}
        onNewTask={props.onNewTask}
      />
    );

  if (is('plan', 'projects')) return <ProjectsPage {...props} />;
  if (is('plan', 'calendar')) return <CalendarPage {...props} />;
  if (is('records', 'memory')) return <RecordsPage {...props} />;
  if (is('records', 'audit')) return <AuditPage {...props} />;
  if (is('work', 'incidents')) return <TriagePage {...props} />;

  if (is('work', 'inbox'))
    return (
      <InboxPage
        items={dashboard.inbox}
        employees={dashboard.employees}
        floors={dashboard.floors}
        configured={props.configured}
        onRead={(id) => run(() => actions.markRead(id), 'Marked as read')}
        onAssign={(itemId, employeeId, floorId) =>
          run(() => actions.assign(itemId, employeeId, floorId), 'Assigned to your employee')
        }
      />
    );

  if (is('team', 'employees')) return <EmployeesPage {...props} />;

  if (is('work', 'threads')) return <WorkPage {...props} />;

  if (is('records', 'files'))
    return <FilesPage artifacts={dashboard.artifacts} onTasks={() => go('tasks')} />;

  if (is('records', 'activity')) return <ActivityPage events={dashboard.events} />;

  if (is('team', 'hire')) return <MarketplacePage {...props} />;

  if (is('integrations'))
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

  if (is('admin', 'marketplace') && dashboard.isPlatformAdmin)
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

  if (is('admin', 'operations') && dashboard.isPlatformAdmin)
    return (
      <OperationsPage
        configs={props.providerConfigs ?? []}
        registryTools={props.registryTools}
        readiness={props.readiness}
        connections={dashboard.connections}
        configured={props.configured}
        onSetEnabledUrls={(provider, urls) =>
          run(() => actions.setEnabledUrls(provider, urls), 'Enabled servers updated')
        }
        onSaveTool={(tool) => run(() => actions.saveRegistryTool(tool), 'Tool saved')}
        onDeleteTool={(provider, name) =>
          run(() => actions.deleteRegistryTool(provider, name), 'Tool removed from the registry')
        }
        onImportTools={async (connectionId) =>
          (await actions.importDiscoveredTools(connectionId))?.imported ?? null
        }
        onNotice={props.onNotice}
      />
    );

  return null;
}
