import type { FixtureQueries } from '@/components/shared/use-ui-query';
import type { AgendaSuggestion, Attendee, CalendarEntry } from '@/lib/contracts';

/**
 * A working week on the calendar: shifts on every instance, two deadlines, the nightly audit, and
 * three meetings in three different states. Unlike the dashboard fixture this one is anchored to the
 * real week, because the calendar opens on today and an empty grid photographs nothing.
 */
const HOUR = 3_600_000;
const DAY = 86_400_000;

function mondayOfThisWeek() {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  return midnight.getTime() - ((midnight.getDay() + 6) % 7) * DAY;
}
const monday = mondayOfThisWeek();
/** An instant this week, by weekday index from Monday and the hour of the local day. */
const at = (day: number, hour: number, minute = 0) => monday + day * DAY + hour * HOUR + minute * 60_000;
/** The same, on whatever day the fixture is being read, so the day view is never empty. */
const todayIndex = (new Date().getDay() + 6) % 7;
const todayAt = (hour: number, minute = 0) => at(todayIndex, hour, minute);
/** The hour the live meeting is in, so it reads as happening now whenever this is opened. */
const thisHour = new Date().getHours();

const person = { kind: 'person', id: 'user_sam', name: 'Sam Okafor' } as const;
const ada = { kind: 'employee', id: 'emp_ada', name: 'Ada' } as const;
const bruno = { kind: 'employee', id: 'emp_bruno', name: 'Bruno' } as const;
const cyrus = { kind: 'employee', id: 'emp_cyrus', name: 'Cyrus' } as const;
const emi = { kind: 'employee', id: 'emp_emi', name: 'Emi' } as const;
const fen = { kind: 'employee', id: 'emp_fen', name: 'Fen' } as const;
const gil = { kind: 'employee', id: 'emp_gil', name: 'Gil' } as const;
const hana = { kind: 'employee', id: 'emp_hana', name: 'Hana' } as const;
const mina = { kind: 'employee', id: 'emp_mina', name: 'Mina' } as const;
const auditor = { kind: 'employee', id: 'emp_auditor', name: 'Ives' } as const;

const SHIFTS: [attendee: Attendee, title: string, day: number, from: number, to: number][] = [
  [ada, 'Open launch blockers', 0, 9, 13],
  [ada, 'Open launch blockers', 1, 9, 12],
  [ada, 'Open launch blockers', 3, 9.5, 13],
  [bruno, 'Migration notes', 0, 10, 14],
  [bruno, 'Migration notes', 1, 9, 15],
  [bruno, 'Migration notes', 2, 9, 16],
  [cyrus, 'Backfill the events table', 1, 13, 17.5],
  [cyrus, 'Backfill the events table', 3, 10, 17],
  [emi, 'Release notes layout', 0, 14, 17],
  [emi, 'Release notes layout', 2, 13, 18],
  [fen, 'Regression pass', 2, 9, 12],
  [fen, 'Regression pass', 4, 9, 14],
  [gil, 'Quarter spend review', 1, 10, 12],
  [hana, 'Pricing research', 3, 13, 17],
  [mina, 'Support triage', 4, 9, 13],
];

/** Today's shifts are written out below, so the week's own rows leave that day to them. */
const shifts: CalendarEntry[] = SHIFTS.filter(([, , day]) => day !== todayIndex).map(
  ([attendee, title, day, from, to], index): CalendarEntry => ({
    id: `shift:${index}`,
    kind: 'shift',
    title,
    startsAt: at(day, Math.floor(from), (from % 1) * 60),
    endsAt: at(day, Math.floor(to), (to % 1) * 60),
    attendees: [attendee],
    agenda: [],
    status: at(day, to) < Date.now() ? 'done' : 'scheduled',
    taskId: 'task_running',
  }),
);

const TODAY_SHIFTS: [attendee: Attendee, title: string, from: number, to: number][] = [
  [ada, 'Open launch blockers', 9, 12.5],
  [bruno, 'Migration notes', 9.5, 14],
  [emi, 'Release notes layout', 13, 17],
  [cyrus, 'Backfill the events table', 14, 18],
];

