import { randomUUID } from 'node:crypto';
import type { AppState } from '../shared/types';

export function restoreLaunchState(current: AppState, checkpoint: AppState, launchId: string): AppState {
  if (current.roadmap?.launchId !== launchId || checkpoint.roadmap?.launchId !== launchId) throw new Error('This checkpoint belongs to a different roadmap.');
  const owned = current.commitments.filter(task => task.launchId === launchId);
  const saved = checkpoint.commitments.filter(task => task.launchId === launchId);
  const taskIds = new Set([...owned, ...saved].map(task => task.id));
  const employeeIds = new Set([...owned, ...saved].map(task => task.ownerId));
  const unrelatedIds = current.roadmap.milestoneIds.filter(id => !taskIds.has(id));
  return {
    ...current,
    launchRestoreId: randomUUID(),
    commitments: [...current.commitments.filter(task => !taskIds.has(task.id)), ...saved],
    employees: [...current.employees.filter(employee => !employeeIds.has(employee.id)), ...checkpoint.employees.filter(employee => employeeIds.has(employee.id))],
    approvals: [...current.approvals.filter(approval => !approval.commitmentId || !taskIds.has(approval.commitmentId)), ...checkpoint.approvals.filter(approval => !!approval.commitmentId && taskIds.has(approval.commitmentId))],
    roadmap: {
      ...checkpoint.roadmap,
      milestoneIds: [...new Set([...unrelatedIds, ...checkpoint.roadmap.milestoneIds.filter(id => taskIds.has(id))])],
      assignments: [...current.roadmap.assignments.filter(assignment => !taskIds.has(assignment.commitmentId)), ...checkpoint.roadmap.assignments.filter(assignment => taskIds.has(assignment.commitmentId))],
    },
  };
}
