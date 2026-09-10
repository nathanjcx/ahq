import type { Commitment } from '../../shared/types';

function indexDependencies(commitments: Commitment[]) {
  const milestones = new Map<string, Commitment>();
  const dependents = new Map<string, Set<string>>();
  for (const milestone of commitments) {
    if (!milestone.id) continue;
    if (!milestones.has(milestone.id)) milestones.set(milestone.id, milestone);
    // Merge edges from duplicate records so an older copy cannot conceal a cycle.
    for (const dependency of milestone.dependencies ?? []) {
      if (!dependents.has(dependency)) dependents.set(dependency, new Set());
      dependents.get(dependency)!.add(milestone.id);
    }
  }
  return { milestones, dependents };
}

function descendants(dependents: Map<string, Set<string>>, milestoneId: string) {
  const excluded = new Set<string>();
  const pending = [milestoneId];
  while (pending.length) {
    const id = pending.pop()!;
    if (excluded.has(id)) continue;
    excluded.add(id);
    for (const dependent of dependents.get(id) ?? []) pending.push(dependent);
  }
  return excluded;
}

/** Keep dependencies that would not make this milestone depend on its own later work. */
export function dependencyCandidates(commitments: Commitment[], editingId?: string): Commitment[] {
  const { milestones, dependents } = indexDependencies(commitments);
  const excluded = editingId ? descendants(dependents, editingId) : new Set<string>();
  return [...milestones.values()].filter((milestone) => !excluded.has(milestone.id));
}

/** Validate a replacement dependency list, including when creating a new milestone. */
export function validateDependencies(
  commitments: Commitment[],
  milestoneId: string,
  dependencyIds: string[],
): boolean {
  if (!milestoneId || new Set(dependencyIds).size !== dependencyIds.length) return false;
  const { milestones, dependents } = indexDependencies(commitments);
  const excluded = descendants(dependents, milestoneId);
  return dependencyIds.every((id) => milestones.has(id) && !excluded.has(id));
}
