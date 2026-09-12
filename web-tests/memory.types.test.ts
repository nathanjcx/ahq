import type { FunctionReturnType } from 'convex/server';
import { expectTypeOf, test } from 'vitest';
import { type api } from '../convex/_generated/api';
import type { JanitorLogEntry, Memory, MemoryScopeSummary, TaskSummary } from '../lib/contracts';
import type { WorkingMemoryInputs } from '../lib/server/memory';

/**
 * The Records room renders these shapes and the worker compiles from them, so the contracts are
 * asserted against the Convex functions rather than trusted to stay in step by hand.
 */
test('the memory functions satisfy the contracts the interface and the compiler read', () => {
  expectTypeOf<FunctionReturnType<typeof api.memory.list>>().toExtend<Memory[]>();
  expectTypeOf<FunctionReturnType<typeof api.memory.summaries>>().toExtend<MemoryScopeSummary[]>();
  expectTypeOf<FunctionReturnType<typeof api.memory.taskSummary>>().toExtend<TaskSummary | null>();
  expectTypeOf<FunctionReturnType<typeof api.memory.janitorLog>>().toExtend<JanitorLogEntry[]>();
  expectTypeOf<FunctionReturnType<typeof api.services.memory.recall>>().toExtend<Memory[]>();
  expectTypeOf<
    FunctionReturnType<typeof api.services.memory.compileInputs>
  >().toExtend<WorkingMemoryInputs>();
});
