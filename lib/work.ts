import type { ActionProposal, Alert, Task } from './contracts';

/** A pending handoff, as the Work page lists it. Served by `work.pendingHandoffs`. */
export interface PendingHandoff {
  id: string;
  floorId: string;
  floorName: string;
  fromName: string;
  toEmployeeId: string;
  toEmployeeName: string;
  brief: string;
  sourceTaskId?: string;
  createdAt: number;
}

export type ThreadGroup = 'needs' | 'running' | 'waiting' | 'done';
export type ThreadTone = 'need' | 'run' | 'idle' | 'bad';

/** One row of the Work stream: what it is, who it is with, what it needs, and when it last moved. */
export interface Thread {
  id: string;
  kind: 'task' | 'handoff' | 'alert';
  group: ThreadGroup;
  /** The employee the thread is with; a person for a handoff request. */
  who: string;
  employeeId?: string;
  title: string;
  preview: string;
  tone: ThreadTone;
  label: string;
  at: number;
  taskId?: string;
  handoff?: PendingHandoff;
  alert?: Alert;
}

const GROUP_ORDER: ThreadGroup[] = ['needs', 'running', 'waiting', 'done'];

export const GROUP_LABELS: Record<ThreadGroup, string> = {
  needs: 'Needs you',
  running: 'Running',
  waiting: 'Waiting on others',
  done: 'Done today',
};

/** An employee's last line that ends in a question is a question for the person, whatever the status. */
function asksAQuestion(task: Task) {
  const text = task.lastMessage?.text.trim() ?? '';
  return text.endsWith('?') && (task.lastMessage?.phase === 'final_answer' || task.status === 'completed');
}

function taskThread(task: Task, pending: ActionProposal[], dayStart: number): Thread | null {
  const preview = task.lastMessage?.text ?? task.prompt;
  const base = {
    id: `task:${task.id}`,
    kind: 'task' as const,
    who: task.employeeName,
    employeeId: task.employeeId,
    title: task.title,
    preview,
    at: task.updatedAt,
    taskId: task.id,
  };
  if (pending.length)
    return {
      ...base,
      group: 'needs',
      tone: 'need',
      label: pending.length === 1 ? 'Approval' : `${pending.length} approvals`,
      preview: pending[0].summary || preview,
    };
  if (task.status === 'awaiting_approval')
    return { ...base, group: 'needs', tone: 'need', label: 'Approval' };
  if (asksAQuestion(task)) return { ...base, group: 'needs', tone: 'need', label: 'Question for you' };
  if (task.status === 'queued' || task.status === 'running')
    return {
      ...base,
      group: 'running',
      tone: 'run',
      label: task.status === 'queued' ? 'Starting' : 'Working',
    };
  if (task.status === 'waiting')
    return { ...base, group: 'waiting', tone: 'idle', label: 'Waiting on a task' };
  if (task.status === 'blocked') return { ...base, group: 'waiting', tone: 'bad', label: 'Blocked' };
  if (task.status === 'uncertain') return { ...base, group: 'needs', tone: 'bad', label: 'Outcome unknown' };
  if (task.updatedAt < dayStart) return null;
  if (task.status === 'failed') return { ...base, group: 'done', tone: 'bad', label: 'Failed' };
  if (task.status === 'cancelled') return { ...base, group: 'done', tone: 'idle', label: 'Cancelled' };
  return { ...base, group: 'done', tone: 'idle', label: 'Done' };
}

/**
 * The stream, in the order a person reads it: what needs them, what is running, what is waiting on
 * someone else, and what finished today. Hidden session tasks (meetings, audits, standing sessions)
 * never appear; their outcomes reach the person through reports and findings.
 */
export function buildThreads(input: {
  tasks: Task[];
  proposals: ActionProposal[];
  handoffs: PendingHandoff[];
  alerts: Alert[];
  now: number;
}): Thread[] {
  const dayStart = new Date(input.now).setHours(0, 0, 0, 0);
  const pendingByTask = new Map<string, ActionProposal[]>();
  for (const proposal of input.proposals) {
    if (proposal.status !== 'pending') continue;
    pendingByTask.set(proposal.taskId, [...(pendingByTask.get(proposal.taskId) ?? []), proposal]);
  }
  const threads: Thread[] = [];
  for (const task of input.tasks) {
    if (task.kind && task.kind !== 'work') continue;
    const thread = taskThread(task, pendingByTask.get(task.id) ?? [], dayStart);
    if (thread) threads.push(thread);
  }
  for (const handoff of input.handoffs)
    threads.push({
      id: `handoff:${handoff.id}`,
      kind: 'handoff',
      group: 'needs',
      who: handoff.fromName,
      title: `Handoff to ${handoff.toEmployeeName}`,
      preview: handoff.brief,
      tone: 'need',
      label: 'Handoff request',
      at: handoff.createdAt,
      handoff,
    });
  for (const alert of input.alerts) {
    if (alert.status !== 'open' && alert.status !== 'triaging') continue;
    threads.push({
      id: `alert:${alert.id}`,
      kind: 'alert',
      group: 'needs',
      who: 'Triage',
      title: alert.title,
      preview: alert.detail,
      tone: 'bad',
      label: alert.status === 'triaging' ? 'Incident, triage running' : 'Incident',
      at: alert.updatedAt,
      alert,
    });
  }
  return threads.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || b.at - a.at);
}
