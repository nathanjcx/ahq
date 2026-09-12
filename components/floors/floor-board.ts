import type { BoardCard, BoardStatus } from '../office/office-layout';
import type { Task, TaskStatus } from '@/lib/contracts';

/**
 * How a task reads as a card. Work that is finished with is off the board: a failed or cancelled
 * task is not something the floor is carrying.
 */
const CARD_STATUS: Partial<Record<TaskStatus, BoardStatus>> = {
  queued: 'active',
  running: 'active',
  awaiting_approval: 'active',
  waiting: 'waiting',
  blocked: 'blocked',
  completed: 'done',
};

/**
 * The floor's wall board. A card's id is its task's id, which is what lets the string from somebody
 * waiting reach the card they are waiting on, and what makes a card's `dependsOn` name other cards.
 */
export function boardCards(tasks: Task[]): BoardCard[] {
  return tasks.flatMap((task) => {
    const status = CARD_STATUS[task.status];
    if (!status) return [];
    return [{ id: task.id, title: task.title, status, dependsOn: task.dependsOn ?? [] }];
  });
}
