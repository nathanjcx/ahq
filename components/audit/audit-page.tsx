'use client';

import { ClipboardCheck, ShieldAlert, Siren } from 'lucide-react';
import { useState } from 'react';
import type { PageProps } from '../app/page-props';
import { EmptyPane, EmptySection } from '../shared/empty';
import { MasterDetail, useMasterDetail } from '../shared/master-detail';
import { PageIntro } from '../shared/page-intro';
import { useUiQuery } from '../shared/use-ui-query';
import { AuditDocument } from './audit-document';
import { isOutstanding, severityLabels } from './finding-card';
import type { AuditFinding, FindingStatus } from '@/lib/contracts';
import { pluralize } from '@/lib/text';
import { uiApi } from '@/lib/ui-api';
import './audit.css';

const statusFilters: { value: FindingStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'addressed', label: 'Addressed' },
  { value: 'verified', label: 'Verified' },
  { value: 'escalated', label: 'Escalated' },
];

/** A readable night: "Monday, 16 March". The audit date is the working day it covers. */
function nightLabel(date: string) {
  const at = Date.parse(`${date}T12:00:00Z`);
  if (Number.isNaN(at)) return date;
  return new Date(at).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}

export function AuditPage({ dashboard, actions, canManageWorkspace, run, onSelectTask, go }: PageProps) {
  const [floorFilter, setFloorFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<FindingStatus | 'all'>('all');
  const [chosenDate, setChosenDate] = useState<string | null>(null);
  const { open, openDetail, closeDetail } = useMasterDetail();

  const findings: AuditFinding[] = useUiQuery(uiApi.auditFindings, {}) ?? [];
  const settings = useUiQuery(uiApi.workspaceSettings, {});
  const hardPolicy = settings?.auditPolicy === 'hard';

  // Where an instance sits: its own floor, or the floor whose staff list names it.
  const floorOf = new Map(
    dashboard.employees.map((employee) => [
      employee.id,
      employee.floorId ??
        dashboard.floors.find((floor) => floor.employeeIds.includes(employee.id))?.id ??
        'lobby',
    ]),
  );
  const taskTitles = new Map(dashboard.tasks.map((task) => [task.id, task.title]));
  const ownedTasks = new Set(dashboard.tasks.filter((task) => task.isOwner).map((task) => task.id));

  const onFloor = (finding: AuditFinding) =>
    floorFilter === 'all' || floorOf.get(finding.employeeId) === floorFilter;
  const shown = findings.filter(
    (finding) => onFloor(finding) && (statusFilter === 'all' || finding.status === statusFilter),
  );
  const escalated = findings.filter((finding) => finding.status === 'escalated' && onFloor(finding));

  const nights = [...new Set(shown.map((finding) => finding.auditDate))].sort().reverse();
  const date = chosenDate && nights.includes(chosenDate) ? chosenDate : nights[0];
  const nightFindings = shown.filter((finding) => finding.auditDate === date);

  // One document per instance, the shape the auditor files and the employee reads.
  const byInstance = new Map<
    string,
    { employeeId: string; employeeName: string; findings: AuditFinding[] }
  >();
  for (const finding of nightFindings) {
    const document = byInstance.get(finding.employeeId) ?? {
      employeeId: finding.employeeId,
      employeeName: finding.employeeName,
      findings: [],
    };
    document.findings.push(finding);
    byInstance.set(finding.employeeId, document);
  }
  const documents = [...byInstance.values()].sort((a, b) => a.employeeName.localeCompare(b.employeeName));

  const canDecide = (finding: AuditFinding) =>
    canManageWorkspace || (finding.taskId !== undefined && ownedTasks.has(finding.taskId));
  const address = (id: string) =>
    void run(() => actions.markFindingAddressed(id), 'Recorded as addressed; tonight’s audit verifies it');
  const escalate = (id: string) =>
    void run(() => actions.escalateFinding(id), 'Escalated to the workspace channel and the next meeting');
  const openTask = (taskId: string) => {
    onSelectTask(taskId);
    go('tasks');
  };

  return (
    <div>
      <PageIntro
        eyebrow="AUDITORS"
        title="Audit"
        description="What the auditors found after hours, one document per instance per night, with the evidence they are prepared to defend."
      />

      {escalated.length > 0 && (
        <section className="escalation-strip card">
          <div className="section-title">
            <h2>
              <Siren size={16} /> {pluralize(escalated.length, 'escalated finding')}
            </h2>
          </div>
          <ul>
            {escalated.map((finding) => (
              <li key={finding.id}>
                <span className="finding-severity" data-severity={finding.severity}>
                  {severityLabels[finding.severity]}
                </span>
                <div>
                  <strong>{finding.employeeName}</strong>
                  <p>{finding.claim}</p>
                </div>
                <button
                  className="text-button"
                  onClick={() => {
                    setChosenDate(finding.auditDate);
                    openDetail();
                  }}
                >
                  {nightLabel(finding.auditDate)}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="audit-filters">
        <label>
          <span className="sr-only">Filter by floor</span>
          <select value={floorFilter} onChange={(event) => setFloorFilter(event.target.value)}>
            <option value="all">All floors</option>
            <option value="lobby">Lobby</option>
            {dashboard.floors.map((floor) => (
              <option key={floor.id} value={floor.id}>
                {floor.name}
              </option>
            ))}
          </select>
        </label>
        <div className="segmented">
          {statusFilters.map((filter) => (
            <button
              key={filter.value}
              data-active={statusFilter === filter.value}
              onClick={() => setStatusFilter(filter.value)}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {findings.length ? (
        <MasterDetail
          className="audit-layout card"
          open={open}
          backLabel="Nights"
          onBack={closeDetail}
          list={
            <div className="night-list">
              <div className="pane-toolbar">
                <strong>{pluralize(nights.length, 'night')}</strong>
              </div>
              {nights.map((night) => {
                const nightly = shown.filter((finding) => finding.auditDate === night);
                const instances = new Set(nightly.map((finding) => finding.employeeId)).size;
                const outstanding = nightly.filter(isOutstanding).length;
                return (
                  <button
                    key={night}
                    data-active={night === date}
                    onClick={() => {
                      setChosenDate(night);
                      openDetail();
                    }}
                  >
                    <strong>{nightLabel(night)}</strong>
                    <small>
                      {pluralize(instances, 'instance')} · {pluralize(nightly.length, 'finding')}
                    </small>
                    {outstanding > 0 && <span className="night-open">{outstanding} outstanding</span>}
                  </button>
                );
              })}
              {!nights.length && (
                <EmptyPane
                  icon={<ClipboardCheck size={22} />}
                  title="Nothing matches"
                  text="No night has a finding on this floor with that status."
                />
              )}
            </div>
          }
          detail={
            date ? (
              <div className="audit-night">
                <div className="night-head">
                  <span className="eyebrow">AUDIT OF {date}</span>
                  <h2>{nightLabel(date)}</h2>
                  <p>
                    {pluralize(documents.length, 'document')} · {pluralize(nightFindings.length, 'finding')}
                  </p>
                </div>
                {documents.map((document) => (
                  <AuditDocument
                    key={document.employeeId}
                    employeeName={document.employeeName}
                    floorName={
                      dashboard.floors.find((floor) => floor.id === floorOf.get(document.employeeId))?.name ??
                      'Lobby'
                    }
                    findings={document.findings}
                    hardPolicy={hardPolicy}
                    taskTitles={taskTitles}
                    canDecide={canDecide}
                    canEscalate={canManageWorkspace}
                    onOpenTask={openTask}
                    onAddress={address}
                    onEscalate={escalate}
                  />
                ))}
              </div>
            ) : (
              <EmptyPane
                icon={<ShieldAlert size={24} />}
                title="Choose a night"
                text="Each night's documents, one per instance, appear here."
              />
            )
          }
        />
      ) : (
        <EmptySection
          icon={<ShieldAlert size={28} />}
          title="No audits yet"
          text="The auditors run after working hours and file a document per instance, even when they find nothing."
        />
      )}
    </div>
  );
}
