import {
  GATHER_MS,
  deriveActivities,
  deriveFloorSignals,
  type DayInput,
  type EmployeeActivity,
  type FloorSignals,
  type MeetingInput,
  type ShiftBlock,
} from './activity';
import type { Alert, AuditFinding, Notification, ScheduleSummary, Task } from '@/lib/contracts';

/**
 * A day on a floor, replayed.
 *
 * Everything a recorded day holds already carries the time it happened at, so
 * the day at any instant is the record with everything later cut away. The
 * figures then come from the same derivation the live office uses, which is
 * what keeps a replay honest: it cannot show a day the office could not.
 */
export interface DayRecord {
  /** Local midnight the day starts at. */
  from: number;
  /** The end of the day, exclusive. */
  to: number;
  employees: { id: string; name: string }[];
  schedule?: ScheduleSummary;
  /** The day's sessions: work, and the audit, curation and triage runs beside it. */
  tasks: Task[];
  shifts: ShiftBlock[];
  meetings: MeetingInput[];
  findings: AuditFinding[];
  alerts: Alert[];
  notifications: Notification[];
}

export const DAY_MS = 86_400_000;

/** Local midnight before `at`. */
export function startOfDay(at: number): number {
  return new Date(at).setHours(0, 0, 0, 0);
}

/** The day before the one `now` falls in, which is what a Yesterday button means. */
export function yesterday(now: number): { from: number; to: number } {
  const midnight = startOfDay(now);
  return { from: midnight - DAY_MS, to: midnight };
}

/** The day a `yyyy-mm-dd` date names, in the viewer's own clock. */
export function dayOf(date: string): { from: number; to: number } | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return undefined;
  const from = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
  return Number.isNaN(from) ? undefined : { from, to: from + DAY_MS };
}

/** The record as it stood at one instant: everything recorded later is cut away. */
export function dayInputAt(record: DayRecord, at: number): DayInput {
  const shifts: ShiftBlock[] = record.shifts
    .filter((shift) => shift.startedAt <= at)
    .map((shift) => ({
      employeeId: shift.employeeId,
      ...(shift.taskId ? { taskId: shift.taskId } : {}),
      startedAt: shift.startedAt,
      ...(shift.endedAt !== undefined && shift.endedAt <= at ? { endedAt: shift.endedAt } : {}),
    }));

  const meetings: MeetingInput[] = record.meetings
    .filter((item) => at >= item.entry.startsAt - GATHER_MS)
    .map(({ entry, meeting }) => {
      if (!meeting) return { entry };
      const turns = meeting.turns.filter((turn) => turn.createdAt <= at);
      const opened = meeting.openedAt !== undefined && meeting.openedAt <= at;
      const closed = meeting.closedAt !== undefined && meeting.closedAt <= at;
      return {
        entry: { ...entry, status: closed ? 'done' : opened ? 'live' : entry.status },
        meeting: { ...meeting, status: closed ? 'closed' : opened ? 'live' : 'ready', turns },
      };
    });

  return {
    ...(record.schedule ? { schedule: { ...record.schedule, working: isWorkingAt(record.schedule, at) } } : {}),
    shifts,
    meetings,
    findings: record.findings
      .filter((item) => item.createdAt <= at)
      .map((item) =>
        item.updatedAt <= at ? item : { ...item, status: 'open' as const, updatedAt: item.createdAt },
      ),
    alerts: record.alerts
      .filter((item) => item.createdAt <= at)
      .map((item) =>
        item.updatedAt <= at ? item : { ...item, status: 'open' as const, updatedAt: item.createdAt },
      ),
    notifications: record.notifications
      .filter((item) => item.sentAt <= at)
      .map(({ acknowledgedAt, ...notice }) => ({
        ...notice,
        ...(acknowledgedAt !== undefined && acknowledgedAt <= at ? { acknowledgedAt } : {}),
      })),
  };
}

