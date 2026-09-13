import type {
  ActionProposal,
  ActivityEvent,
  Alert,
  AuditFinding,
  CalendarEntry,
  FloorPost,
  Meeting,
  Notification,
  ProviderId,
  ScheduleSummary,
  Task,
} from '@/lib/contracts';

/**
 * What a figure in the office is doing. Derived only from what the system
 * already records: tasks, events, proposals, board posts, and the day around
 * them — shifts, meetings, findings and alerts.
 */
export type Activity =
  // At a desk, on a task.
  | 'idle'
  | 'thinking'
  | 'reading'
  | 'calling'
  | 'writing'
  | 'reviewing'
  | 'celebrating'
  | 'failed'
  | 'talking'
  // Memory.
  | 'reading_memory'
  | 'remembering'
  | 'filing'
  // Dependencies.
  | 'waiting'
  | 'blocked'
  | 'reviewing_peer'
  // Meetings.
  | 'preparing'
  | 'presenting'
  | 'answering'
  // Reserved kinds at work.
  | 'auditing'
  | 'triaging'
  | 'planning'
  // The clock, and the day's paperwork.
  | 'arriving'
  | 'leaving'
  | 'off_shift'
  | 'reporting'
  | 'uneasy';

/** Something on this floor a person has to deal with. */
export type Attention = 'approval' | 'stuck';

export interface EmployeeActivity {
  activity: Activity;
  /** When this activity started, so the scene can time its animations. */
  since: number;
  /** One short line to show above the figure. */
  bubble?: string;
  attention?: Attention;
  /** The other employee in a handoff conversation, when it is derivable. */
  partnerId?: string;
  taskId?: string;
  /** The tool being called, and the provider it belongs to when the name says so. */
  tool?: string;
  provider?: ProviderId;
  /** The task this figure is waiting on, so the floor can run a string to it. */
  waitingOn?: string;
  /** Who owes that task, when it is somebody on this floor. The string goes to their desk. */
  waitingOnId?: string;
  /** The employee whose desk an auditor is standing at. */
  visitingId?: string;
  /** The alert a triage figure is running to the console for. */
  alertId?: string;
}

/**
 * The rest of the workspace's day. Every field is optional, and a floor given
 * none of it derives exactly as it always did.
 */
export interface DayInput {
  /** Working and attended hours, and the overnight policy. */
  schedule?: ScheduleSummary;
  /** Shifts that touch now: the ones the scene turns into arrivals and departures. */
  shifts?: ShiftBlock[];
  /** Today's meetings, with the session itself once one is open. */
  meetings?: MeetingInput[];
  /** Findings the auditors have filed. Open ones lead the next shift. */
  findings?: AuditFinding[];
  alerts?: Alert[];
  /** Attempts to reach a person. Three unacknowledged ones is the emergency rule. */
  notifications?: Notification[];
}

/** One working session, as much of it as the office needs to show somebody arriving or leaving. */
export interface ShiftBlock {
  employeeId: string;
  taskId?: string;
  startedAt: number;
  /** When it ended, or finishes. Absent while it is still running. */
  endedAt?: number;
}

/** One meeting: what the calendar says, and the session once somebody opens it. */
export interface MeetingInput {
  entry: CalendarEntry;
  meeting?: Meeting;
}

export interface ActivityInput {
  employees: { id: string; name: string }[];
  tasks: Task[];
  events: ActivityEvent[];
  proposals: ActionProposal[];
  posts: FloorPost[];
  now: number;
  day?: DayInput;
}

/** A successful read keeps the figure reading this long before it goes back to thinking. */
export const READING_MS = 20_000;
/** Fresh assistant output means the figure is typing. */
export const WRITING_MS = 20_000;
/** A message older than this is no longer worth a speech bubble. */
export const BUBBLE_MS = 60_000;
export const CELEBRATING_MS = 90_000;
export const FAILED_MS = 300_000;
/** An approval nobody has decided for this long is stuck. */
export const STUCK_MS = 1_800_000;
export const BUBBLE_CHARS = 90;
/** A shift that started this recently still reads as somebody arriving. */
export const ARRIVING_MS = 300_000;
/** A shift that ended this recently reads as somebody on their way out. */
export const LEAVING_MS = 300_000;
/** Attendees gather for a meeting this far ahead of it, which is the prep lead. */
export const GATHER_MS = 3_600_000;
/** A question addressed to somebody is theirs to answer for this long. */
export const ANSWERING_MS = 120_000;
/** The last thing said in a live meeting holds the floor this long. */
export const SPEAKING_MS = 45_000;
/** Three unacknowledged attempts is what lets triage act on its own. */
export const EMERGENCY_ATTEMPTS = 3;

