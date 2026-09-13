'use client';

import { ArrowRight, Check, Store, UserPlus, Users, X } from 'lucide-react';
import { useState } from 'react';
import type { PageProps } from '../app/page-props';
import { EmptySection } from '../shared/empty';
import { modelName } from '../shared/format';
import { HireSheet, hireContext } from '../shared/hire-sheet';
import { Avatar } from '../shared/marks';
import { MasterDetail, useMasterDetail } from '../shared/master-detail';
import { PageIntro } from '../shared/page-intro';
import { relativeTime } from '../shared/time';
import { useUiQuery } from '../shared/use-ui-query';
import { EmployeeDetail } from './employee-detail';
import { groupInstances, isReserved, readinessLabel, reservedStaff, shiftLabel } from './instances';
import type { Employee, Floor, InstanceStatus, Listing } from '@/lib/contracts';
import { pluralize } from '@/lib/text';
import { uiApi } from '@/lib/ui-api';
import './employees.css';

type Props = PageProps & { listings: Listing[] };

function InstanceCard({
  employee,
  status,
  active,
  onOpen,
}: {
  employee: Employee;
  status?: InstanceStatus;
  active: boolean;
  onOpen: () => void;
}) {
  return (
    <button className="employee-card card" data-active={active} onClick={onOpen}>
      <Avatar employee={employee} large />
      <span className={`availability ${status?.shift.state === 'running' ? 'busy' : ''}`} />
      <div>
        <h3>{employee.name}</h3>
        <p>{shiftLabel(status)}</p>
      </div>
      <span className="model-pill">{modelName(employee.model)}</span>
      <span className="card-meta" data-blocked={employee.status !== 'ready'}>
        {readinessLabel(employee) ?? `${(status?.tokensToday ?? 0).toLocaleString()} tokens today`}
      </span>
    </button>
  );
}

