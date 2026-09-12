import type { FunctionReturnType } from 'convex/server';
import { expectTypeOf, test } from 'vitest';
import { type api } from '../convex/_generated/api';
import type {
  AgendaSuggestion,
  CalendarEntry,
  Pacing,
  PlanProjection,
  ScheduleSummary,
  WorkspaceSettings,
} from '../lib/contracts';

/**
 * The schedule, calendar, and plan queries the interface reads, held to the contracts it renders.
 * Convex returns branded `Id` values where the contracts say `string`, which satisfies them.
 */
test('every schedule and calendar query the interface reads satisfies its UI contract', () => {
  expectTypeOf<FunctionReturnType<typeof api.schedule.settings>>().toExtend<WorkspaceSettings>();
  expectTypeOf<FunctionReturnType<typeof api.schedule.summary>>().toExtend<ScheduleSummary>();
  expectTypeOf<FunctionReturnType<typeof api.plan.projection>>().toExtend<PlanProjection>();
  expectTypeOf<FunctionReturnType<typeof api.calendar.entries>>().toExtend<CalendarEntry[]>();
  expectTypeOf<FunctionReturnType<typeof api.calendar.suggestAgenda>>().toExtend<AgendaSuggestion[]>();
});

/** The worker asks for pacing by task; the answer is the same word the office shows. */
test('the pacing service query answers with the pacing contract', () => {
  expectTypeOf<FunctionReturnType<typeof api.services.schedule.pacing>['pacing']>().toExtend<Pacing>();
});
