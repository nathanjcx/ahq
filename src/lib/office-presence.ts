import type { Employee } from '../../shared/types';
import type { OfficeEvent } from '../../shared/office-events';
import { officeAnalogyForTool, type OfficeStation } from '../../shared/office-tool-atlas';

export type OfficePoint = [number, number, number];
export type PresenceStatus = 'idle' | 'queued' | 'working' | 'review' | 'completed' | 'failed' | 'cancelled';
export interface EmployeePresence {
  employeeId: string;
  observed: boolean;
  sample: boolean;
  status: PresenceStatus;
  pose: 'idle' | 'research' | 'reading' | 'discussion' | 'lounge';
  location: Employee['location'];
  station: OfficeStation;
  position: OfficePoint;
  yaw: number;
  walking: boolean;
  phase: number;
  seated: boolean;
  badge: string;
  summary: string;
  eventId?: string;
  eventAtMs?: number;
  toolName?: string;
  cue: 'none' | 'working' | 'attention' | 'complete' | 'error' | 'message';
  cueStrength: number;
  focused: boolean;
}
export interface OfficeHandoff {
  id: string;
  fromEmployeeId: string;
  toEmployeeId: string;
  status: 'queued' | 'delivered' | 'acknowledged';
  summary: string;
  occurredAtMs: number;
  progress: number;
  opacity: number;
  pulse: number;
}
export interface OfficePresence {
  employees: Record<string, EmployeePresence>;
  handoffs: OfficeHandoff[];
  clockMs: number;
  stations: Partial<
    Record<
      OfficeStation,
      {
        eventId: string;
        kind: OfficeEvent['kind'];
        summary: string;
        active: boolean;
        phase: number;
        strength: number;
        memoryKind?: OfficeEvent['memoryKind'];
      }
    >
  >;
}
type SceneEmployee = Pick<Employee, 'id' | 'status' | 'location' | 'activity' | 'sessionId'>;
const deskPositions: OfficePoint[] = [
  [-6.3, 0, -2.2],
  [-3.1, 0, -2.2],
  [-6.3, 0, 1.1],
  [-3.1, 0, 1.1],
  [-6.3, 0, 4.4],
  [-3.1, 0, 4.4],
];
const eventTime = (event: OfficeEvent) =>
  Math.max(Date.parse(event.occurredAt), Date.parse(event.recordedAt));
const clamp = (value: number, minimum = 0, maximum = 1) => Math.min(maximum, Math.max(minimum, value));

export function officeAnchor(index: number, location: Employee['location']): OfficePoint {
  if (location === 'board' || location === 'meeting')
    return [3.3 + (index % 3) * 0.95, 0, index % 6 < 3 ? -4.94 : -1.65];
  if (location === 'library') return [-1.65 + (index % 2) * 0.75, 0, -4.45];
  if (index < deskPositions.length) return [...deskPositions[index]];
  return [1.9 + ((index - 6) % 7) * 0.9, 0, 0.5 + Math.floor((index - 6) / 7) * 0.78];
}
export function officeStationAnchor(index: number, station: OfficeStation): OfficePoint {
  if (station === 'archive') return [0.05 + (index % 2) * 0.45, 0, -4.18];
  if (station === 'dispatch') return [-0.1 + (index % 2) * 0.45, 0, 4.25];
  if (station === 'workbench') return [...deskPositions[2]];
  if (station === 'research') return [...deskPositions[0]];
  if (station === 'analysis') return [...deskPositions[1]];
  if (station === 'connections') return [...deskPositions[3]];
  if (station === 'recorder') return [4.1, 0, 2.5];
  return officeAnchor(index, station === 'review' ? 'board' : station === 'library' ? 'library' : 'desk');
}
function stationForEvent(event: OfficeEvent): OfficeStation | undefined {
  if (event.toolName) return officeAnalogyForTool(event.toolName)?.station ?? 'desk';
  if (event.kind.startsWith('memory.')) return 'archive';
  if (event.kind.startsWith('message.')) return 'dispatch';
  if (event.kind === 'artifact.created') return 'workbench';
  if (event.kind.startsWith('approval.')) return 'review';
  if (event.kind === 'checkpoint.saved') return 'recorder';
  if (
    event.kind.startsWith('session.') ||
    event.kind === 'reasoning.summary' ||
    event.kind === 'employee.configured'
  )
    return 'desk';
  return undefined;
}