const ACTIVE_STATUSES: Task['status'][] = ['queued', 'running', 'awaiting_approval', 'needs_input'];
const PROVIDER_IDS: ProviderId[] = ['linear', 'slack', 'github', 'google-workspace', 'canva'];
const OPEN_ALERTS: Alert['status'][] = ['open', 'triaging'];
/** The memory tools, and which of the two memory activities each one reads as. */
const MEMORY_TOOLS: Record<string, Activity> = {
  remember: 'remembering',
  recall: 'reading_memory',
  read_memory: 'reading_memory',
  read_board: 'reading_memory',
};

/** Activities that mean somebody is at work, as opposed to waiting, off, or on their way. */
const AT_WORK: Activity[] = [
  'thinking',
  'reading',
  'calling',
  'writing',
  'reviewing',
  'talking',
  'reading_memory',
  'remembering',
  'filing',
  'reviewing_peer',
  'preparing',
  'presenting',
  'answering',
  'auditing',
  'triaging',
  'planning',
  'reporting',
];

/** Whether this figure is working right now: it is what lights a desk lamp overnight. */
export function isWorking(activity: Activity): boolean {
  return AT_WORK.includes(activity);
}

/** `<tool>: started` and `<tool>: succeeded (reason)` are the shapes the tool-call journal writes. */
function toolCall(event: ActivityEvent): { tool: string; outcome: string } | undefined {
  if (event.type !== 'tool_call') return;
  const match = /^(.*): (started|succeeded|failed|denied)(?: \(.*\))?$/.exec(event.text);
  return match ? { tool: match[1], outcome: match[2] } : undefined;
}

/** Providers name their tools, so `linear_create_issue` is enough to pick the right console. */
export function providerForTool(tool: string): ProviderId | undefined {
  const name = tool.toLowerCase();
  return PROVIDER_IDS.find(
    (provider) => name.startsWith(provider) || name.startsWith(provider.replace('-', '_')),
  );
}

/** Internal memory tools arrive prefixed by their server: `astra_memory_remember`. */
function memoryActivityForTool(tool: string): Activity | undefined {
  const name = tool.toLowerCase().replace(/^astra_memory_/, '');
  return MEMORY_TOOLS[name];
}

/** The first sentence of a message, trimmed to fit a two-line bubble. */
export function firstSentence(text: string, limit = BUBBLE_CHARS): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const end = /[.!?](\s|$)/.exec(flat);
  const sentence = end ? flat.slice(0, end.index + 1) : flat;
  return sentence.length > limit ? `${sentence.slice(0, limit - 1).trimEnd()}…` : sentence;
}

function newest<T>(items: T[], at: (item: T) => number): T | undefined {
  return items.reduce<T | undefined>((best, item) => (!best || at(item) > at(best) ? item : best), undefined);
}

const NO_DAY: DayInput = {};

/**
 * One activity per employee.
 *
 * Precedence, highest first: the meeting an attendee is in, a live incident a
 * triage employee is on, an audit pass, a curation run, a shift that has only
 * just started, a planning turn, a task that needs a person, a task that just
 * failed or finished, what the live task's journal says, a dependency the task
 * is waiting on, an open finding, the edges of the working day, an open handoff,
 * then `idle`.
 */
