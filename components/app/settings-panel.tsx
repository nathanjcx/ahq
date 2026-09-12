'use client';

import { useState } from 'react';
import { Sheet } from '../shared/sheet';
import { SkeletonList } from '../shared/skeleton';
import { useUiQuery } from '../shared/use-ui-query';
import type { Actions } from './actions';
import { PlanSection } from './settings/plan-section';
import { PoliciesSection } from './settings/policies-section';
import { ScheduleSection } from './settings/schedule-section';
import { formId, sections, type SectionId, type SectionProps } from './settings/sections';
import { StandardsSection } from './settings/standards-section';
import { WorkspaceSection } from './settings/workspace-section';
import type { Dashboard } from '@/lib/contracts';
import { uiApi } from '@/lib/ui-api';

/**
 * Everything a workspace decides about itself, in five sections. Settings are stored whole, so each
 * section saves the object it was given with its own fields changed.
 */
export function SettingsPanel({
  dashboard,
  configured,
  canManageWorkspace,
  actions,
  run,
  onClose,
}: {
  dashboard: Dashboard;
  configured: boolean;
  canManageWorkspace: boolean;
  actions: Actions;
  run: (work: () => Promise<unknown>, success: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const workspace = dashboard.workspace;
  const [active, setActive] = useState<SectionId>('workspace');
  const settings = useUiQuery(uiApi.workspaceSettings, workspace ? {} : 'skip');

  const section = sections.find((entry) => entry.id === active) ?? sections[0];
  const props: SectionProps | null = settings
    ? {
        settings,
        canManage: canManageWorkspace,
        save: (next, success) => run(() => actions.saveWorkspaceSettings(next), success),
      }
    : null;

  return (
    <Sheet
      wide
      title="Workspace settings"
      subtitle="The hours the tower keeps, what it may spend, who decides what, and the standard it is held to."
      onClose={onClose}
      footer={
        !workspace ? (
          <button className="primary-button full" type="submit" form={formId('workspace')} disabled={!configured}>
            Create workspace
          </button>
        ) : canManageWorkspace && (active === 'workspace' || props) ? (
          <button className="primary-button full" type="submit" form={formId(active)}>
            {section.save}
          </button>
        ) : undefined
      }
    >
      <div className="settings-shell">
        <nav className="settings-sections" aria-label="Settings sections">
          {sections.map((entry) => (
            <button
              key={entry.id}
              data-active={entry.id === active}
              aria-current={entry.id === active}
              onClick={() => setActive(entry.id)}
            >
              <strong>{entry.label}</strong>
              <small>{entry.hint}</small>
            </button>
          ))}
        </nav>
        <div className="settings-section">
          <h3>{section.label}</h3>
          {active === 'workspace' ? (
            <WorkspaceSection
              dashboard={dashboard}
              configured={configured}
              canManage={canManageWorkspace}
              onBootstrap={(name) => void run(() => actions.bootstrap(name), 'Workspace created')}
              onTokenCap={(cap) => void run(() => actions.setTokenCap(cap), 'Token cap updated')}
            />
          ) : !props ? (
            <SkeletonList kind="entry" rows={4} label="Loading settings" />
          ) : active === 'schedule' ? (
            <ScheduleSection key={props.settings.updatedAt} {...props} />
          ) : active === 'plan' ? (
            <PlanSection key={props.settings.updatedAt} {...props} />
          ) : active === 'policies' ? (
            <PoliciesSection key={props.settings.updatedAt} {...props} />
          ) : (
            <StandardsSection key={props.settings.updatedAt} {...props} />
          )}
        </div>
      </div>
    </Sheet>
  );
}