export function visibleOfficeEvents(events: readonly OfficeEvent[], clockMs: number): OfficeEvent[] {
  if (!Number.isFinite(clockMs)) return [];
  const unique = new Map<string, OfficeEvent>();
  for (const event of events) {
    const occurred = Date.parse(event.occurredAt),
      recorded = Date.parse(event.recordedAt);
    if (
      Number.isFinite(occurred) &&
      Number.isFinite(recorded) &&
      occurred <= clockMs &&
      recorded <= clockMs &&
      !unique.has(event.id)
    )
      unique.set(event.id, event);
  }
  return [...unique.values()].sort(
    (a, b) => eventTime(a) - eventTime(b) || a.sequence - b.sequence || a.id.localeCompare(b.id),
  );
}

const toolLabels: Record<string, string> = {
  workspace_search: 'Searching files',
  workspace_read: 'Reading files',
  web_search: 'Searching the web',
  web_search_call: 'Searching the web',
  code_interpreter: 'Analyzing data',
  code_interpreter_call: 'Analyzing data',
  artifact_write: 'Writing a document',
  artifact_read: 'Reading a document',
  artifact_list: 'Finding documents',
  memory_search: 'Retrieving memory',
  memory_remember: 'Recording memory',
  memory_forget: 'Updating memory',
  office_send_message: 'Sending a message',
  office_read_inbox: 'Reading messages',
  office_acknowledge_message: 'Acknowledging a message',
  office_list_employees: 'Finding a teammate',
};
export function officeToolLabel(name: string): string {
  return toolLabels[name] ?? name.replaceAll('_', ' ').replace(/\b\w/, (letter) => letter.toUpperCase());
}
function poseFor(location: Employee['location'], status: PresenceStatus): EmployeePresence['pose'] {
  if (location === 'library') return 'reading';
  if (location === 'board' || location === 'meeting') return 'discussion';
  return status === 'working' || status === 'queued' ? 'research' : 'idle';
}
function pathBetween(from: OfficePoint, to: OfficePoint): OfficePoint[] {
  if (Math.hypot(from[0] - to[0], from[2] - to[2]) < 0.01) return [from, to];
  const points: OfficePoint[] = [from];
  if (from[0] < -2.4) points.push([from[0], 0, from[2] + 0.48], [0.25, 0, from[2] + 0.48]);
  else if (from[0] > 1.4 && from[2] < -0.6) points.push([2.16, 0, from[2]], [2.16, 0, -1.35]);
  else if (from[2] < -3.5) points.push([-0.45, 0, from[2]]);
  points.push([0.25, 0, -1.35]);
  if (to[0] < -2.4) points.push([0.25, 0, to[2] + 0.48], [to[0], 0, to[2] + 0.48]);
  else if (to[0] > 1.4 && to[2] < -0.6) points.push([2.16, 0, -1.35], [2.16, 0, to[2]]);
  else if (to[2] < -3.5) points.push([-0.45, 0, to[2]]);
  points.push(to);
  return points.filter(
    (point, index) =>
      !index || Math.hypot(point[0] - points[index - 1][0], point[2] - points[index - 1][2]) > 0.01,
  );
}
interface Transition {
  at: number;
  path: OfficePoint[];
  duration: number;
}
function transitionPosition(transition: Transition | undefined, target: OfficePoint, clockMs: number) {
  if (!transition || clockMs >= transition.at + transition.duration)
    return { position: [...target] as OfficePoint, yaw: Math.PI, walking: false };
  const lengths = transition.path
    .slice(1)
    .map((point, index) =>
      Math.hypot(point[0] - transition.path[index][0], point[2] - transition.path[index][2]),
    );
  const distance =
    lengths.reduce((sum, length) => sum + length, 0) * clamp((clockMs - transition.at) / transition.duration);
  let accumulated = 0,
    segment = 0;
  while (segment < lengths.length - 1 && accumulated + lengths[segment] < distance)
    accumulated += lengths[segment++];
  const from = transition.path[segment],
    to = transition.path[segment + 1];
  if (!from || !to) return { position: [...target] as OfficePoint, yaw: Math.PI, walking: false };
  const fraction = clamp((distance - accumulated) / Math.max(0.001, lengths[segment]));
  return {
    position: [
      from[0] + (to[0] - from[0]) * fraction,
      0,
      from[2] + (to[2] - from[2]) * fraction,
    ] as OfficePoint,
    yaw: Math.atan2(to[0] - from[0], to[2] - from[2]),
    walking: true,
  };
}
function statusFrom(value: string | undefined): PresenceStatus | undefined {
  return value === 'running'
    ? 'working'
    : value === 'waiting_for_approval'
      ? 'review'
      : value === 'queued' || value === 'completed' || value === 'failed' || value === 'cancelled'
        ? value
        : undefined;
}
const badges: Record<PresenceStatus, string> = {
  idle: 'Ready',
  queued: 'Queued',
  working: 'Working',
  review: 'Needs review',
  completed: 'Completed',
  failed: 'Needs attention',
  cancelled: 'Stopped',
};

