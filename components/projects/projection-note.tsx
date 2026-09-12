'use client';

import { AlertTriangle } from 'lucide-react';
import type { PlanProjection } from '@/lib/contracts';

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

/** "1.2M tokens", in the shortest form that still says it. */
export function tokenCount(tokens: number) {
  return `${compact.format(tokens)} tokens`;
}

function money(amount: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(amount);
}

/**
 * What a roadmap costs the workspace: allowance consumption on a subscription, an estimate from the
 * workspace's own rates otherwise, and the parallelism it has to spend it with.
 */
export function ProjectionNote({
  projection,
  projectedTokens,
}: {
  projection?: PlanProjection;
  /** Tokens this roadmap adds, named separately so the note reads as this roadmap's cost. */
  projectedTokens?: number;
}) {
  if (!projection) return null;
  const { capacity } = projection;
  return (
    <div className="projection-note" data-over={projection.overAllowance}>
      {projectedTokens !== undefined && (
        <span>
          <small>This roadmap</small>
          <strong>{tokenCount(projectedTokens)}</strong>
        </span>
      )}
      {projection.plan === 'subscription' ? (
        <span>
          <small>Monthly allowance</small>
          <strong>
            {projection.monthlyAllowance
              ? `${Math.round(projection.allowanceUsed * 100)}% used`
              : 'No allowance set'}
          </strong>
        </span>
      ) : (
        <span>
          <small>Estimated spend</small>
          <strong>
            {projection.estimatedCost === undefined ? 'No rates set' : money(projection.estimatedCost)}
          </strong>
        </span>
      )}
      <span>
        <small>Parallelism</small>
        <strong>
          {capacity.instances} instances · {capacity.freeSlots} of {capacity.maxConcurrentInstances} free
        </strong>
      </span>
      {projection.overAllowance && (
        <span className="projection-warning">
          <AlertTriangle size={14} />
          This plan runs past the monthly allowance.
        </span>
      )}
      {projection.unpricedModels.length > 0 && (
        <span className="projection-warning">
          <AlertTriangle size={14} />
          {projection.unpricedModels.join(', ')} have no rate, so the estimate is low.
        </span>
      )}
    </div>
  );
}
