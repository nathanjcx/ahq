import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();
crons.interval(
  'wake workers for due jobs and lease recovery',
  { minutes: 1 },
  internal.maintenance.wakeWorkers,
);
crons.interval('plan and enqueue the schedule', { minutes: 5 }, internal.services.schedule.tick);

export default crons;