/** The office at one instant of a recorded day: what everybody was doing, and what the room showed. */
export function dayAt(
  record: DayRecord,
  floorId: string | undefined,
  at: number,
): { activities: Map<string, EmployeeActivity>; signals: FloorSignals; day: DayInput } {
  const day = dayInputAt(record, at);
  return {
    activities: deriveActivities({
      employees: record.employees,
      tasks: record.tasks.flatMap((task) => taskAsOf(task, at) ?? []),
      events: [],
      proposals: [],
      posts: [],
      now: at,
      day,
    }),
    signals: deriveFloorSignals(day, floorId, at),
    day,
  };
}

/** One thing that happened, at the minute it happened. */
export type Moment = { at: number; text: string };

/**
 * The day as a list, oldest first: shifts opening and closing, the meeting, the
 * findings the night wrote, the alerts, and any emergency the ledger recorded.
 */
export function dayMoments(record: DayRecord): Moment[] {
  const names = new Map(record.employees.map((employee) => [employee.id, employee.name]));
  const name = (id: string) => names.get(id) ?? 'Someone';
  const moments: Moment[] = [];

  for (const shift of record.shifts) {
    moments.push({ at: shift.startedAt, text: `${name(shift.employeeId)} started a shift` });
    if (shift.endedAt !== undefined)
      moments.push({ at: shift.endedAt, text: `${name(shift.employeeId)} ended a shift` });
  }
  for (const { entry, meeting } of record.meetings) {
    moments.push({ at: entry.startsAt, text: `${entry.title} starts` });
    if (meeting?.openedAt !== undefined) moments.push({ at: meeting.openedAt, text: `${entry.title} opened` });
    for (const turn of meeting?.turns ?? [])
      if (turn.kind === 'question' || turn.kind === 'answer')
        moments.push({
          at: turn.createdAt,
          text: `${turn.authorName} ${turn.kind === 'question' ? 'asked' : 'answered'}: ${turn.text}`,
        });
    if (meeting?.closedAt !== undefined) moments.push({ at: meeting.closedAt, text: `${entry.title} closed` });
  }
  for (const task of record.tasks)
    if (task.kind && task.kind !== 'work')
      moments.push({ at: task.createdAt, text: `${task.employeeName} opened a ${task.kind} run` });
  for (const finding of record.findings)
    moments.push({ at: finding.createdAt, text: `Finding on ${finding.employeeName}: ${finding.claim}` });
  for (const alert of record.alerts) moments.push({ at: alert.createdAt, text: `Alert: ${alert.title}` });
  for (const notice of record.notifications)
    if (notice.attempt >= 3) moments.push({ at: notice.sentAt, text: `Emergency: ${notice.title}` });

  return moments
    .filter((moment) => moment.at >= record.from && moment.at < record.to)
    .sort((a, b) => a.at - b.at || (a.text < b.text ? -1 : 1));
}

/** The latest moment at or before `at`, which is what the scrubber is sitting on. */
export function momentAt(record: DayRecord, at: number): string {
  const moments = dayMoments(record);
  let found = '';
  for (const moment of moments) {
    if (moment.at > at) break;
    found = moment.text;
  }
  return found;
}

/**
 * A task as it stood. Before its last change it was running, which is the one
 * thing a timestamp on a finished task can honestly tell the replay.
 */
function taskAsOf(task: Task, at: number): Task | undefined {
  if (task.createdAt > at) return undefined;
  return task.updatedAt <= at ? task : { ...task, status: 'running', updatedAt: task.createdAt };
}

/** Whether the workspace was inside its working hours at this instant, on the viewer's clock. */
function isWorkingAt(schedule: ScheduleSummary, at: number): boolean {
  const when = new Date(at);
  const hour = when.getHours() + when.getMinutes() / 60;
  return (
    schedule.workingDays.includes(when.getDay()) && hour >= schedule.startHour && hour < schedule.endHour
  );
}
