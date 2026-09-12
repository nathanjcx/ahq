import type { Project, Task } from '@/lib/contracts';

/** Statuses that keep an employee on the floor: work the workspace is still waiting on. */
export const ACTIVE_TASK_STATUSES: Task['status'][] = ['queued', 'running', 'awaiting_approval'];

export type TaskGroup = 'active' | 'awaiting' | 'done';
export type FloorSummary = { active: number; awaiting: number; done: number; lastActivity: number };
export type FloorEntry = { project: Project; number: string; summary: FloorSummary };

export function taskGroup(status: Task['status']): TaskGroup {
  if (status === 'awaiting_approval') return 'awaiting';
  return status === 'queued' || status === 'running' ? 'active' : 'done';
}

/** Task counts by group, and the floor's last activity. Floors without tasks fall back to their own edit time. */
export function summarizeFloor(project: Project, tasks: Task[]): FloorSummary {
  const summary: FloorSummary = { active: 0, awaiting: 0, done: 0, lastActivity: project.updatedAt };
  for (const task of tasks) {
    if (task.projectId !== project.id) continue;
    summary[taskGroup(task.status)] += 1;
    summary.lastActivity = Math.max(summary.lastActivity, task.updatedAt);
  }
  return summary;
}

export function countsLabel(summary: FloorSummary) {
  return `${summary.active} active · ${summary.awaiting} awaiting · ${summary.done} done`;
}
