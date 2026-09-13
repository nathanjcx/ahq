'use client';

import { useState } from 'react';
import { Sheet } from '../shared/sheet';
import { ToolChecklist } from '../shared/tool-checklist';
import { RelaySecret } from './relay-secret';
import type { Connection, Employee, Floor } from '@/lib/contracts';
import { getProvider } from '@/lib/providers';

export type InboxRoute = { employeeId: string; floorId?: string } | null;

export function ManageAccessPanel({
  connection,
  inboxConfigured,
  employees,
  floors,
  onClose,
  onSave,
}: {
  connection: Connection;
  inboxConfigured: boolean;
  /** Who a new inbox item can be routed to, and the floors they stand on. */
  employees: Employee[];
  floors: Floor[];
  onClose: () => void;
  onSave: (tools: string[], scope: string, inboxResources: string, inboxRoute: InboxRoute) => void;
}) {
  const provider = getProvider(connection.provider);
  const [selected, setSelected] = useState(connection.allowedTools);
  const [scope, setScope] = useState(connection.resourceScope);
  const [inboxResources, setInboxResources] = useState(connection.inboxResources.join(', '));
  const [advanced, setAdvanced] = useState(Boolean(connection.resourceScope));
  const [routeEmployee, setRouteEmployee] = useState(connection.inboxRoute?.employeeId ?? '');
  const [routeFloor, setRouteFloor] = useState(connection.inboxRoute?.floorId ?? '');
  const routeCandidates = employees.filter(
    (employee) => (employee.kind ?? 'worker') === 'worker' && employee.status !== 'retired',
  );
  const routeFloors = floors.filter(
    (floor) => !floor.archivedAt && floor.employeeIds.includes(routeEmployee),
  );
  const route: InboxRoute = routeEmployee
    ? {
        employeeId: routeEmployee,
        ...(routeFloor && routeFloors.some((floor) => floor.id === routeFloor)
          ? { floorId: routeFloor }
          : {}),
      }
    : null;
  const tools = connection.tools.map((name) => ({ name }));
  return (
    <Sheet
      title={`Manage ${connection.name}`}
      subtitle="Changes apply to new agent calls as soon as you save."
      onClose={onClose}
      footer={
        <button
          className="primary-button full"
          onClick={() => onSave(selected, scope, inboxResources, route)}
        >
          Save access
        </button>
      }
    >
      <div className="form-stack">
        <div className="permission-heading">
          <span className="eyebrow">TOOLS</span>
          <h3>What employees may use</h3>
          <p>Only tools your administrator reviewed appear here. Unchecking one revokes it immediately.</p>
        </div>
        <ToolChecklist tools={tools} selected={selected} onChange={setSelected} />
        {provider.inbox && (
          <label>
            Inbox: {provider.inbox.label} to follow
            <textarea
              value={inboxResources}
              onChange={(event) => setInboxResources(event.target.value)}
              placeholder={`Comma-separated, for example ${provider.inbox.example}`}
            />
            {!inboxConfigured && (
              <small className="field-hint">
                Event delivery for {provider.name} is not configured yet. Ask your administrator.
              </small>
            )}
          </label>
        )}
        {!provider.inbox && <RelaySecret connectionId={connection.id} />}
        <label>
          Route new inbox items to
          <select value={routeEmployee} onChange={(event) => setRouteEmployee(event.target.value)}>
            <option value="">Nobody · items wait in the Inbox</option>
            {routeCandidates.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.name} · {employee.role}
              </option>
            ))}
          </select>
          <small className="field-hint">
            Each new item starts a task for this employee in your name, as if you had assigned it.
          </small>
        </label>
        {routeEmployee && routeFloors.length > 0 && (
          <label>
            On floor
            <select value={routeFloor} onChange={(event) => setRouteFloor(event.target.value)}>
              <option value="">No floor</option>
              {routeFloors.map((floor) => (
                <option key={floor.id} value={floor.id}>
                  {floor.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="button" className="text-button" onClick={() => setAdvanced(!advanced)}>
          {advanced ? 'Hide' : 'Show'} advanced restrictions
        </button>
        {advanced && (
          <label>
            Restrict tool calls to these resource IDs
            <textarea
              value={scope}
              onChange={(event) => setScope(event.target.value)}
              placeholder="Leave blank to rely on the provider account permissions."
            />
            <small className="field-hint">
              Applies only to tools with a verified resource mapping. Other tools are blocked while a
              restriction is set.
            </small>
          </label>
        )}
      </div>
    </Sheet>
  );
}