export function deriveActivities(input: ActivityInput): Map<string, EmployeeActivity> {
  const { employees, tasks, events, proposals, posts, now } = input;
  const day = input.day ?? NO_DAY;
  const employeeIds = new Set(employees.map((employee) => employee.id));
  const byEmployee = new Map<string, Task[]>();
  for (const task of tasks) {
    const list = byEmployee.get(task.employeeId);
    if (list) list.push(task);
    else byEmployee.set(task.employeeId, [task]);
  }
  const employeeByName = new Map(employees.map((employee) => [employee.name, employee.id]));
  const pendingHandoffs = posts.filter(
    (post) => post.kind === 'handoff' && post.handoff?.status === 'pending',
  );
  const finishedById = new Map(tasks.map((task) => [task.id, task]));
  const result = new Map<string, EmployeeActivity>();

  for (const employee of employees) {
    const own = byEmployee.get(employee.id) ?? [];
    const active = newest(
      own.filter((task) => ACTIVE_STATUSES.includes(task.status)),
      (task) => task.updatedAt,
    );
    const taskEvents = active ? events.filter((event) => event.taskId === active.id) : [];
    const latestEvent = newest(taskEvents, (event) => event.sequence);
    const handoff = newest(
      pendingHandoffs.filter(
        (post) =>
          post.handoff?.toEmployeeId === employee.id || employeeByName.get(post.authorName) === employee.id,
      ),
      (post) => post.createdAt,
    );
    const state = activityFor({
      employee,
      own,
      active,
      taskEvents,
      latestEvent,
      handoff,
      employeeByName,
      employeeIds,
      finishedById,
      day,
      now,
    });
    // The bubble belongs to whichever task explains the activity, not only a live one.
    const bubble = bubbleFor(
      own.find((task) => task.id === state.taskId),
      state.activity,
      handoff,
      now,
    );
    const attention = attentionFor(own, proposals, now);
    result.set(employee.id, {
      ...state,
      ...(bubble ? { bubble } : {}),
      ...(attention ? { attention } : {}),
    });
  }
  return result;
}

type Context = {
  employee: { id: string; name: string };
  own: Task[];
  active?: Task;
  taskEvents: ActivityEvent[];
  latestEvent?: ActivityEvent;
  handoff?: FloorPost;
  employeeByName: Map<string, string>;
  /** Everybody the room is showing, which is whose desk an auditor can walk to. */
  employeeIds: Set<string>;
  finishedById: Map<string, Task>;
  day: DayInput;
  now: number;
};

function activityFor(context: Context): EmployeeActivity {
  return (
    meetingActivity(context) ??
    triageActivity(context) ??
    auditActivity(context) ??
    arrivingActivity(context) ??
    sessionActivity(context) ??
    dependencyActivity(context) ??
    uneasyActivity(context) ??
    shiftActivity(context) ??
    handoffActivity(context) ?? { activity: 'idle', since: 0 }
  );
}

/**
 * Attendees gather an hour before a meeting, and once it is open the last person
 * addressed is answering while whoever spoke last has the floor.
 */
function meetingActivity({ employee, day, now }: Context): EmployeeActivity | undefined {
  for (const { entry, meeting } of day.meetings ?? []) {
    if (entry.status === 'cancelled' || entry.status === 'done') continue;
    if (!entry.attendees.some((attendee) => attendee.kind === 'employee' && attendee.id === employee.id))
      continue;
    if (meeting && (meeting.status === 'live' || meeting.status === 'closing')) {
      const said = newest(
        meeting.turns.filter((turn) => turn.kind === 'answer' && turn.employeeId === employee.id),
        (turn) => turn.createdAt,
      );
      const asked = newest(
        meeting.turns.filter(
          (turn) => turn.kind === 'question' && (turn.addressedTo ?? []).includes(employee.id),
        ),
        (turn) => turn.createdAt,
      );
      if (said && now - said.createdAt < SPEAKING_MS && (!asked || asked.createdAt < said.createdAt))
        return { activity: 'presenting', since: said.createdAt, bubble: firstSentence(said.text) };
      if (asked && now - asked.createdAt < ANSWERING_MS && (!said || said.createdAt < asked.createdAt))
        return { activity: 'answering', since: asked.createdAt };
      return { activity: 'presenting', since: meeting.openedAt ?? entry.startsAt };
    }
    if (now >= entry.startsAt - GATHER_MS && now < entry.endsAt)
      return { activity: 'preparing', since: entry.startsAt - GATHER_MS };
  }
  return undefined;
}

