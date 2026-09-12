import type { TaskContext } from './types';

export function initialTaskInput(context: Pick<TaskContext, 'task' | 'project'>): string {
  if (!context.project) return context.task.prompt;
  return `Project context\n${JSON.stringify({ name: context.project.name, brief: context.project.brief })}\n\nTask\n${context.task.prompt}`;
}
