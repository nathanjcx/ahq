import { api } from '@/convex/_generated/api';

/** Convex references for the calendar domain. The generated references keep the names honest. */
export const calendarApi = {
  calendarEntries: api.calendar.entries,
  createMeeting: api.calendar.createMeeting,
  updateMeeting: api.calendar.updateMeeting,
  cancelMeeting: api.calendar.cancelMeeting,
  suggestAgenda: api.calendar.suggestAgenda,
} as const;
