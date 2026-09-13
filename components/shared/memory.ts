import type { Memory, MemoryBudgets, MemoryScope, MemoryScopeSummary } from '@/lib/contracts';

/**
 * What the interface says about how full a shelf is. The estimate matches the
 * compiler's — four characters to a token — so Records, the floor's binder and
 * the basement shelves all report the same number.
 */
export function tokenEstimate(text: string) {
  return Math.ceil(text.length / 4);
}

/** Task claims live with their task and are not budgeted. */
export function scopeBudget(budgets: MemoryBudgets, scope: MemoryScope) {
  return scope === 'task' ? 0 : budgets[scope];
}

/** How full a scope's budget is, 0 to 1. An unbudgeted scope is never full. */
export function summaryFill(summary: Pick<MemoryScopeSummary, 'tokens' | 'budget'>): number {
  return summary.budget > 0 ? Math.min(1, summary.tokens / summary.budget) : 0;
}

/**
 * How full each notebook is, from the active claims in the agent scope. Notebooks
 * have no summary query of their own, so the count is taken off the claims.
 */
export function notebookFills(claims: Memory[], budget: number): Map<string, number> {
  const tokens = new Map<string, number>();
  for (const claim of claims) {
    if (claim.scope !== 'agent' || claim.status !== 'active') continue;
    tokens.set(claim.scopeId, (tokens.get(claim.scopeId) ?? 0) + tokenEstimate(claim.text));
  }
  if (budget <= 0) return new Map();
  return new Map([...tokens].map(([id, used]) => [id, Math.min(1, used / budget)]));
}
