'use client';

import { useState } from 'react';
import { modelName } from '../../shared/format';
import { useUiQuery } from '../../shared/use-ui-query';
import { formId, LockedNote, type SectionProps } from './sections';
import type { MemoryBudgets, ModelId, ModelRate } from '@/lib/contracts';
import { uiApi } from '@/lib/ui-api';

const models: ModelId[] = ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'];

const budgetFields: { key: keyof MemoryBudgets; label: string }[] = [
  { key: 'workspace', label: 'Workspace' },
  { key: 'project', label: 'Project' },
  { key: 'floor', label: 'Floor' },
  { key: 'agent', label: 'Notebook' },
  { key: 'summaries', label: 'Summaries' },
];

/** Rates are stored per token and read per million, which is the only scale anyone quotes them in. */
const PER_MILLION = 1_000_000;
const perMillion = (value: number) => Number((value * PER_MILLION).toFixed(4));

function rateFor(rates: ModelRate[], model: ModelId): ModelRate {
  return rates.find((rate) => rate.model === model) ?? { model, input: 0, cached: 0, output: 0 };
}

export function PlanSection({ settings, canManage, save }: SectionProps) {
  const [draft, setDraft] = useState(settings);
  const projection = useUiQuery(uiApi.planProjection, { projectedTokens: 0 });
  const byok = draft.plan === 'byok';

  const setRate = (model: ModelId, field: 'input' | 'cached' | 'output', perMillionValue: number) => {
    const next = { ...rateFor(draft.rates, model), [field]: perMillionValue / PER_MILLION };
    const rest = draft.rates.filter((rate) => rate.model !== model);
    const empty = next.input === 0 && next.cached === 0 && next.output === 0;
    setDraft({ ...draft, rates: empty ? rest : [...rest, next] });
  };
  const number = (value: string) => Math.max(0, Math.floor(Number(value) || 0));

  return (
    <form
      id={formId('plan')}
      className="form-stack"
      onSubmit={(event) => {
        event.preventDefault();
        void save(draft, 'Plan and budgets saved');
      }}
    >
      {projection && (
        <p className="settings-now">
          {projection.usedTokens.toLocaleString()} tokens used this period
          {projection.monthlyAllowance
            ? ` · ${Math.round(projection.allowanceUsed * 100)}% of the allowance`
            : ''}{' '}
          · {projection.capacity.runningShifts} of {projection.capacity.maxConcurrentInstances} shifts
          running.
        </p>
      )}

      <div className="settings-field">
        <span className="settings-label">Plan</span>
        <div className="settings-choices">
          <button
            type="button"
            disabled={!canManage}
            data-active={!byok}
            onClick={() => setDraft({ ...draft, plan: 'subscription' })}
          >
            <strong>Subscription</strong>
            <small>A monthly token allowance and a cap on concurrent instances.</small>
          </button>
          <button
            type="button"
            disabled={!canManage}
            data-active={byok}
            onClick={() => setDraft({ ...draft, plan: 'byok' })}
          >
            <strong>Own key</strong>
            <small>Your own provider key, priced from the rates below as an estimate.</small>
          </button>
        </div>
      </div>

      {byok ? (
        <div className="settings-field">
          <span className="settings-label">Rates, US dollars per million tokens</span>
          <table className="rates-table">
            <thead>
              <tr>
                <th>Model</th>
                <th>Input</th>
                <th>Cached</th>
                <th>Output</th>
              </tr>
            </thead>
            <tbody>
              {models.map((model) => {
                const rate = rateFor(draft.rates, model);
                return (
                  <tr key={model}>
                    <th scope="row">{modelName(model)}</th>
                    {(['input', 'cached', 'output'] as const).map((field) => (
                      <td key={field}>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          aria-label={`${modelName(model)} ${field} rate`}
                          disabled={!canManage}
                          value={perMillion(rate[field])}
                          onChange={(event) => setRate(model, field, Math.max(0, Number(event.target.value)))}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <small>Usage stays token-based; cost is a projection on top of it.</small>
        </div>
      ) : (
        <div className="settings-pair">
          <label>
            Monthly allowance
            <input
              type="number"
              min="0"
              step="100000"
              disabled={!canManage}
              value={draft.monthlyAllowance}
              onChange={(event) => setDraft({ ...draft, monthlyAllowance: number(event.target.value) })}
            />
            <small>Tokens included each period. Use 0 for no allowance.</small>
          </label>
          <label>
            Concurrent instances
            <input
              type="number"
              min="1"
              step="1"
              disabled={!canManage}
              value={draft.maxConcurrentInstances}
              onChange={(event) =>
                setDraft({ ...draft, maxConcurrentInstances: Math.max(1, number(event.target.value)) })
              }
            />
            <small>One instance runs one shift, so this is the parallelism.</small>
          </label>
        </div>
      )}

      <div className="settings-pair">
        <label>
          Daily token cap
          <input
            type="number"
            min="0"
            step="10000"
            disabled={!canManage}
            value={draft.dailyTokenCap}
            onChange={(event) => setDraft({ ...draft, dailyTokenCap: number(event.target.value) })}
          />
          <small>The scheduler stops starting shifts once a day reaches this. 0 for no cap.</small>
        </label>
        <label>
          Triage allowance
          <input
            type="number"
            min="0"
            step="10000"
            disabled={!canManage}
            value={draft.triageAllowance}
            onChange={(event) => setDraft({ ...draft, triageAllowance: number(event.target.value) })}
          />
          <small>Kept aside for incidents, which preempt working hours.</small>
        </label>
      </div>

      <div className="settings-field">
        <span className="settings-label">Memory budgets, tokens per scope</span>
        <div className="budget-grid">
          {budgetFields.map((field) => (
            <label key={field.key}>
              {field.label}
              <input
                type="number"
                min="0"
                step="100"
                disabled={!canManage}
                value={draft.memoryBudgets[field.key]}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    memoryBudgets: { ...draft.memoryBudgets, [field.key]: number(event.target.value) },
                  })
                }
              />
            </label>
          ))}
        </div>
        <small>What each scope may take in the working-memory block compiled for every shift.</small>
      </div>
      {!canManage && <LockedNote what="Plan and budgets" />}
    </form>
  );
}
