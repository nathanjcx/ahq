'use client';

import { Archive, ArrowRight, BadgeCheck, Link2, Play, UserPlus, Users } from 'lucide-react';
import type { Connection, Employee, ProviderId } from '@/lib/contracts';
import { EmptySection } from '../shared/empty';
import { modelName, providerName } from '../shared/format';
import { Avatar, ProviderMark } from '../shared/marks';
import { MasterDetail, useMasterDetail } from '../shared/master-detail';
import { PageIntro } from '../shared/page-intro';

/**
 * Why a capability is missing, in terms of the connections this viewer can see.
 * Connections another member has not shared are invisible here, so the advice stays about what to ask for.
 */
function missingNote(provider: string, connections: Connection[]) {
  const label = providerName(provider as ProviderId);
  const usable = connections.filter((item) => item.provider === provider && item.status === 'connected');
  const shared = usable.find((item) => !item.isOwner);
  if (usable.some((item) => item.isOwner))
    return `Your ${label} account does not allow every tool this employee needs. Update it on the Integrations page.`;
  if (shared)
    return `${shared.ownerName} shared a ${label} account, but it does not allow every tool this employee needs. Ask ${shared.ownerName} to allow the rest, or connect your own.`;
  return `Missing ${label}. Connect ${label} or ask a teammate to share theirs.`;
}

export function EmployeesPage({
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
  const { open, openDetail, closeDetail } = useMasterDetail();
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
        <MasterDetail
          className="employee-layout"
          open={open}
          backLabel="Employees"
          onBack={closeDetail}
          list={
            <div className="employee-grid">
              {employees.map((employee) => (
                <button
                  className="employee-card card"
                  key={employee.id}
                  data-active={selected?.id === employee.id}
                  onClick={() => {
                    onSelect(employee.id);
                    openDetail();
                  }}
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
          }
          detail={
            selected && (
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
                        {missingNote(capability, connections)}
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
            )
          }
        />
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