/** A triage session on an open alert: the figure is at the console, and the beacon is lit. */
function triageActivity({ own, day }: Context): EmployeeActivity | undefined {
  const session = own.find((task) => task.kind === 'triage' && ACTIVE_STATUSES.includes(task.status));
  if (!session) return undefined;
  const alert = (day.alerts ?? []).find(
    (item) => item.triageTaskId === session.id && OPEN_ALERTS.includes(item.status),
  );
  return {
    activity: 'triaging',
    since: session.updatedAt,
    taskId: session.id,
    ...(alert ? { alertId: alert.id, bubble: firstSentence(alert.title) } : {}),
  };
}

/**
 * An audit pass or a curation run. The auditor stands at the desk of whoever
 * they are auditing; the janitor files at the shelves.
 */
function auditActivity({ employee, own, day, employeeIds }: Context): EmployeeActivity | undefined {
  const curation = own.find((task) => task.kind === 'curation' && ACTIVE_STATUSES.includes(task.status));
  if (curation) return { activity: 'filing', since: curation.updatedAt, taskId: curation.id };
  const audit = own.find((task) => task.kind === 'audit' && ACTIVE_STATUSES.includes(task.status));
  if (!audit) return undefined;
  // Whose desk: the newest finding still open against somebody else in this room.
  // A closed one has been dealt with, and a desk on another floor is not here.
  const finding = newest(
    (day.findings ?? []).filter(
      (item) => item.status === 'open' && item.employeeId !== employee.id && employeeIds.has(item.employeeId),
    ),
    (item) => item.createdAt,
  );
  return {
    activity: 'auditing',
    since: audit.updatedAt,
    taskId: audit.id,
    ...(finding ? { visitingId: finding.employeeId } : {}),
  };
}

/**
 * Somebody who has only just clocked on is still crossing the floor. Their first
 * task is already queued or running by then, so this sits above the journal or
 * nobody would ever be seen arriving.
 */
function arrivingActivity({ employee, day, now }: Context): EmployeeActivity | undefined {
  const started = newest(
    (day.shifts ?? []).filter(
      (shift) =>
        shift.employeeId === employee.id &&
        now >= shift.startedAt &&
        now - shift.startedAt < ARRIVING_MS &&
        (shift.endedAt ?? Infinity) > now,
    ),
    (shift) => shift.startedAt,
  );
  if (!started) return undefined;
  return {
    activity: 'arriving',
    since: started.startedAt,
    ...(started.taskId ? { taskId: started.taskId } : {}),
  };
}

/** The journal of the live task: what this employee is doing right now. */
function sessionActivity(context: Context): EmployeeActivity | undefined {
  const { own, active, taskEvents, latestEvent, now } = context;
  const requiresAction = latestEvent?.type === 'agent.session.requires_action';
  if (
    active?.status === 'awaiting_approval' ||
    active?.status === 'needs_input' ||
    (active && requiresAction)
  )
    return { activity: 'reviewing', since: active.updatedAt, taskId: active.id };

  const settled = newest(
    own.filter((task) => !ACTIVE_STATUSES.includes(task.status) && task.status !== 'waiting'),
    (task) => task.updatedAt,
  );
  if (
    (settled?.status === 'failed' || settled?.status === 'uncertain') &&
    now - settled.updatedAt < FAILED_MS
  )
    return { activity: 'failed', since: settled.updatedAt, taskId: settled.id };
  if (settled?.status === 'completed' && now - settled.updatedAt < CELEBRATING_MS)
    return { activity: 'celebrating', since: settled.updatedAt, taskId: settled.id };

  if (!active) return undefined;
  if (active.kind === 'standing') return { activity: 'planning', since: active.updatedAt, taskId: active.id };

  const message = active.lastMessage;
  if (message && now - message.createdAt < WRITING_MS)
    return { activity: writingActivity(context, active), since: message.createdAt, taskId: active.id };
  const call = latestEvent ? toolCall(latestEvent) : undefined;
  if (latestEvent && call?.outcome === 'started') {
    const memory = memoryActivityForTool(call.tool);
    if (memory) return { activity: memory, since: latestEvent.createdAt, taskId: active.id, tool: call.tool };
    const provider = providerForTool(call.tool);
    return {
      activity: 'calling',
      since: latestEvent.createdAt,
      taskId: active.id,
      tool: call.tool,
      ...(provider ? { provider } : {}),
    };
  }
  if (latestEvent && call?.outcome === 'succeeded' && now - latestEvent.createdAt < READING_MS) {
    const memory = memoryActivityForTool(call.tool);
    return {
      activity: memory === 'remembering' ? 'remembering' : memory ? 'reading_memory' : 'reading',
      since: latestEvent.createdAt,
      taskId: active.id,
      tool: call.tool,
    };
  }
  const turn = newest(
    taskEvents.filter((event) => event.type === 'agent.session.turn.created'),
    (event) => event.sequence,
  );
  return { activity: 'thinking', since: turn?.createdAt ?? active.updatedAt, taskId: active.id };
}

