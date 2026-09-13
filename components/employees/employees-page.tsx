'use client';

import { ArrowRight, Check, ChevronLeft, ChevronRight, UserPlus, Users, X } from 'lucide-react';
import { useState } from 'react';
import type { PageProps } from '../app/page-props';
import { EmptySection } from '../shared/empty';
import { modelName } from '../shared/format';
import { Avatar } from '../shared/marks';
import { PageIntro } from '../shared/page-intro';
import { relativeTime } from '../shared/time';
import { useUiQuery } from '../shared/use-ui-query';
import { EmployeeDetail } from './employee-detail';
import { isReserved, readinessLabel, shiftLabel } from './instances';
import type { Floor, Listing } from '@/lib/contracts';
import { pluralize } from '@/lib/text';
import { uiApi } from '@/lib/ui-api';
import '../work/work.css';
import './employees.css';

type Props = PageProps & { listings: Listing[] };

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

export function EmployeesPage({ listings: _listings, ...props }: Props) {
  const { dashboard, actions, run, go, onSelectEmployee, onNewTask } = props;
  const [showRetired, setShowRetired] = useState(false);
  const statuses = useUiQuery(uiApi.instanceStatus, {});
  const statusFor = (id: string) => statuses?.find((entry) => entry.employeeId === id);
  const floorName = (id?: string) =>
    id ? (dashboard.floors.find((floor) => floor.id === id)?.name ?? 'Archived floor') : 'No floor';
  const opened = dashboard.employees.find((employee) => employee.id === props.selectedEmployee);
  const retiredCount = dashboard.employees.filter((employee) => employee.status === 'retired').length;
  const rows = dashboard.employees
    .filter((employee) => showRetired || employee.status !== 'retired')
    .sort((a, b) => Number(isReserved(a)) - Number(isReserved(b)) || a.name.localeCompare(b.name));

  if (opened)
    return (
      <div className="detail-page team-detail">
        <button className="detail-back" onClick={() => onSelectEmployee(null)}>
          <ChevronLeft size={16} /> Employees
        </button>
        <EmployeeDetail
          key={opened.id}
          employee={opened}
          status={statusFor(opened.id)}
          floors={dashboard.floors}
          connections={dashboard.connections}
          actions={actions}
          run={run}
          onNewTask={(id) => onNewTask(opened.floorId ?? null, id)}
          onPage={go}
        />
      </div>
    );

  return (
    <div>
      <PageIntro
        title="Employees"
        description="Each instance runs one published version, on one floor, one shift at a time."
        action={
          <button className="primary-button compact" onClick={() => go('marketplace')}>
            <UserPlus size={15} />
            Hire
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
        <div className="card data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Floor</th>
                <th>Now</th>
                <th>Model</th>
                <th className="num">Today</th>
                <th aria-hidden="true" />
              </tr>
            </thead>
            <tbody>
              {rows.map((employee) => {
                const status = statusFor(employee.id);
                const blocked = readinessLabel(employee);
                return (
                  <tr
                    key={employee.id}
                    className="row-link"
                    tabIndex={0}
                    onClick={() => onSelectEmployee(employee.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onSelectEmployee(employee.id);
                      }
                    }}
                  >
                    <td>
                      <span className="who">
                        <Avatar employee={employee} />
                        <span>
                          <b>{employee.name}</b>
                          <small>
                            {employee.role}
                            {isReserved(employee) ? ' · reserved' : ` · v${employee.version}`}
                          </small>
                        </span>
                      </span>
                    </td>
                    <td className={employee.floorId ? undefined : 'dim'}>{floorName(employee.floorId)}</td>
                    <td>
                      <span
                        className="work-status"
                        data-tone={blocked ? 'bad' : status?.shift.state === 'running' ? 'run' : 'idle'}
                      >
                        <i />
                        {blocked ?? shiftLabel(status)}
                      </span>
                    </td>
                    <td className="dim">{modelName(employee.model)}</td>
                    <td className="num dim">
                      {status?.tokensToday ? `${status.tokensToday.toLocaleString()} tokens` : '—'}
                    </td>
                    <td className="chev">
                      <ChevronRight size={16} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {retiredCount > 0 && (
            <div className="table-foot">
              <label>
                <input
                  type="checkbox"
                  checked={showRetired}
                  onChange={(event) => setShowRetired(event.target.checked)}
                />
                Show {pluralize(retiredCount, 'retired instance')}
              </label>
            </div>
          )}
        </div>
      ) : (
        <EmptySection
          icon={<Users size={28} />}
          title="No employees yet"
          text="Hire from the marketplace; each listing says what it can use and what it produces."
          action={
            <button className="primary-button" onClick={() => go('marketplace')}>
              Browse the marketplace <ArrowRight size={16} />
            </button>
          }
        />
      )}
    </div>
  );
}
