'use client';

import { Archive, ArrowUpRight, BadgeCheck, Link2, Play, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import type { Actions } from '../app/actions';
import { EmployeeFeed } from '../shared/employee-feed';
import { EmptyMini } from '../shared/empty';
import { modelName, providerName } from '../shared/format';
import { Avatar } from '../shared/marks';
import { relativeTime, shortTime } from '../shared/time';
import { useUiQuery } from '../shared/use-ui-query';
import { readinessLabel, shiftLabel } from './instances';
import type { Connection, Employee, Floor, InstanceStatus, ModelId, ProviderId } from '@/lib/contracts';
import { MODEL_IDS } from '@/lib/contracts';
import { asId, uiApi } from '@/lib/ui-api';

const TABS = ['Overview', 'Feed', 'Memory', 'Findings', 'Upgrade', 'Retire'] as const;
type Tab = (typeof TABS)[number];

/**
 * Why a capability is missing, in terms of the connections this viewer can see. Connections another
 * member has not shared are invisible here, so the advice stays about what to ask for.
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

function InstanceMemory({ employeeId, onRecords }: { employeeId: string; onRecords: () => void }) {
  const entries = useUiQuery(uiApi.memories, { scope: 'agent', scopeId: employeeId });
  if (!entries?.length)
    return (
      <EmptyMini
        icon={<Archive size={20} />}
        title="Nothing written down yet"
        text="Claims this instance remembers about its own work appear here once it files them."
      />
    );
  return (
    <>
      <ul className="notebook">
        {entries.map((entry) => (
          <li key={entry.id} data-status={entry.status}>
            <p>{entry.text}</p>
            <span>
              {entry.kind} · {entry.status} · {relativeTime(entry.createdAt)}
            </span>
          </li>
        ))}
      </ul>
      <button className="text-button" onClick={onRecords}>
        Manage these in Records <ArrowUpRight size={14} />
      </button>
    </>
  );
}

function InstanceFindings({ employeeId, onAudit }: { employeeId: string; onAudit: () => void }) {
  const findings = useUiQuery(uiApi.auditFindings, { employeeId: asId<'installations'>(employeeId) });
  if (!findings?.length)
    return (
      <EmptyMini
        icon={<BadgeCheck size={20} />}
        title="No findings"
        text="The auditors have raised nothing against this instance."
      />
    );
  return (
    <>
      <ul className="finding-list">
        {findings.map((finding) => (
          <li key={finding.id}>
            <span className="finding-mark" data-severity={finding.severity}>
              {finding.severity}
            </span>
            <div>
              <strong>{finding.claim}</strong>
              <p>{finding.requiredAction}</p>
              <small>
                {finding.auditDate} · {finding.status}
              </small>
            </div>
          </li>
        ))}
      </ul>
      <button className="text-button" onClick={onAudit}>
        Open the audit documents <ArrowUpRight size={14} />
      </button>
    </>
  );
}

function InstanceUpgrade({ employee, onUpgrade }: { employee: Employee; onUpgrade: () => Promise<unknown> }) {
  const upgrade = useUiQuery(uiApi.instanceUpgrade, {
    employeeId: asId<'installations'>(employee.id),
  });
  if (!upgrade)
    return (
      <EmptyMini
        icon={<BadgeCheck size={20} />}
        title="Up to date"
        text={`This instance runs version ${employee.version}, the version on offer today.`}
      />
    );
  return (
    <div className="upgrade-panel">
      <h3>
        Version {upgrade.fromVersion} → {upgrade.toVersion}
      </h3>
      <p>Published {relativeTime(upgrade.publishedAt)}. These parts of the employee change:</p>
      <ul className="change-list">
        {upgrade.changed.map((field) => (
          <li key={field}>{field}</li>
        ))}
      </ul>
      <p className="upgrade-note">
        The new version is checked against this workspace&rsquo;s connections as it is applied. If it needs
        access the workspace cannot reach, nothing changes and the instance stays on version{' '}
        {upgrade.fromVersion}.
      </p>
      <button className="primary-button" onClick={onUpgrade}>
        Upgrade to version {upgrade.toVersion}
      </button>
    </div>
  );
}

/**
 * One instance: what it is doing, what it remembers, what the auditors said, and how it ends. The
 * page keys this on the instance, so opening another one starts it on its own name and first tab.
 */
export function EmployeeDetail({
  employee,
  status,
  floors,
  connections,
  actions,
  run,
  onNewTask,
  onPage,
}: {
  employee: Employee;
  status?: InstanceStatus;
  floors: Floor[];
  connections: Connection[];
  actions: Actions;
  run: (work: () => Promise<unknown>, success: string) => Promise<boolean>;
  onNewTask: (employeeId: string) => void;
  onPage: (page: 'records' | 'audit') => void;
}) {
  const [tab, setTab] = useState<Tab>('Overview');
  const [name, setName] = useState(employee.name);
  const retired = employee.status === 'retired';
  const reserved = (employee.kind ?? 'worker') !== 'worker';
  const tabs = TABS.filter((entry) => entry !== 'Upgrade' || employee.updateAvailable);

  return (
    <aside className="employee-profile card">
      <div className="profile-top">
        <Avatar employee={employee} large />
        <div>
          <span className="eyebrow">{reserved ? 'RESERVED STAFF' : 'INSTANCE'}</span>
          <h2>{employee.name}</h2>
          <p>
            {employee.role} · {employee.instanceOf} v{employee.version}
          </p>
        </div>
      </div>
      <div className="profile-tabs" role="tablist" aria-label="Instance detail">
        {tabs.map((entry) => (
          <button
            key={entry}
            role="tab"
            id={`instance-tab-${entry}`}
            aria-selected={tab === entry}
            aria-controls="instance-tab-panel"
            tabIndex={tab === entry ? 0 : -1}
            data-active={tab === entry}
            onClick={() => setTab(entry)}
          >
            {entry}
          </button>
        ))}
      </div>
      <div
        id="instance-tab-panel"
        role="tabpanel"
        aria-labelledby={`instance-tab-${tab}`}
        className="profile-panel"
      >
        {tab === 'Overview' && (
          <>
            <dl className="profile-facts">
              <div>
                <dt>Status</dt>
                <dd>
                  <i className={`status-dot ${employee.status === 'ready' ? 'working' : 'waiting'}`} />
                  {readinessLabel(employee) ?? 'Ready'}
                </dd>
              </div>
              <div>
                <dt>Shift</dt>
                <dd>{shiftLabel(status)}</dd>
              </div>
              <div>
                <dt>Today</dt>
                <dd>{(status?.tokensToday ?? 0).toLocaleString()} tokens</dd>
              </div>
              <div>
                <dt>Model</dt>
                <dd>{modelName(employee.model)}</dd>
              </div>
              {status && (
                <div>
                  <dt>Hired</dt>
                  <dd>{relativeTime(status.hiredAt)}</dd>
                </div>
              )}
            </dl>
            {!retired && (
              <div className="profile-edit form-stack">
                <label>
                  Name
                  <span className="rename-row">
                    <input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
                    <button
                      className="secondary-button compact"
                      disabled={!name.trim() || name === employee.name}
                      onClick={() => run(() => actions.renameEmployee(employee.id, name), 'Renamed')}
                    >
                      Save
                    </button>
                  </span>
                </label>
                <label>
                  Floor
                  <select
                    value={employee.floorId ?? ''}
                    onChange={(event) =>
                      run(() => actions.moveEmployee(employee.id, event.target.value || undefined), 'Moved')
                    }
                  >
                    <option value="">Lobby</option>
                    {floors
                      .filter((floor) => floor.archivedAt === undefined)
                      .map((floor) => (
                        <option key={floor.id} value={floor.id}>
                          {floor.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Overnight model
                  <select
                    value={status?.overnightModel ?? ''}
                    onChange={(event) =>
                      run(
                        () =>
                          actions.setOvernightModel(
                            employee.id,
                            (event.target.value || undefined) as ModelId | undefined,
                          ),
                        'Overnight model updated',
                      )
                    }
                  >
                    <option value="">Same as {modelName(employee.model)}</option>
                    {MODEL_IDS.map((model) => (
                      <option key={model} value={model}>
                        {modelName(model)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            <div className="profile-section">
              <h3>Readiness</h3>
              {retired ? (
                <p className="readiness-warn">
                  <Archive size={14} />
                  This instance is retired and takes no more work.
                </p>
              ) : employee.missingCapabilities.length ? (
                employee.missingCapabilities.map((capability) => (
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
            {employee.persona && (
              <div className="profile-section">
                <h3>Character</h3>
                <p className="persona-voice">{employee.persona.voice}</p>
                <div className="persona-traits">
                  {employee.persona.traits.map((trait) => (
                    <span key={trait}>{trait}</span>
                  ))}
                </div>
              </div>
            )}
            <button
              className="primary-button full"
              disabled={employee.status !== 'ready'}
              onClick={() => onNewTask(employee.id)}
            >
              <Play size={15} />
              Assign new task
            </button>
          </>
        )}
        {tab === 'Feed' && <EmployeeFeed employeeId={employee.id} compact />}
        {tab === 'Memory' && <InstanceMemory employeeId={employee.id} onRecords={() => onPage('records')} />}
        {tab === 'Findings' && <InstanceFindings employeeId={employee.id} onAudit={() => onPage('audit')} />}
        {tab === 'Upgrade' && (
          <InstanceUpgrade
            employee={employee}
            onUpgrade={() =>
              run(() => actions.upgradeEmployee(employee.id), 'Upgraded to the current version')
            }
          />
        )}
        {tab === 'Retire' && (
          <div className="retire-panel">
            {retired ? (
              <p>
                Retired. Its work stays readable everywhere it was done, and its name still resolves on old
                tasks.
              </p>
            ) : (
              <>
                <p>
                  Retiring takes this instance off its floor and gives up its place against the concurrency
                  cap. Finish or cancel its active work first.
                </p>
                <p className="retire-note">
                  <ShieldAlert size={14} />
                  Everything it has already done stays readable. Hiring the same version again makes a new
                  instance with an empty notebook.
                </p>
                <button
                  className="secondary-button danger"
                  onClick={() => run(() => actions.retireEmployee(employee.id), 'Instance retired')}
                >
                  <Archive size={15} />
                  Retire {employee.name}
                </button>
              </>
            )}
            {status?.shift.state === 'running' && (
              <p className="retire-note">
                <ShieldAlert size={14} />
                It is in a shift that started at {shortTime(status.shift.startedAt ?? 0)}.
              </p>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