/**
 * Writing at the end of a shift is writing the report, which the office shows
 * differently: the figure is at their desk with the day's pages, not mid-task.
 */
function writingActivity({ day }: Context, active: Task): Activity {
  const shift = (day.shifts ?? []).find((item) => item.taskId === active.id && !item.endedAt);
  const closing = day.schedule && !day.schedule.working;
  return shift && closing ? 'reporting' : 'writing';
}

/** A task held up by another one: the floor runs a string from the figure to it. */
function dependencyActivity({ own, finishedById }: Context): EmployeeActivity | undefined {
  const held = newest(
    own.filter((task) => task.status === 'waiting' || task.status === 'blocked'),
    (task) => task.updatedAt,
  );
  if (!held) return undefined;
  const unfinished = (held.dependsOn ?? []).find((id) => finishedById.get(id)?.status !== 'completed');
  const owner = unfinished ? finishedById.get(unfinished)?.employeeId : undefined;
  return {
    activity: held.status === 'blocked' ? 'blocked' : 'waiting',
    since: held.updatedAt,
    taskId: held.id,
    ...(unfinished ? { waitingOn: unfinished } : {}),
    ...(owner ? { waitingOnId: owner } : {}),
  };
}

/** An open finding sits on this desk, and the day has not dealt with it yet. */
function uneasyActivity({ employee, day }: Context): EmployeeActivity | undefined {
  const open = newest(
    (day.findings ?? []).filter((item) => item.employeeId === employee.id && item.status === 'open'),
    (item) => item.createdAt,
  );
  return open ? { activity: 'uneasy', since: open.createdAt } : undefined;
}

/**
 * The far edge of the day: somebody whose shift has just ended, somebody still
 * on one the journal had nothing to say about, and the empty floor outside
 * working hours. Arrivals are earlier, above the journal.
 */
function shiftActivity({ employee, day, now }: Context): EmployeeActivity | undefined {
  const mine = (day.shifts ?? []).filter((shift) => shift.employeeId === employee.id);
  const ended = newest(
    mine.filter(
      (shift) => shift.endedAt !== undefined && now >= shift.endedAt && now - shift.endedAt < LEAVING_MS,
    ),
    (shift) => shift.endedAt ?? 0,
  );
  if (ended?.endedAt)
    return { activity: 'leaving', since: ended.endedAt, ...(ended.taskId ? { taskId: ended.taskId } : {}) };
  // A shift is running and the journal had nothing to say about it: they are at work.
  const running = newest(
    mine.filter((shift) => shift.startedAt <= now && (shift.endedAt ?? Infinity) > now),
    (shift) => shift.startedAt,
  );
  if (running)
    return {
      activity: 'thinking',
      since: running.startedAt,
      ...(running.taskId ? { taskId: running.taskId } : {}),
    };
  if (day.schedule && !day.schedule.working) return { activity: 'off_shift', since: 0 };
  return undefined;
}

function handoffActivity({ employee, handoff, employeeByName }: Context): EmployeeActivity | undefined {
  if (!handoff?.handoff) return undefined;
  const partner =
    handoff.handoff.toEmployeeId === employee.id
      ? employeeByName.get(handoff.authorName)
      : handoff.handoff.toEmployeeId;
  return {
    activity: 'talking',
    since: handoff.createdAt,
    ...(partner && partner !== employee.id ? { partnerId: partner } : {}),
    ...(handoff.taskId ? { taskId: handoff.taskId } : {}),
  };
}

function bubbleFor(
  task: Task | undefined,
  activity: Activity,
  handoff: FloorPost | undefined,
  now: number,
): string | undefined {
  const message = task?.lastMessage;
  if (message?.text.trim() && now - message.createdAt < BUBBLE_MS) return firstSentence(message.text);
  if (activity === 'talking' && handoff?.handoff?.brief) return firstSentence(handoff.handoff.brief);
  return undefined;
}

