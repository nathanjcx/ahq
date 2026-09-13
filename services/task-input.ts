import type { TaskContext } from './types';

export function initialTaskInput(context: Pick<TaskContext, 'task' | 'floor'>): string {
  const { task, floor } = context;
  const prompt = floor
    ? `Floor context\n${JSON.stringify({ name: floor.name, brief: floor.brief })}\n\nTask\n${task.prompt}`
    : task.prompt;
  // A retry opens a fresh session: nothing of the failed one is remembered, so the failure is said.
  return task.retriedAt === undefined
    ? prompt
    : `${prompt}\n\nA previous attempt at this task failed: ${task.error ?? 'the session ended in error'}. Take a different approach, or ask if you cannot.`;
}
