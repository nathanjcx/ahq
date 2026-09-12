import type { FixtureQueries } from '@/components/shared/use-ui-query';
import type { Meeting, MeetingTurn } from '@/lib/contracts';

/**
 * Two boardrooms to photograph: one in session with preparation, questions, and what they cost, and
 * one closed on outcomes a person has half decided. The third meeting on the calendar has never been
 * opened, so it answers with nothing and the room offers to open itself.
 */
const MINUTE = 60_000;
const openedAt = Date.now() - 26 * MINUTE;
const after = (minutes: number) => openedAt + minutes * MINUTE;

const launchTurns: MeetingTurn[] = [
  {
    id: 'turn_prep_ada',
    kind: 'report',
    authorName: 'Ada',
    employeeId: 'emp_ada',
    text: 'Blockers standing: the migration script fails on empty tables, and the changelog still has three entries without owners. Everything else on the release checklist is green. I can clear the changelog myself if nobody else picks it up today.',
    createdAt: after(-58),
  },
  {
    id: 'turn_prep_bruno',
    kind: 'report',
    authorName: 'Bruno',
    employeeId: 'emp_bruno',
    text: 'Migration notes are two sections short: the rollback path and the empty-table case. I will not finish both before Wednesday five o’clock at my current pace. Confidence in the deadline is low. I would rather move the deadline by a day than ship notes that skip rollback.',
    createdAt: after(-54),
  },
  {
    id: 'turn_prep_emi',
    kind: 'report',
    authorName: 'Emi',
    employeeId: 'emp_emi',
    text: 'The release notes layout is done and reviewed. It renders with an empty changelog, so a late entry does not break the page.',
    createdAt: after(-51),
  },
  {
    id: 'turn_q1',
    kind: 'question',
    authorName: 'Sam Okafor',
    authorSubject: 'user_sam',
    text: 'What actually has to be true for the release candidate to land on Friday?',
    createdAt: after(2),
  },
  {
    id: 'turn_a1_ada',
    kind: 'answer',
    authorName: 'Ada',
    employeeId: 'emp_ada',
    inReplyTo: 'turn_q1',
    text: 'The migration script has to survive an empty table, and the three unowned changelog entries need owners. Both are half a day.',
    usage: { input: 8_420, cached: 6_100, output: 190 },
    createdAt: after(3),
  },
  {
    id: 'turn_a1_bruno',
    kind: 'answer',
    authorName: 'Bruno',
    employeeId: 'emp_bruno',
    inReplyTo: 'turn_q1',
    text: 'The notes have to cover rollback. Without that the candidate is not shippable even if the code is.',
    usage: { input: 8_390, cached: 6_100, output: 160 },
    createdAt: after(3),
  },
  {
    id: 'turn_a1_emi',
    kind: 'answer',
    authorName: 'Emi',
    employeeId: 'emp_emi',
    inReplyTo: 'turn_q1',
    text: 'Nothing from my side. The layout is ready and does not block.',
    usage: { input: 8_310, cached: 6_100, output: 90 },
    createdAt: after(4),
  },
  {
    id: 'turn_q2',
    kind: 'question',
    authorName: 'Sam Okafor',
    authorSubject: 'user_sam',
    addressedTo: ['emp_bruno'],
    text: 'If the deadline moves to Thursday, does rollback get written properly, or do we still end up short?',
    createdAt: after(9),
  },
  {
    id: 'turn_a2_bruno',
    kind: 'answer',
    authorName: 'Bruno',
    employeeId: 'emp_bruno',
    inReplyTo: 'turn_q2',
    text: 'Thursday is enough. Rollback is one section and I already have the commands from the staging run; what I do not have is the empty-table case, which needs Cyrus to tell me what the script does today. Give me Thursday and I will have both, reviewed.',
    usage: { input: 11_940, cached: 9_200, output: 410 },
    createdAt: after(10),
  },
];