function attentionFor(own: Task[], proposals: ActionProposal[], now: number): Attention | undefined {
  const stuck = own.some(
    (task) =>
      (task.status === 'awaiting_approval' || task.status === 'needs_input') &&
      now - task.updatedAt > STUCK_MS,
  );
  if (stuck) return 'stuck';
  const ownIds = new Set(own.map((task) => task.id));
  const approval = proposals.some(
    (proposal) => proposal.status === 'pending' && proposal.canDecide && ownIds.has(proposal.taskId),
  );
  return approval ? 'approval' : undefined;
}

/**
 * The calendar's shift blocks, as shifts. The calendar derives those blocks from
 * the same daily tasks the shifts belong to, so this is the record the office
 * needs without a second subscription: who is on, from when, until when.
 */
export function shiftsFromCalendar(entries: CalendarEntry[]): ShiftBlock[] {
  const shifts: ShiftBlock[] = [];
  for (const entry of entries) {
    if (entry.kind !== 'shift' || entry.status === 'cancelled') continue;
    const employee = entry.attendees.find((attendee) => attendee.kind === 'employee');
    if (!employee) continue;
    shifts.push({
      employeeId: employee.id,
      ...(entry.taskId ? { taskId: entry.taskId } : {}),
      startedAt: entry.startsAt,
      endedAt: entry.endsAt,
    });
  }
  return shifts;
}

/** What the room itself is showing, as opposed to what any one figure is doing. */
export interface FloorSignals {
  /** An open alert reaches this floor: the beacon is lit. */
  incident: boolean;
  incidentCount: number;
  /** Triage acted without permission. The floor carries the notice until it is acknowledged. */
  emergency?: { title: string; since: number };
  /** The meeting worth walking to, and who has the floor in it. */
  meeting?: { entryId: string; attendeeIds: string[]; speakingId?: string; live: boolean };
  /** Open findings per employee, for the folder on the desk. */
  findings: Map<string, number>;
}

/**
 * The room's own state for a moment in the day. Same inputs as the figures, so
 * the beacon, the notice and the meeting always agree with what people are doing.
 */
export function deriveFloorSignals(day: DayInput, floorId: string | undefined, now: number): FloorSignals {
  const open = (day.alerts ?? []).filter(
    (alert) =>
      OPEN_ALERTS.includes(alert.status) &&
      (!floorId || !alert.affectedFloorIds.length || alert.affectedFloorIds.includes(floorId)),
  );
  const unacknowledged = (day.notifications ?? []).filter(
    (notice) => notice.kind === 'triage' && !notice.acknowledgedAt,
  );
  const emergency = newest(
    unacknowledged.filter((notice) => notice.attempt >= EMERGENCY_ATTEMPTS),
    (notice) => notice.sentAt,
  );
  const findings = new Map<string, number>();
  for (const finding of day.findings ?? [])
    if (finding.status === 'open')
      findings.set(finding.employeeId, (findings.get(finding.employeeId) ?? 0) + 1);

  const meeting = (day.meetings ?? [])
    .filter((item) => item.entry.status !== 'cancelled' && item.entry.status !== 'done')
    .find((item) => now >= item.entry.startsAt - GATHER_MS && now < item.entry.endsAt);
  const live = meeting?.meeting?.status === 'live' || meeting?.meeting?.status === 'closing';
  const speaking = meeting?.meeting
    ? newest(
        meeting.meeting.turns.filter((turn) => turn.kind === 'answer' && turn.employeeId),
        (turn) => turn.createdAt,
      )
    : undefined;

  return {
    incident: open.length > 0,
    incidentCount: open.length,
    ...(emergency ? { emergency: { title: emergency.title, since: emergency.sentAt } } : {}),
    ...(meeting
      ? {
          meeting: {
            entryId: meeting.entry.id,
            attendeeIds: meeting.entry.attendees
              .filter((attendee) => attendee.kind === 'employee')
              .map((attendee) => attendee.id),
            ...(live && speaking?.employeeId && now - speaking.createdAt < SPEAKING_MS
              ? { speakingId: speaking.employeeId }
              : {}),
            live,
          },
        }
      : {}),
    findings,
  };
}
