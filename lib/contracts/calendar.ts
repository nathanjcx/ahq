export type CalendarKind = 'deadline' | 'meeting' | 'audit' | 'shift';
export type CalendarStatus = 'scheduled' | 'live' | 'done' | 'cancelled';
export interface Attendee {
  kind: 'employee' | 'person';
  id: string;
  name: string;
}
export interface CalendarEntry {
  id: string;
  kind: CalendarKind;
  title: string;
  startsAt: number;
  endsAt: number;
  projectId?: string;
  floorId?: string;
  taskId?: string;
  attendees: Attendee[];
  agenda: string[];
  purpose?: string;
  status: CalendarStatus;
  meetingId?: string;
}
/** Suggested agenda for a meeting at a time, from work due before it. */
export interface AgendaSuggestion {
  text: string;
  reason: 'deadline' | 'behind' | 'contested' | 'finding' | 'alert' | 'milestone';
  refId?: string;
}
