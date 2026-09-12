'use client';

import { AlertTriangle, Minus, Plus, UserPlus } from 'lucide-react';
import { useState } from 'react';
import type { HireOptions } from '../app/actions/core';
import { modelName } from './format';
import { Sheet } from './sheet';
import { useUiQuery } from './use-ui-query';
import type { Employee, Floor, HiringPolicy, Listing, ModelId } from '@/lib/contracts';
import { MODEL_IDS } from '@/lib/contracts';
import { pluralize } from '@/lib/text';
import { uiApi } from '@/lib/ui-api';
import './hire-sheet.css';

/** The most the marketplace hires at once, matching what `marketplace:hire` accepts. */
const MAX_COUNT = 20;

/** Instances that count against the concurrency cap: the workspace makes its own reserved staff. */
function workerCount(employees: Employee[]) {
  return employees.filter(
    (employee) => (employee.kind ?? 'worker') === 'worker' && employee.status !== 'retired',
  ).length;
}

/** `Ada`, `Ada 2`, `Ada 3`: the names hiring would give, skipping the ones the floor already uses. */
function suggestNames(stem: string, employees: Employee[], floorId: string | undefined, count: number) {
  const taken = new Set(
    employees
      .filter((employee) => employee.status !== 'retired' && employee.floorId === floorId)
      .map((employee) => employee.name),
  );
  const names: string[] = [];
  for (let index = 1; names.length < count; index++) {
    const candidate = index === 1 ? stem : `${stem} ${index}`;
    if (taken.has(candidate)) continue;
    taken.add(candidate);
    names.push(candidate);
  }
  return names;
}

/**
 * Hiring a count of one listing: how many, what to call them, where they sit, and what they run on
 * after hours, with the capacity and the spend the hire would add. Under a policy that needs an
 * approval the same sheet files a request instead, and names are given when it is approved.
 */
