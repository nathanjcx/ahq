import { auditQueries } from './audit';
import { calendarQueries } from './calendar';
import { channelsQueries } from './channels';
import { employeesQueries } from './employees';
import { meetingsQueries } from './meetings';
import { memoryQueries } from './memory';
import { projectsQueries } from './projects';
import { scheduleQueries } from './schedule';
import { triageQueries } from './triage';
import type { FixtureQueries } from '@/components/shared/use-ui-query';

/** Every page-owned query the fixture route answers, keyed by Convex function name. */
export const fixtureQueries: FixtureQueries = {
  ...projectsQueries,
  ...calendarQueries,
  ...meetingsQueries,
  ...channelsQueries,
  ...memoryQueries,
  ...auditQueries,
  ...triageQueries,
  ...scheduleQueries,
  ...employeesQueries,
};