/** Requests waiting on an owner or an administrator under the `approval` hiring policy. */
function HireRequests({
  canDecide,
  floors,
  run,
  actions,
}: Pick<Props, 'run' | 'actions'> & { canDecide: boolean; floors: Floor[] }) {
  const requests = useUiQuery(uiApi.hireRequests, {});
  const floorName = (id?: string) => floors.find((floor) => floor.id === id)?.name ?? 'Lobby';
  const pending = requests?.filter((request) => request.status === 'pending') ?? [];
  if (!pending.length) return null;
  return (
    <section className="hire-requests">
      <div className="section-title">
        <div>
          <span className="eyebrow">WAITING ON A DECISION</span>
          <h2>Hire requests</h2>
        </div>
      </div>
      <div className="request-list">
        {pending.map((request) => (
          <article className="card" key={request.id}>
            <div>
              <h3>
                {request.count} × {request.listingName}
              </h3>
              <p>
                {request.requestedByName} asked {relativeTime(request.createdAt)} ·{' '}
                {floorName(request.floorId)}
              </p>
              <p className="request-detail">
                {request.names?.length ? request.names.join(', ') : 'Names chosen on approval'}
                {request.overnightModel ? ` · overnight on ${modelName(request.overnightModel)}` : ''}
              </p>
            </div>
            {canDecide ? (
              <>
                <button
                  className="secondary-button compact"
                  onClick={() => run(() => actions.decideHire(request.id, false), 'Request declined')}
                >
                  <X size={14} />
                  Decline
                </button>
                <button
                  className="primary-button compact"
                  onClick={() => run(() => actions.decideHire(request.id, true), 'Instances hired')}
                >
                  <Check size={14} />
                  Approve
                </button>
              </>
            ) : (
              <span className="request-state">Requested</span>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

export function EmployeesPage({ listings, ...props }: Props) {
  const { dashboard, actions, run, go, onSelectEmployee, onNewTask } = props;
  const [showRetired, setShowRetired] = useState(false);
  const [hiring, setHiring] = useState<{ listing: Listing; floorId?: string } | null>(null);
  const { open, openDetail, closeDetail } = useMasterDetail();
  const statuses = useUiQuery(uiApi.instanceStatus, {});
  const visible = dashboard.employees.filter(
    (employee) => showRetired || employee.status !== 'retired',
  );
  const groups = groupInstances(
    visible.filter((employee) => !isReserved(employee)),
    dashboard.floors,
  );
  const reserved = reservedStaff(visible);
  const retiredCount = dashboard.employees.filter((employee) => employee.status === 'retired').length;
  const selected =
    visible.find((employee) => employee.id === props.selectedEmployee) ?? visible[0] ?? null;
  const statusFor = (id: string) => statuses?.find((entry) => entry.employeeId === id);
  const { needsApproval } = hireContext(dashboard);
  const openCard = (employee: Employee) => {
    onSelectEmployee(employee.id);
    openDetail();
  };

  return (
    <div>
      <PageIntro
        eyebrow="YOUR TEAM"
        title="Employees"
        description="Each instance runs one published version, on one floor, one shift at a time."
        action={
          <button className="primary-button" onClick={() => go('marketplace')}>
            <UserPlus size={17} />
            Hire employee
          </button>
        }
      />
      <HireRequests
        canDecide={props.canManageWorkspace}
        floors={dashboard.floors}
        run={run}
        actions={actions}
      />
      {dashboard.employees.length ? (
        <MasterDetail
          className="employee-layout"
          open={open}
          backLabel="Employees"
          onBack={closeDetail}
          list={
            <div className="instance-groups">
              {retiredCount > 0 && (
                <label className="retired-toggle">
                  <input
                    type="checkbox"
                    checked={showRetired}
                    onChange={(event) => setShowRetired(event.target.checked)}
                  />
                  Show {pluralize(retiredCount, 'retired instance')}
                </label>
              )}
              {groups.map((group) => {
                const listing = listings.find((entry) => entry.listingId === group.listingId);
                return (
                  <section className="instance-group" key={group.key}>
                    <header>
                      <div>
                        <h2>{group.name}</h2>
                        <p>
                          {group.role} · version {group.version}
                          {group.updateAvailable ? ' · update available' : ''}
                        </p>
                      </div>
                      {listing && (
                        <button
                          className="secondary-button compact"
                          onClick={() => setHiring({ listing })}
                        >
                          <UserPlus size={14} />
                          Hire more
                        </button>
                      )}
                    </header>
                    {group.floors.map((floor) => (
                      <div className="floor-group" key={floor.floorId ?? 'lobby'}>
                        <h3>
                          {floor.floorName}
                          <span>{pluralize(floor.employees.length, 'instance')}</span>
                        </h3>
                        <div className="employee-grid">
                          {floor.employees.map((employee) => (
                            <InstanceCard
                              key={employee.id}
                              employee={employee}
                              status={statusFor(employee.id)}
                              active={selected?.id === employee.id}
                              onOpen={() => openCard(employee)}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </section>
                );
              })}
              {reserved.length > 0 && (
                <section className="instance-group" key="reserved">
                  <header>
                    <div>
                      <h2>Reserved staff</h2>
                      <p>Made by the workspace, not hired, and outside the concurrency cap</p>
                    </div>
                  </header>
                  <div className="employee-grid">
                    {reserved.map((employee) => (
                      <InstanceCard
                        key={employee.id}
                        employee={employee}
                        status={statusFor(employee.id)}
                        active={selected?.id === employee.id}
                        onOpen={() => openCard(employee)}
                      />
                    ))}
                  </div>
                </section>
              )}
              {!groups.length && !reserved.length && (
                <EmptySection
                  icon={<Store size={28} />}
                  title="Every instance here is retired"
                  text="Hire again from the marketplace, or show the retired instances to read what they did."
                  action={
                    <button className="primary-button" onClick={() => go('marketplace')}>
                      Browse marketplace <ArrowRight size={16} />
                    </button>
                  }
                />
              )}
            </div>
          }
          detail={
            selected && (
              <EmployeeDetail
                key={selected.id}
                employee={selected}
                status={statusFor(selected.id)}
                floors={dashboard.floors}
                connections={dashboard.connections}
                actions={actions}
                run={run}
                onNewTask={(id) => onNewTask(selected.floorId ?? null, id)}
                onPage={go}
              />
            )
          }
        />
      ) : (
        <EmptySection
          icon={<Users size={28} />}
          title="Build your first team"
          text="The marketplace contains published employees with clear skills, limits, and integration requirements."
          action={
            <button className="primary-button" onClick={() => go('marketplace')}>
              Browse marketplace <ArrowRight size={16} />
            </button>
          }
        />
      )}
      {hiring && (
        <HireSheet
          listing={hiring.listing}
          dashboard={dashboard}
          floorId={hiring.floorId}
          onClose={() => setHiring(null)}
          onHire={(options) =>
            run(
              () => actions.hire(hiring.listing.listingId, options),
              needsApproval
                ? 'Requested. An owner or an administrator decides it.'
                : `Hired ${pluralize(options.count ?? 1, 'instance')} of ${hiring.listing.name}`,
            )
          }
        />
      )}
    </div>
  );
}