export function HireSheet({
  listing,
  employees,
  floors,
  floorId: initialFloorId,
  hiringPolicy,
  role,
  usedTokens,
  maxConcurrentInstances,
  onClose,
  onHire,
}: {
  listing: Listing;
  employees: Employee[];
  floors: Floor[];
  /** The floor the sheet opens on; the lobby when absent. */
  floorId?: string;
  hiringPolicy: HiringPolicy;
  role: 'owner' | 'admin' | 'member';
  /** Tokens the workspace has recorded this period, which the projection is measured from. */
  usedTokens: number;
  maxConcurrentInstances: number;
  onClose: () => void;
  onHire: (options: HireOptions) => Promise<boolean>;
}) {
  const [count, setCount] = useState(1);
  const [floorId, setFloorId] = useState(initialFloorId ?? '');
  const [overnightModel, setOvernightModel] = useState<ModelId | ''>('');
  // Suggestions follow the count and the floor, because both decide which names are free; an
  // instance the hirer has typed over keeps what they typed until one of those changes.
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const names = suggestNames(listing.name, employees, floorId || undefined, count).map(
    (name, index) => edits[index] ?? name,
  );

  const workers = workerCount(employees);
  const perInstance = workers ? Math.round(usedTokens / workers) : 0;
  const projection = useUiQuery(uiApi.planProjection, { projectedTokens: perInstance * count });
  const openFloors = floors.filter((floor) => floor.archivedAt === undefined);
  const needsApproval = hiringPolicy === 'approval' && role === 'member';
  const blocked = hiringPolicy === 'admins' && role === 'member';
  const overCap = workers + count > maxConcurrentInstances;
  const verb = needsApproval ? 'Request' : 'Hire';

  return (
    <Sheet
      title={`${verb} ${pluralize(count, 'instance')} of ${listing.name}`}
      subtitle={listing.role}
      onClose={onClose}
      footer={
        <button
          className="primary-button full"
          disabled={busy || blocked || overCap}
          onClick={async () => {
            setBusy(true);
            const done = await onHire({
              count,
              floorId: floorId || undefined,
              names: needsApproval ? undefined : names,
              overnightModel: overnightModel || undefined,
            });
            setBusy(false);
            if (done) onClose();
          }}
        >
          <UserPlus size={15} />
          {verb} {pluralize(count, 'instance')}
        </button>
      }
    >
      <div className="form-stack hire-form">
        <div className="hire-count">
          <span>
            <strong>How many</strong>
            <small>Each instance runs one shift at a time, so the count is the parallelism.</small>
          </span>
          <div className="hire-stepper">
            <button
              className="icon-button"
              aria-label="One fewer"
              disabled={count <= 1}
              onClick={() => {
                setCount((value) => Math.max(1, value - 1));
                setEdits({});
              }}
            >
              <Minus size={15} />
            </button>
            <strong aria-live="polite">{count}</strong>
            <button
              className="icon-button"
              aria-label="One more"
              disabled={count >= MAX_COUNT}
              onClick={() => {
                setCount((value) => Math.min(MAX_COUNT, value + 1));
                setEdits({});
              }}
            >
              <Plus size={15} />
            </button>
          </div>
        </div>
        <label>
          Floor
          <select
            value={floorId}
            onChange={(event) => {
              setFloorId(event.target.value);
              setEdits({});
            }}
          >
            <option value="">Lobby</option>
            {openFloors.map((floor) => (
              <option key={floor.id} value={floor.id}>
                {floor.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Overnight model
          <small>What these instances run on outside working hours.</small>
          <select
            value={overnightModel}
            onChange={(event) => setOvernightModel(event.target.value as ModelId | '')}
          >
            <option value="">Same as {modelName(listing.model)}</option>
            {MODEL_IDS.map((model) => (
              <option key={model} value={model}>
                {modelName(model)}
              </option>
            ))}
          </select>
        </label>
        {needsApproval ? (
          <p className="hire-note">
            This workspace asks an owner or an administrator to approve a hire. They are named when the
            request is approved.
          </p>
        ) : (
          <fieldset className="hire-names">
            <legend>Names</legend>
            {names.map((name, index) => (
              <label key={index}>
                <span className="sr-only">Instance {index + 1}</span>
                <input
                  value={name}
                  maxLength={120}
                  onChange={(event) =>
                    setEdits((current) => ({ ...current, [index]: event.target.value }))
                  }
                />
              </label>
            ))}
          </fieldset>
        )}
        <section className="hire-effect">
          <h3>What this adds</h3>
          <dl>
            <div>
              <dt>Parallel tasks</dt>
              <dd>
                {workers} → {workers + count} of {maxConcurrentInstances}
              </dd>
            </div>
            {projection?.plan === 'subscription' && projection.monthlyAllowance > 0 && (
              <div>
                <dt>Monthly allowance</dt>
                <dd>{Math.round(projection.allowanceUsed * 100)}% once this lands</dd>
              </div>
            )}
            {projection?.plan === 'byok' && (
              <div>
                <dt>Estimated spend</dt>
                <dd>
                  {projection.estimatedCost === undefined
                    ? 'No rates set'
                    : `$${projection.estimatedCost.toFixed(2)} this period`}
                </dd>
              </div>
            )}
          </dl>
          <p>
            {perInstance
              ? `Projected from the ${perInstance.toLocaleString()} tokens each instance has spent this period.`
              : 'Nothing has been spent this period yet, so there is nothing to project from.'}
          </p>
        </section>
        {overCap && (
          <p className="hire-warning">
            <AlertTriangle size={15} />
            This workspace runs at most {maxConcurrentInstances} instances. Retire one, hire fewer, or
            raise the limit in Settings.
          </p>
        )}
        {blocked && (
          <p className="hire-warning">
            <AlertTriangle size={15} />
            Only owners and administrators hire in this workspace.
          </p>
        )}
      </div>
    </Sheet>
  );
}
