import type { FunctionReturnType } from 'convex/server';
import { expectTypeOf, test } from 'vitest';
import { type api } from '../convex/_generated/api';
import type {
  Alert,
  Channel,
  IncidentReport,
  Notification,
  Post,
  TriageEvent,
  TriageIntake,
} from '../lib/contracts';

/**
 * The channels and triage contracts are what the interface renders. These assertions fail the build
 * the moment a Convex function stops producing them, the way contracts.types.test.ts does for core.
 */
test('every channels and triage query the interface reads satisfies its UI contract', () => {
  expectTypeOf<FunctionReturnType<typeof api.channels.list>>().toExtend<Channel[]>();
  expectTypeOf<FunctionReturnType<typeof api.channels.posts>>().toExtend<Post[]>();
  expectTypeOf<FunctionReturnType<typeof api.channels.employeeFeed>>().toExtend<Post[]>();
  expectTypeOf<FunctionReturnType<typeof api.triage.alerts>>().toExtend<Alert[]>();
  expectTypeOf<FunctionReturnType<typeof api.triage.timeline>>().toExtend<TriageEvent[]>();
  expectTypeOf<FunctionReturnType<typeof api.triage.incidentReports>>().toExtend<IncidentReport[]>();
  expectTypeOf<FunctionReturnType<typeof api.triage.intake>>().toExtend<TriageIntake>();
  expectTypeOf<FunctionReturnType<typeof api.notifications.list>>().toExtend<Notification[]>();
});
