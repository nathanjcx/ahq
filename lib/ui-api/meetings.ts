import { api } from '@/convex/_generated/api';

/** Convex references for the meetings domain, under the names the UI uses. */
export const meetingsApi = {
  meeting: api.meetings.get,
  ensureMeeting: api.meetings.ensure,
  openMeeting: api.meetings.open,
  askMeeting: api.meetings.ask,
  closeMeeting: api.meetings.close,
  confirmOutcome: api.meetings.confirmOutcome,
  dismissOutcome: api.meetings.dismissOutcome,
  finalizeMeeting: api.meetings.finalize,
} as const;