const entries: CalendarEntry[] = [
  ...shifts,
  ...TODAY_SHIFTS.map(([attendee, title, from, to], index): CalendarEntry => ({
    id: `shift:today-${index}`,
    kind: 'shift',
    title,
    startsAt: todayAt(Math.floor(from), (from % 1) * 60),
    endsAt: todayAt(Math.floor(to), (to % 1) * 60),
    attendees: [attendee],
    agenda: [],
    status: todayAt(to) < Date.now() ? 'done' : 'scheduled',
    taskId: 'task_running',
  })),
  {
    id: 'deadline:task_running',
    kind: 'deadline',
    title: 'Migration notes due',
    startsAt: at(2, 17),
    endsAt: at(2, 17),
    taskId: 'task_running',
    floorId: 'proj_launch',
    attendees: [bruno],
    agenda: [],
    status: 'scheduled',
  },
  {
    id: 'deadline:milestone_rc',
    kind: 'deadline',
    title: 'Spring launch: release candidate',
    startsAt: at(4, 12),
    endsAt: at(4, 12),
    projectId: 'proj_launch',
    attendees: [],
    agenda: [],
    status: 'scheduled',
  },
  {
    id: 'audit:tuesday',
    kind: 'audit',
    title: 'Nightly audit',
    startsAt: at(1, 18),
    endsAt: at(2, 9),
    attendees: [auditor],
    agenda: [],
    status: 'done',
  },
  {
    id: 'cal_standup',
    kind: 'meeting',
    title: 'Launch stand-up',
    startsAt: todayAt(Math.min(21, thisHour + 4)),
    endsAt: todayAt(Math.min(21, thisHour + 4), 30),
    floorId: 'proj_launch',
    attendees: [person, ada, bruno],
    agenda: ['Where the migration notes stand', 'Anything still blocking the release candidate'],
    purpose: 'Confirm the release candidate still lands on Friday.',
    status: 'scheduled',
    meetingId: 'meet_standup',
  },
  {
    id: 'cal_launch',
    kind: 'meeting',
    title: 'Spring launch review',
    startsAt: todayAt(thisHour),
    endsAt: todayAt(thisHour + 1),
    projectId: 'proj_launch',
    floorId: 'proj_launch',
    attendees: [person, ada, bruno, emi],
    agenda: [
      'Migration notes are due before this meeting',
      'Bruno reports the changelog is behind',
      'Open finding: two claims in the last report are not in the journal',
    ],
    purpose: 'Decide what ships on the first and who owns the gaps.',
    status: 'live',
    meetingId: 'meet_launch',
  },
  {
    id: 'cal_retro',
    kind: 'meeting',
    title: 'February retrospective',
    startsAt: todayAt(Math.max(7, thisHour - 3)),
    endsAt: todayAt(Math.max(7, thisHour - 3) + 1),
    floorId: 'proj_support',
    attendees: [person, cyrus, fen],
    agenda: ['What the backfill cost', 'The two regressions that reached customers'],
    purpose: 'Agree what changes before the next release.',
    status: 'done',
    meetingId: 'meet_retro',
  },
];

const suggestions: AgendaSuggestion[] = [
  { text: 'Migration notes is due before this meeting', reason: 'deadline', refId: 'task_running' },
  { text: 'Milestone Release candidate is due before this meeting', reason: 'milestone' },
  { text: 'Bruno reports Draft the migration notes is behind', reason: 'behind', refId: 'task_running' },
  { text: 'Contested: the events table is backfilled through January', reason: 'contested' },
  { text: 'Open finding: two claims in the last report are not in the journal', reason: 'finding' },
  { text: 'Open alert: ENG-4131 Migration script fails on empty tables', reason: 'alert' },
];

export const calendarQueries: FixtureQueries = {
  'calendar:entries': (args: unknown) => {
    const { from, to } = args as { from: number; to: number };
    return entries.filter((entry) => entry.startsAt >= from && entry.startsAt <= to);
  },
  'calendar:suggestAgenda': suggestions,
};
