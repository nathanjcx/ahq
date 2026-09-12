import type { TaskContext } from './types';

export function initialTaskInput(context: Pick<TaskContext, 'task' | 'floor'>): string {
  if (!context.floor) return context.task.prompt;
  return `Floor context\n${JSON.stringify({ name: context.floor.name, brief: context.floor.brief })}\n\nTask\n${context.task.prompt}`;
}