/** All visible state is reconstructed from the supplied clock; never from wall time or accumulated frames. */
export function deriveOfficePresence(
  employees: readonly SceneEmployee[],
  events: readonly OfficeEvent[],
  clockMs: number,
  sample = false,
): OfficePresence {
  const clock = Number.isFinite(clockMs) ? clockMs : 0;
  const visible = visibleOfficeEvents(events, clock);
  const known = new Set(employees.map((employee) => employee.id));
  const result: OfficePresence = { employees: {}, handoffs: [], clockMs: clock, stations: {} };
  let newestFocus: { employeeId: string; time: number; sequence: number } | undefined;
  employees.forEach((employee, index) => {
    let status: PresenceStatus = 'idle',
      location: Employee['location'] = 'desk',
      station: OfficeStation = 'desk';
    let latest: OfficeEvent | undefined, toolName: string | undefined, transition: Transition | undefined;
    let target = officeAnchor(index, location),
      messageAt = -Infinity;
    const own = visible.filter(
      (event) => event.employeeId === employee.id || event.targetEmployeeId === employee.id,
    );
    for (const event of own) {
      const time = eventTime(event);
      if (event.targetEmployeeId === employee.id && event.employeeId !== employee.id) {
        if (event.kind === 'message.delivered' || event.kind === 'message.acknowledged') messageAt = time;
        if (event.kind.startsWith('message.')) latest = event;
        continue;
      }
      latest = event;
      let nextLocation: Employee['location'] = location;
      if (event.kind === 'session.started') {
        status = statusFrom(event.status) ?? 'queued';
        nextLocation = 'desk';
        toolName = undefined;
      }
      if (event.kind === 'session.status') {
        status = statusFrom(event.status) ?? status;
        if (event.location) nextLocation = event.location;
        if (status === 'review') nextLocation = 'board';
      }
      if (event.kind === 'session.completed') {
        status = 'completed';
        nextLocation = 'desk';
        toolName = undefined;
      }
      if (event.kind === 'session.failed') {
        status = 'failed';
        nextLocation = 'desk';
        toolName = undefined;
      }
      if (event.kind === 'session.cancelled') {
        status = 'cancelled';
        nextLocation = 'desk';
        toolName = undefined;
      }
      if (event.kind === 'tool.started') {
        status = 'working';
        toolName = event.toolName;
        nextLocation = /^(workspace_(search|read)|web_search(_call)?|artifact_read|memory_search)$/.test(
          toolName ?? '',
        )
          ? 'library'
          : 'desk';
      }
      if (event.kind === 'tool.completed') {
        toolName = undefined;
        if (status !== 'review') nextLocation = 'desk';
      }
      if (event.kind === 'tool.failed') {
        toolName = undefined;
        nextLocation = 'desk';
      }
      if (event.kind === 'approval.requested') {
        status = 'review';
        nextLocation = 'board';
        toolName = undefined;
      }
      if (event.kind === 'approval.decided') {
        status = statusFrom(event.status) ?? 'working';
        nextLocation = 'desk';
      }
      if (event.kind === 'message.delivered' || event.kind === 'message.acknowledged') messageAt = time;
      let nextStation: OfficeStation =
        nextLocation === 'board' || nextLocation === 'meeting'
          ? 'review'
          : nextLocation === 'library'
            ? 'library'
            : 'desk';
      if (event.kind === 'tool.started') nextStation = stationForEvent(event) ?? 'desk';
      else if (toolName && event.kind !== 'tool.completed' && event.kind !== 'tool.failed')
        nextStation = station;
      if (nextStation !== station) {
        const from = transitionPosition(transition, target, time).position;
        target = officeStationAnchor(index, nextStation);
        const path = pathBetween(from, target);
        const length = path
          .slice(1)
          .reduce(
            (sum, point, segment) =>
              sum + Math.hypot(point[0] - path[segment][0], point[2] - path[segment][2]),
            0,
          );
        transition = { at: time, path, duration: clamp((length / 2.6) * 1000, 800, 8000) };
        station = nextStation;
      }
      location = nextLocation;
    }
    const observed = own.length > 0;
    const sampleEmployee = sample && !observed && !employee.sessionId;
    if (sampleEmployee) {
      status = employee.status === 'review' ? 'review' : employee.status === 'working' ? 'working' : 'idle';
      location = employee.location;
      station =
        location === 'board' || location === 'meeting'
          ? 'review'
          : location === 'library'
            ? 'library'
            : 'desk';
      target = officeAnchor(index, location);
    }
    const at = latest ? eventTime(latest) : undefined;
    const age = at === undefined ? Infinity : Math.max(0, (clock - at) / 1000);
    const movement = transitionPosition(transition, target, clock);
    const cue =
      status === 'review'
        ? 'attention'
        : status === 'failed' || latest?.kind === 'tool.failed'
          ? 'error'
          : status === 'completed' && age < 10
            ? 'complete'
            : clock - messageAt < 8000
              ? 'message'
              : status === 'working'
                ? 'working'
                : 'none';
    const summary =
      latest?.summary ??
      (sampleEmployee ? `Sample: ${employee.activity}` : 'No recorded employee activity yet.');
    const phase = movement.walking || status === 'working' ? ((clock - (at ?? clock)) / 1000) * 7 : 0;
    result.employees[employee.id] = {
      employeeId: employee.id,
      observed,
      sample: sampleEmployee,
      status,
      pose:
        station === 'archive' || station === 'dispatch'
          ? 'reading'
          : ['research', 'analysis', 'connections', 'workbench'].includes(station)
            ? 'research'
            : poseFor(location, status),
      location,
      station,
      ...movement,
      phase,
      seated:
        !movement.walking &&
        ['desk', 'workbench', 'research', 'analysis', 'connections'].includes(station) &&
        index < deskPositions.length,
      badge: sampleEmployee
        ? `Sample · ${badges[status]}`
        : !observed
          ? 'No activity yet'
          : toolName
            ? officeToolLabel(toolName)
            : badges[status],
      summary,
      eventId: latest?.id,
      eventAtMs: at,
      toolName,
      cue,
      cueStrength:
        cue === 'attention' || cue === 'error'
          ? 0.9
          : cue === 'none'
            ? 0
            : 0.55 + Math.sin(((clock - (at ?? clock)) / 1000) * 3) * 0.2,
      focused: false,
    };
    if (
      latest &&
      age < 12 &&
      (!newestFocus ||
        (at ?? 0) > newestFocus.time ||
        ((at ?? 0) === newestFocus.time && latest.sequence > newestFocus.sequence))
    )
      newestFocus = { employeeId: employee.id, time: at!, sequence: latest.sequence };
  });
  if (newestFocus) result.employees[newestFocus.employeeId].focused = true;
  for (const event of visible) {
    const station = stationForEvent(event);
    if (!station) continue;
    const age = Math.max(0, clock - eventTime(event));
    const workerActive = Object.values(result.employees).some(
      (employee) => employee.station === station && !!employee.toolName && employee.status === 'working',
    );
    const existing = result.stations[station];
    if (
      (event.kind === 'tool.completed' || event.kind === 'tool.started') &&
      existing?.active &&
      /^(memory\.|message\.|artifact\.)/.test(existing.kind)
    )
      continue;
    result.stations[station] = {
      memoryKind: event.memoryKind,
      eventId: event.id,
      kind: event.kind,
      summary: event.summary,
      active: workerActive || age < 6500,
      phase: age / 1000,
      strength: workerActive ? 0.8 : clamp(1 - age / 6500),
    };
  }
  const messages = new Map<string, OfficeEvent>();
  for (const event of visible)
    if (
      event.messageId &&
      event.kind.startsWith('message.') &&
      event.employeeId &&
      event.targetEmployeeId &&
      known.has(event.employeeId) &&
      known.has(event.targetEmployeeId)
    )
      messages.set(event.messageId, event);
  for (const [messageId, event] of messages) {
    const occurredAtMs = eventTime(event),
      age = Math.max(0, (clock - occurredAtMs) / 1000);
    const status =
      event.kind === 'message.acknowledged'
        ? 'acknowledged'
        : event.kind === 'message.delivered'
          ? 'delivered'
          : 'queued';
    if (status !== 'queued' && age > 18) continue;
    result.handoffs.push({
      id: messageId,
      fromEmployeeId: event.employeeId!,
      toEmployeeId: event.targetEmployeeId!,
      status,
      summary: event.summary,
      occurredAtMs,
      progress:
        status === 'queued'
          ? 0.12 + clamp(age / 4) * 0.26
          : status === 'delivered'
            ? clamp(age / 2.4, 0.4, 1)
            : 1,
      opacity: status === 'queued' ? 0.38 : 0.72 * clamp(1 - age / 20, 0.12, 1),
      pulse: 1 + Math.sin(age * 3.5) * 0.12,
    });
  }
  result.handoffs = result.handoffs
    .sort((a, b) => b.occurredAtMs - a.occurredAtMs || a.id.localeCompare(b.id))
    .slice(0, 12);
  return result;
}
