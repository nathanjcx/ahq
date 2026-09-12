import type { ActionProposal, ActivityEvent, ProjectPost, ProviderId, Task } from '@/lib/contracts';

/**
 * What a figure in the office is doing. Derived only from the journal the system
 * already records: tasks, events, proposals and board posts.
 */
export type Activity =
  | 'idle'
  | 'thinking'
  | 'reading'
  | 'calling'
  | 'writing'
  | 'reviewing'
  | 'celebrating'
  | 'failed'
  | 'talking';

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
}

export interface ActivityInput {
  employees: { id: string; name: string }[];
  tasks: Task[];
  events: ActivityEvent[];
  proposals: ActionProposal[];
  posts: ProjectPost[];
  now: number;
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

const ACTIVE_STATUSES: Task['status'][] = ['queued', 'running', 'awaiting_approval'];
const PROVIDER_IDS: ProviderId[] = ['linear', 'slack', 'github', 'google-workspace', 'canva'];

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

/**
 * One activity per employee.
 *
 * Precedence, highest first: a task that needs a person (`reviewing`), a task that
 * just failed, a task that just completed, what the live task's journal says the
 * employee is doing right now, an open handoff conversation, then `idle`.
 */
export function deriveActivities(input: ActivityInput): Map<string, EmployeeActivity> {
  const { employees, tasks, events, proposals, posts, now } = input;
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
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
      now,
    });
    // The bubble belongs to whichever task explains the activity, not only a live one.
    const bubble = bubbleFor(
      own.find((task) => task.id === state.taskId),
      state.activity,
      handoff,
      now,
    );
    const attention = attentionFor(own, proposals, tasksById, now);
    result.set(employee.id, {
      ...state,
      ...(bubble ? { bubble } : {}),
      ...(attention ? { attention } : {}),
    });
  }
  return result;
}

function activityFor({
  employee,
  own,
  active,
  taskEvents,
  latestEvent,
  handoff,
  employeeByName,
  now,
}: {
  employee: { id: string; name: string };
  own: Task[];
  active?: Task;
  taskEvents: ActivityEvent[];
  latestEvent?: ActivityEvent;
  handoff?: ProjectPost;
  employeeByName: Map<string, string>;
  now: number;
}): EmployeeActivity {
  const requiresAction = latestEvent?.type === 'agent.session.requires_action';
  if (active?.status === 'awaiting_approval' || (active && requiresAction))
    return { activity: 'reviewing', since: active.updatedAt, taskId: active.id };

  const settled = newest(
    own.filter((task) => !ACTIVE_STATUSES.includes(task.status)),
    (task) => task.updatedAt,
  );
  if (
    (settled?.status === 'failed' || settled?.status === 'uncertain') &&
    now - settled.updatedAt < FAILED_MS
  )
    return { activity: 'failed', since: settled.updatedAt, taskId: settled.id };
  if (settled?.status === 'completed' && now - settled.updatedAt < CELEBRATING_MS)
    return { activity: 'celebrating', since: settled.updatedAt, taskId: settled.id };

  if (active) {
    const message = active.lastMessage;
    if (message && now - message.createdAt < WRITING_MS)
      return { activity: 'writing', since: message.createdAt, taskId: active.id };
    const call = latestEvent ? toolCall(latestEvent) : undefined;
    if (latestEvent && call?.outcome === 'started') {
      const provider = providerForTool(call.tool);
      return {
        activity: 'calling',
        since: latestEvent.createdAt,
        taskId: active.id,
        tool: call.tool,
        ...(provider ? { provider } : {}),
      };
    }
    if (latestEvent && call?.outcome === 'succeeded' && now - latestEvent.createdAt < READING_MS)
      return { activity: 'reading', since: latestEvent.createdAt, taskId: active.id, tool: call.tool };
    const turn = newest(
      taskEvents.filter((event) => event.type === 'agent.session.turn.created'),
      (event) => event.sequence,
    );
    return { activity: 'thinking', since: turn?.createdAt ?? active.updatedAt, taskId: active.id };
  }

  if (handoff?.handoff) {
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
  return { activity: 'idle', since: 0 };
}

function bubbleFor(
  task: Task | undefined,
  activity: Activity,
  handoff: ProjectPost | undefined,
  now: number,
): string | undefined {
  const message = task?.lastMessage;
  if (message?.text.trim() && now - message.createdAt < BUBBLE_MS) return firstSentence(message.text);
  if (activity === 'talking' && handoff?.handoff?.brief) return firstSentence(handoff.handoff.brief);
  return undefined;
}

function attentionFor(
  own: Task[],
  proposals: ActionProposal[],
  tasksById: Map<string, Task>,
  now: number,
): Attention | undefined {
  const stuck = own.some((task) => task.status === 'awaiting_approval' && now - task.updatedAt > STUCK_MS);
  if (stuck) return 'stuck';
  const ownIds = new Set(own.map((task) => task.id));
  const approval = proposals.some(
    (proposal) =>
      proposal.status === 'pending' &&
      proposal.canDecide &&
      ownIds.has(proposal.taskId) &&
      tasksById.has(proposal.taskId),
  );
  return approval ? 'approval' : undefined;
}
