import { expect, it } from 'vitest';
import { initialTaskInput } from '../services/task-input';
import type { TaskContext } from '../services/types';

it('preserves unassigned input and supplies the recorded project brief as task context', () => {
  const task = { prompt: 'Review the pipeline.' } as TaskContext['task'];
  expect(initialTaskInput({ task })).toBe(task.prompt);
  const input = initialTaskInput({
    task,
    project: { id: 'project-1', name: 'Growth', brief: 'Prepare the weekly review.\nUse current records.' },
  });
  expect(input).toBe(
    'Project context\n{"name":"Growth","brief":"Prepare the weekly review.\\nUse current records."}\n\nTask\nReview the pipeline.',
  );
});