const retroTurns: MeetingTurn[] = [
  {
    id: 'turn_prep_cyrus',
    kind: 'report',
    authorName: 'Cyrus',
    employeeId: 'emp_cyrus',
    text: 'The backfill cost 4.2 million tokens against a 3 million estimate. The overrun is entirely the retry loop on rows the source system returns twice.',
    createdAt: after(-1_400),
  },
  {
    id: 'turn_prep_fen',
    kind: 'report',
    authorName: 'Fen',
    employeeId: 'emp_fen',
    text: 'Two regressions reached customers. Both were covered by tests that existed and were skipped in CI for eleven days without anyone noticing.',
    createdAt: after(-1_396),
  },
  {
    id: 'turn_q_retro',
    kind: 'question',
    authorName: 'Sam Okafor',
    authorSubject: 'user_sam',
    text: 'What stops the skipped-test problem happening again?',
    createdAt: after(-1_380),
  },
  {
    id: 'turn_a_retro_fen',
    kind: 'answer',
    authorName: 'Fen',
    employeeId: 'emp_fen',
    inReplyTo: 'turn_q_retro',
    text: 'A check that fails the build when the skipped count goes up. It is a short job and I can write it this week.',
    usage: { input: 9_640, cached: 7_400, output: 220 },
    createdAt: after(-1_379),
  },
  {
    id: 'turn_out_task',
    kind: 'outcome',
    authorName: 'Fen',
    employeeId: 'emp_fen',
    text: 'Fail the build when the number of skipped tests increases.',
    outcome: {
      kind: 'task',
      payload: JSON.stringify({
        title: 'Fail CI on a rising skipped-test count',
        prompt:
          'Add a CI check that compares the skipped-test count against the base branch and fails when it rises.',
        employeeId: 'emp_fen',
      }),
      status: 'confirmed',
    },
    createdAt: after(-1_360),
  },
  {
    id: 'turn_out_meeting',
    kind: 'outcome',
    authorName: 'Cyrus',
    employeeId: 'emp_cyrus',
    text: 'Review the backfill spend again once the retry loop is fixed.',
    outcome: {
      kind: 'meeting',
      payload: JSON.stringify({
        title: 'Backfill spend review',
        startsAt: openedAt,
        endsAt: openedAt + 30 * MINUTE,
        agenda: ['Token cost after the retry fix'],
        attendees: ['emp_cyrus'],
      }),
      status: 'proposed',
    },
    createdAt: after(-1_358),
  },
  {
    id: 'turn_out_note',
    kind: 'outcome',
    authorName: 'Cyrus',
    employeeId: 'emp_cyrus',
    text: 'Remember that the source system returns duplicate rows for anything edited twice in a day.',
    outcome: {
      kind: 'note',
      payload: JSON.stringify({ text: 'The source system returns duplicate rows for same-day edits.' }),
      status: 'proposed',
    },
    createdAt: after(-1_356),
  },
  {
    id: 'turn_out_deadline',
    kind: 'outcome',
    authorName: 'Fen',
    employeeId: 'emp_fen',
    text: 'Move the regression pass a week later to make room for the CI work.',
    outcome: {
      kind: 'deadline',
      payload: JSON.stringify({ taskId: 'task_running', deadlineAt: openedAt + 7 * 86_400_000 }),
      status: 'dismissed',
    },
    createdAt: after(-1_354),
  },
];

const meetings: Record<string, Meeting> = {
  cal_launch: {
    id: 'meet_launch',
    calendarEntryId: 'cal_launch',
    status: 'live',
    openedBy: 'user_sam',
    openedAt,
    usage: { input: 46_700, cached: 35_000, output: 1_070 },
    turns: launchTurns,
  },
  cal_retro: {
    id: 'meet_retro',
    calendarEntryId: 'cal_retro',
    status: 'closed',
    openedBy: 'user_sam',
    openedAt: after(-1_410),
    closedAt: after(-1_350),
    usage: { input: 31_200, cached: 24_800, output: 940 },
    turns: retroTurns,
  },
};

export const meetingsQueries: FixtureQueries = {
  'meetings:get': (args: unknown) => meetings[(args as { calendarEntryId: string }).calendarEntryId] ?? null,
};
