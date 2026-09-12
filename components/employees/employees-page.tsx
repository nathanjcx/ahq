'use client';

import { Archive, ArrowRight, BadgeCheck, Link2, Play, UserPlus, Users } from 'lucide-react';
import type { Connection, Employee } from '@/lib/contracts';
import { EmptySection } from '../shared/empty';
import { modelName } from '../shared/format';
import { Avatar, ProviderMark } from '../shared/marks';
import { PageIntro } from '../shared/page-intro';

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
