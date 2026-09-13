import type { Floor, Task } from '@/lib/contracts';

/** Statuses that keep an employee on the floor: work the workspace is still waiting on. */
export const ACTIVE_TASK_STATUSES: Task['status'][] = [
  'queued',
  'running',
  'awaiting_approval',
  'needs_input',
];

type TaskGroup = 'active' | 'awaiting' | 'done';
export type FloorSummary = { active: number; awaiting: number; done: number; lastActivity: number };
export type FloorEntry = { floor: Floor; number: string; summary: FloorSummary };

function taskGroup(status: Task['status']): TaskGroup {
  if (status === 'awaiting_approval' || status === 'needs_input') return 'awaiting';
  return status === 'queued' || status === 'running' ? 'active' : 'done';
}

/** Task counts by group, and the floor's last activity. Floors without tasks fall back to their own edit time. */
export function summarizeFloor(floor: Floor, tasks: Task[]): FloorSummary {
  const summary: FloorSummary = { active: 0, awaiting: 0, done: 0, lastActivity: floor.updatedAt };
  for (const task of tasks) {
    if (task.floorId !== floor.id) continue;
    summary[taskGroup(task.status)] += 1;
    summary.lastActivity = Math.max(summary.lastActivity, task.updatedAt);
  }
  return summary;
}

export function countsLabel(summary: FloorSummary) {
  return `${summary.active} active · ${summary.awaiting} awaiting · ${summary.done} done`;
}
