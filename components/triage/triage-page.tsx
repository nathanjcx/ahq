'use client';

import { ArrowUpRight, FileText, Siren } from 'lucide-react';
import { useState } from 'react';
import type { PageProps } from '../app/page-props';
import { PostText } from '../shared/channel-feed';
import { EmptyPane, EmptySection } from '../shared/empty';
import { MasterDetail, useMasterDetail } from '../shared/master-detail';
import { PageIntro } from '../shared/page-intro';
import { SkeletonList } from '../shared/skeleton';
import { relativeTime } from '../shared/time';
import { useUiQuery } from '../shared/use-ui-query';
import { AlertDetail } from './alert-detail';
import { TriageIntake } from './triage-intake';
import { alertStage, pagingSentence } from './triage-labels';
import type { Alert } from '@/lib/contracts';
import { uiApi } from '@/lib/ui-api';
import './triage.css';

type Tab = 'alerts' | 'reports' | 'intake';

const TABS: { id: Tab; label: string }[] = [
  { id: 'alerts', label: 'Alerts' },
  { id: 'reports', label: 'Incident reports' },
  { id: 'intake', label: 'Intake' },
];

/** The reserved Triage floor's page: what is broken, what was done about it, and how alerts get in. */
export function TriagePage({ dashboard, actions, configured, run, go, onSelectTask }: PageProps) {
  const [tab, setTab] = useState<Tab>('alerts');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { open, openDetail, closeDetail } = useMasterDetail();
  const hasTriageFloor = dashboard.employees.some((employee) => employee.kind === 'triage');

  const openTask = (taskId: string) => {
    onSelectTask(taskId);
    go('tasks');
  };

  return (
    <div className="triage-page">
      <PageIntro
        eyebrow="TRIAGE FLOOR"
        title="Triage"
        description="Incidents preempt working hours here: reproduce, fix under the allow-list, post the post-mortem, close."
        action={
          !hasTriageFloor && configured ? (
            <button
              className="primary-button"
              onClick={() => void run(() => actions.ensureTriageFloor(), 'Triage floor staffed')}
            >
              Staff the Triage floor
            </button>
          ) : undefined
        }
      />

      <div className="triage-tabs segmented" aria-label="Triage sections">
        {TABS.map((item) => (
          <button
            key={item.id}
            aria-pressed={tab === item.id}
            data-active={tab === item.id}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {!configured ? (
        <EmptySection
          icon={<Siren size={20} />}
          title="Triage needs a workspace"
          text="Connect your workspace and the Triage floor takes alerts from GitHub, a signed prober, and classified mail."
        />
      ) : tab === 'alerts' ? (
        <AlertsTab
          floors={dashboard.floors}
          selectedId={selectedId}
          open={open}
          onSelect={(id) => {
            setSelectedId(id);
            openDetail();
          }}
          onBack={closeDetail}
          onAcknowledge={(id) => void run(() => actions.acknowledgeAlert(id), 'Incident acknowledged')}
          onResolve={(id) => void run(() => actions.closeAlert(id), 'Incident resolved')}
          onDismiss={(id) => void run(() => actions.dismissAlert(id), 'Alert dismissed')}
          onAssignFloors={(id, floorIds) =>
            void run(() => actions.assignAlertFloors(id, floorIds), 'Affected floors updated')
          }
          onTask={openTask}
        />
      ) : tab === 'reports' ? (
        <ReportsTab onTask={openTask} />
      ) : (
        <TriageIntake />
      )}
    </div>
  );
}

function AlertsTab({
  floors,
  selectedId,
  open,
  onSelect,
  onBack,
  onAcknowledge,
  onResolve,
  onDismiss,
  onAssignFloors,
  onTask,
}: {
  floors: PageProps['dashboard']['floors'];
  selectedId: string | null;
  open: boolean;
  onSelect: (id: string) => void;
  onBack: () => void;
  onAcknowledge: (id: string) => void;
  onResolve: (id: string) => void;
  onDismiss: (id: string) => void;
  onAssignFloors: (id: string, floorIds: string[]) => void;
  onTask: (taskId: string) => void;
}) {
  const alerts = useUiQuery(uiApi.alerts, {});
  if (alerts === undefined) return <SkeletonList kind="entry" rows={5} label="Loading alerts" />;
  if (!alerts.length)
    return (
      <EmptySection
        icon={<Siren size={20} />}
        title="Nothing is on fire"
        text="Alerts from GitHub, a signed prober, or classified mail land here. The Intake tab has the setup."
      />
    );

  const selected = alerts.find((alert) => alert.id === selectedId) ?? alerts[0];
  return (
    <MasterDetail
      className="alert-layout card"
      open={open}
      backLabel="Alerts"
      onBack={onBack}
      list={
        <div className="alert-list">
          {alerts.map((alert) => (
            <AlertRow
              key={alert.id}
              alert={alert}
              selected={alert.id === selected.id}
              onSelect={() => onSelect(alert.id)}
            />
          ))}
        </div>
      }
      detail={
        <AlertDetail
          alert={selected}
          floors={floors}
          canAct
          onAcknowledge={() => onAcknowledge(selected.id)}
          onResolve={() => onResolve(selected.id)}
          onDismiss={() => onDismiss(selected.id)}
          onAssignFloors={(floorIds) => onAssignFloors(selected.id, floorIds)}
          onTask={onTask}
        />
      }
    />
  );
}

function AlertRow({
  alert,
  selected,
  onSelect,
}: {
  alert: Alert;
  selected: boolean;
  onSelect: () => void;
}) {
  const stage = alertStage(alert);
  const paging = pagingSentence(alert.paging);
  return (
    <button className="alert-row" aria-current={selected} onClick={onSelect}>
      <span className="severity-dot" data-severity={alert.severity} aria-label={alert.severity} />
      <span className="alert-row-body">
        <strong>{alert.title}</strong>
        <small>
          {alert.source} · {relativeTime(alert.updatedAt)}
          {alert.occurrences > 1 && ` · ×${alert.occurrences}`}
        </small>
        {paging && <em>{paging}</em>}
      </span>
      <span className="alert-stage" data-stage={stage.id}>
        {stage.label}
      </span>
    </button>
  );
}

function ReportsTab({ onTask }: { onTask: (taskId: string) => void }) {
  const reports = useUiQuery(uiApi.incidentReports, {});
  if (reports === undefined) return <SkeletonList kind="post" rows={3} label="Loading incident reports" />;
  if (!reports.length)
    return (
      <EmptyPane
        icon={<FileText size={19} />}
        title="No incident reports yet"
        text="Every fix ends in a post-mortem: cause, fix, prevention, and the regression test. A fix made without permission carries a full incident report."
      />
    );
  return (
    <div className="incident-reports">
      {reports.map((report) => (
        <article
          key={report.id}
          className="card incident-report"
          data-emergency={report.emergency}
          data-missing={report.missing}
        >
          <header>
            {report.severity && (
              <span className="severity-pill" data-severity={report.severity}>
                {report.severity}
              </span>
            )}
            <strong>{report.alertTitle ?? 'Incident'}</strong>
            {report.emergency && <span className="emergency-pill">Acted without permission</span>}
            {report.missing && <span className="emergency-pill">No report filed</span>}
            <small>
              {report.authorName} · {relativeTime(report.createdAt)}
            </small>
          </header>
          <PostText text={report.text} />
          {report.taskId && (
            <button className="text-button" onClick={() => onTask(report.taskId ?? '')}>
              Open the run <ArrowUpRight size={13} />
            </button>
          )}
        </article>
      ))}
    </div>
  );
}
