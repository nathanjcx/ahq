'use client';

import { AlertTriangle, Minus, Plus, UserPlus } from 'lucide-react';
import { useState } from 'react';
import type { HireOptions } from '../app/actions/core';
import { modelName, money } from './format';
import { Sheet } from './sheet';
import { useUiQuery } from './use-ui-query';
import type { Dashboard, Employee, Listing, ModelId } from '@/lib/contracts';
import { MODEL_IDS } from '@/lib/contracts';
import { pluralize } from '@/lib/text';
import { uiApi } from '@/lib/ui-api';
import './hire-sheet.css';

/** The most the marketplace hires at once, matching what `marketplace:hire` accepts. */
const MAX_COUNT = 20;

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

/** Who the viewer is where hiring is concerned, and what the period has already cost. */
export function hireContext(dashboard: Dashboard) {
  const role = dashboard.workspace?.role ?? 'member';
  const hiringPolicy = dashboard.settings?.hiringPolicy ?? 'anyone';
  return {
    role,
    hiringPolicy,
    /** A member under the approval policy files a request rather than hiring. */
    needsApproval: hiringPolicy === 'approval' && role === 'member',
    /** Tokens the workspace has recorded this period, which the projection is measured from. */
    usedTokens: (dashboard.workspace?.usage.byModel ?? []).reduce(
      (total, row) => total + row.input + row.output,
      0,
    ),
  };
}

/**
 * Hiring a count of one listing: how many, what to call them, where they sit, and what they run on
 * after hours, with the capacity and the spend the hire would add. Under a policy that needs an
 * approval the same sheet files a request instead, carrying the names and the model with it.
 */
export function HireSheet({
  listing,
  dashboard,
  floorId: initialFloorId,
  count: initialCount = 1,
  onClose,
  onHire,
}: {
  listing: Listing;
  dashboard: Dashboard;
  /** The floor the sheet opens on; the lobby when absent. */
  floorId?: string;
  /** How many the sheet opens on, when something else has already proposed a number. */
  count?: number;
  onClose: () => void;
  onHire: (options: HireOptions) => Promise<boolean>;
}) {
  const { employees, floors } = dashboard;
  const { role, hiringPolicy, needsApproval, usedTokens } = hireContext(dashboard);
  const [count, setCount] = useState(initialCount);
  const [floorId, setFloorId] = useState(initialFloorId ?? '');
  const [overnightModel, setOvernightModel] = useState<ModelId | ''>('');
  // Suggestions follow the count and the floor, because both decide which names are free; an
  // instance the hirer has typed over keeps what they typed until one of those changes.
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const names = suggestNames(listing.name, employees, floorId || undefined, count).map(
    (name, index) => edits[index] ?? name,
  );

  // The projection is the one place that counts instances the way the hiring cap counts them, so
  // the capacity it reports is what the sheet shows and what it refuses to go past.
  const capacityNow = useUiQuery(uiApi.planProjection, { projectedTokens: 0 })?.capacity;
  const perInstance = capacityNow?.instances ? Math.round(usedTokens / capacityNow.instances) : 0;
  const projection = useUiQuery(uiApi.planProjection, { projectedTokens: perInstance * count });
  const openFloors = floors.filter((floor) => floor.archivedAt === undefined);
  const blocked = hiringPolicy === 'admins' && role === 'member';
  const overCap = capacityNow ? capacityNow.instances + count > capacityNow.maxConcurrentInstances : false;
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
              names,
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
        {needsApproval && (
          <p className="hire-note">
            This workspace asks an owner or an administrator to approve a hire. The names and the
            overnight model you choose here ride with the request.
          </p>
        )}
        <fieldset className="hire-names">
          <legend>Names</legend>
          {names.map((name, index) => (
            <label key={index}>
              <span className="sr-only">Instance {index + 1}</span>
              <input
                value={name}
                maxLength={120}
                onChange={(event) => setEdits((current) => ({ ...current, [index]: event.target.value }))}
              />
            </label>
          ))}
        </fieldset>
        <section className="hire-effect">
          <h3>What this adds</h3>
          <dl>
            {capacityNow && (
              <div>
                <dt>Parallel tasks</dt>
                <dd>
                  {capacityNow.instances} → {capacityNow.instances + count} of{' '}
                  {capacityNow.maxConcurrentInstances}
                </dd>
              </div>
            )}
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
                    : `${money(projection.estimatedCost)} this period`}
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
            This workspace runs at most {capacityNow?.maxConcurrentInstances} instances. Retire one,
            hire fewer, or raise the limit in Settings.
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
