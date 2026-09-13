/**
 * The dependency graph, as pure functions over ids and statuses. Task release, roadmap confirmation,
 * and milestone status all reason about the same graph, so the rules live here and are unit tested.
 */

/** One node of the graph: a task or milestone id and the ids it waits for. */
export interface DependencyNode {
  id: string;
  dependsOn?: readonly string[];
}
/** A node with the status the platform gave it. */
export interface StatusNode extends DependencyNode {
  status: string;
}

/** Statuses that mean the work has begun, so the milestone holding it is under way. */
const STARTED = [
  'running',
  'awaiting_approval',
  'needs_input',
  'completed',
  'failed',
  'uncertain',
  'blocked',
];
/** Statuses that mean nothing more will happen to the task. */
const FINISHED = ['completed', 'cancelled'];

/**
 * Dependency-first order over the nodes, by Kahn's algorithm. Edges to ids outside the set are
 * ignored, so a partial graph orders fine; a cycle throws and names every node still caught in one.
 */
export function topologicalOrder(nodes: readonly DependencyNode[]): string[] {
  const known = new Set(nodes.map((node) => node.id));
  const pending = new Map(
    nodes.map((node) => [node.id, new Set((node.dependsOn ?? []).filter((id) => known.has(id)))]),
  );
  const order: string[] = [];
  for (let progressed = true; progressed;) {
    progressed = false;
    for (const [id, waitingFor] of pending) {
      if (waitingFor.size) continue;
      pending.delete(id);
      for (const other of pending.values()) other.delete(id);
      order.push(id);
      progressed = true;
    }
  }
  if (pending.size) throw new Error(`Dependency cycle through ${[...pending.keys()].join(', ')}`);
  return order;
}

/** Throws when the nodes contain a dependency cycle. */
export function assertAcyclic(nodes: readonly DependencyNode[]): void {
  topologicalOrder(nodes);
}

/** A task may start once every dependency it names has completed. */
export function readyToStart(
  task: DependencyNode,
  tasksById: ReadonlyMap<string, { status: string }>,
): boolean {
  return (task.dependsOn ?? []).every((id) => tasksById.get(id)?.status === 'completed');
}

/** The tasks that name this one as a dependency. */
export function dependentsOf<Node extends DependencyNode>(taskId: string, tasks: readonly Node[]): Node[] {
  return tasks.filter((task) => (task.dependsOn ?? []).includes(taskId));
}

/**
 * A milestone's live status from its tasks: done once every task has finished, active once any of
 * them has begun, planned while they all still wait. A milestone without tasks is planned.
 */
export function milestoneStatus(
  milestone: { taskIds: readonly string[] },
  tasks: readonly StatusNode[],
): 'planned' | 'active' | 'done' {
  const own = tasks.filter((task) => milestone.taskIds.includes(task.id));
  if (!own.length) return 'planned';
  if (own.every((task) => FINISHED.includes(task.status))) return 'done';
  return own.some((task) => STARTED.includes(task.status)) ? 'active' : 'planned';
}
