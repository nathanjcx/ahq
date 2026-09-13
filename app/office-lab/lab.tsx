'use client';

import { useCallback, useMemo, useState } from 'react';
import type { Activity, EmployeeActivity } from '@/components/office/activity';
import { DAY_MS, type DayRecord } from '@/components/office/day-replay';
import { DayReplay } from '@/components/office/office-day';
import type { LabelMode } from '@/components/office/office-labels';
import type { BoardCard, ShelfSpec } from '@/components/office/office-layout';
import type { EmployeeKind } from '@/components/office/office-people';
import type { OfficeDressing, OfficeEmployee, OfficeProvider } from '@/components/office/office-scene';
import { OfficeStage, type OfficeSceneData } from '@/components/office/office-stage';
import type { RenderStats } from '@/components/office/office-view';
import type { Task } from '@/lib/contracts';

/**
 * Presets are the scenes the baselines photograph. Each is fully determined by its name, the hour,
 * and the seed, so the same query renders the same frame. Add a preset here and a baseline test in
 * web-tests/lab for every new room or state the scene learns.
 */
const PEOPLE: { name: string; role: string; color: string; traits: string[] }[] = [
  { name: 'Ada', role: 'Operations analyst', color: '#6864d9', traits: ['fast', 'dry humour'] },
  { name: 'Bruno', role: 'Release writer', color: '#b06a3b', traits: ['methodical'] },
  { name: 'Cyrus', role: 'Data engineer', color: '#3b6fb0', traits: ['cautious'] },
  { name: 'Emi', role: 'Product designer', color: '#b03b7a', traits: ['playful'] },
  { name: 'Fen', role: 'Quality lead', color: '#4f8a4b', traits: ['terse'] },
  { name: 'Gil', role: 'Finance analyst', color: '#8a7a2b', traits: ['formal'] },
  { name: 'Hana', role: 'Support lead', color: '#2b8a86', traits: ['warm'] },
  { name: 'Mina', role: 'Marketing', color: '#7a4fb0', traits: ['curious'] },
];

const CARDS: BoardCard[] = [
  { id: 'c1', title: 'Draft the release note', status: 'active', dependsOn: [] },
  { id: 'c2', title: 'Approve the changelog', status: 'waiting', dependsOn: ['c1'] },
  { id: 'c3', title: 'Ship 4.2 to production', status: 'blocked', dependsOn: ['c2'] },
  { id: 'c4', title: 'Collect QA sign-off', status: 'done', dependsOn: [] },
  { id: 'c5', title: 'Update the pricing page', status: 'active', dependsOn: ['c4'] },
  { id: 'c6', title: 'Brief the support team', status: 'waiting', dependsOn: ['c3'] },
];

const SHELVES: ShelfSpec[] = [
  { scope: 'workspace', name: 'Workspace', fill: 0.42, contested: 2 },
  { scope: 'floor', name: 'Release desk', fill: 0.68, contested: 0 },
  { scope: 'project', name: 'September release', fill: 0.52, contested: 0 },
  { scope: 'project', name: 'Pricing refresh', fill: 0.26, contested: 1 },
  { scope: 'agent', name: 'Employees', fill: 0.83, contested: 0 },
  { scope: 'task', name: 'Task dossiers', fill: 0.47, contested: 0 },
];

const CALENDAR = [
  { at: '09:00', label: 'Ada · release shift' },
  { at: '09:30', label: 'Bruno · changelog shift' },
  { at: '11:00', label: 'September release review' },
  { at: '13:00', label: 'Cyrus · warehouse shift' },
  { at: '15:30', label: 'Pricing deadline' },
  { at: '21:00', label: 'Janitor · memory curation' },
  { at: 'Thu 09:00', label: 'Ada · release shift' },
  { at: 'Thu 14:00', label: 'Pricing refresh kick-off' },
];

type Preset = {
  /** One activity per person, in the order of PEOPLE. `undefined` leaves them out of the journal. */
  roles: (Activity | undefined)[];
  kinds?: (EmployeeKind | undefined)[];
  label: string;
  lightBudget?: number;
  providers?: boolean;
  /** Extra state per person: what they are waiting on, whose desk they are at, which alert. */
  detail?: (ids: string[], index: number) => Partial<EmployeeActivity>;
  /** Everything past the people: the room, its props, the schedule, the meeting. */
  dressing?: (ids: string[]) => OfficeDressing;
};

const FLOOR_DAY: (Activity | undefined)[] = [
  'thinking',
  'writing',
  'calling',
  'reviewing',
  'reading',
  'talking',
  'talking',
  'idle',
];
const FLOOR_LABEL = 'Floor 1 · Release desk';

const PRESETS: Record<string, Preset> = {
  lobby: { roles: [], label: 'Lobby' },
  'floor-day': {
    roles: FLOOR_DAY,
    // Reserved kinds walk the floors: an auditor at a console, the janitor, a triage engineer.
    kinds: [undefined, undefined, 'auditor', undefined, undefined, 'janitor', undefined, 'triage'],
    label: FLOOR_LABEL,
  },
  'floor-quiet': { roles: ['idle', 'idle', 'idle'], label: FLOOR_LABEL },
  'floor-celebrate': { roles: ['celebrating', 'failed', 'writing', 'idle'], label: FLOOR_LABEL },
  'floor-night': {
    roles: ['writing', 'idle', 'idle', 'idle', 'idle', 'idle'],
    label: FLOOR_LABEL,
    lightBudget: 0.8,
  },
  'floor-props': {
    roles: ['writing', 'thinking', 'reviewing', 'reading'],
    label: FLOOR_LABEL,
    dressing: (ids) => ({
      memory: {
        floorFill: 0.72,
        agentFills: new Map(ids.map((id, index) => [id, [0.8, 0.35, 0.55, 0.15][index] ?? 0.4])),
        contested: 2,
      },
      board: { cards: CARDS },
      findings: new Map([[ids[1], 2]]),
      incident: true,
    }),
  },
  'after-hours': {
    roles: ['writing', 'idle', 'idle', 'idle'],
    label: FLOOR_LABEL,
    lightBudget: 0.45,
    dressing: () => ({ schedule: { working: false, attended: false, overnightCheap: true } }),
  },
  'lobby-calendar': {
    roles: ['idle', 'idle', 'talking', 'talking', 'idle'],
    label: 'Lobby',
    providers: false,
    dressing: () => ({ room: 'lobby', calendar: CALENDAR }),
  },
  records: {
    roles: ['writing', 'reading'],
    kinds: ['janitor', 'auditor'],
    label: 'Records',
    providers: false,
    dressing: () => ({
      room: 'records',
      records: { shelves: SHELVES },
      memory: { floorFill: 0.68, agentFills: new Map(), contested: 3 },
    }),
  },
  boardroom: {
    roles: ['thinking', 'talking', 'thinking', 'reading', 'thinking'],
    label: 'Boardroom',
    providers: false,
    dressing: (ids) => ({
      room: 'boardroom',
      meeting: { attendeeIds: ids.slice(0, 5), speakingId: ids[1] },
    }),
  },
  triage: {
    roles: ['calling', 'writing', 'thinking', 'idle'],
    kinds: ['triage', 'triage', undefined, 'triage'],
    label: 'Triage',
    dressing: () => ({ room: 'triage', incident: true, incidentCount: 3 }),
  },
  'day-replay': {
    roles: [undefined, undefined, undefined, undefined],
    label: 'Floor 1 · Release desk · Wednesday 9 September',
    providers: false,
  },
  'meeting-live': {
    roles: ['presenting', 'answering', 'thinking', 'thinking', 'reading'],
    label: 'Boardroom · September release review',
    providers: false,
    dressing: (ids) => ({
      room: 'boardroom',
      meeting: { attendeeIds: ids.slice(0, 5), speakingId: ids[0], live: true },
    }),
  },
  'audit-night': {
    roles: ['auditing', 'reporting', 'uneasy', 'off_shift', 'off_shift'],
    kinds: ['auditor'],
    label: FLOOR_LABEL,
    lightBudget: 0.55,
    detail: (ids, index) => (index === 0 ? { visitingId: ids[2] } : {}),
    dressing: (ids) => ({
      schedule: { working: false, attended: false, overnightCheap: true },
      memory: {
        floorFill: 0.62,
        agentFills: new Map(ids.map((id, index) => [id, [0.7, 0.4, 0.55, 0.2, 0.3][index] ?? 0.4])),
        contested: 1,
      },
      findings: new Map([[ids[2], 2]]),
    }),
  },
  incident: {
    roles: ['triaging', 'writing', 'waiting', 'blocked', 'thinking'],
    kinds: ['triage'],
    label: FLOOR_LABEL,
    // A chain the floor can read: Emi is blocked on Cyrus, Cyrus is waiting on
    // Bruno, and Bruno is the one writing. The board card lives on `floor-props`.
    detail: (ids, index) =>
      index === 0
        ? { alertId: 'alr_1' }
        : index === 2
          ? { waitingOn: 'c2', waitingOnId: ids[1] }
          : index === 3
            ? { waitingOn: 'c3', waitingOnId: ids[2] }
            : {},
    dressing: () => ({
      incident: true,
      incidentCount: 2,
      emergency: { title: 'Deployed the checkout fix without approval.', since: NOW - 900_000 },
    }),
  },
};

const PROVIDERS: OfficeProvider[] = [
  { id: 'github', name: 'GitHub', color: '#333b43', degraded: false },
  { id: 'linear', name: 'Linear', color: '#6864d9', degraded: false },
];

const NOW = 1_800_000_000_000;

function buildScene(name: string, hour: number, seed: number) {
  const preset = PRESETS[name] ?? PRESETS['floor-day'];
  const count = preset.roles.length || 6;
  const employees: OfficeEmployee[] = PEOPLE.slice(0, count).map((person, index) => ({
    id: `lab-${seed}-${index}`,
    name: person.name,
    role: person.role,
    status: preset.roles[index] && preset.roles[index] !== 'idle' ? 'working' : 'ready',
    color: person.color,
    traits: person.traits,
    ...(preset.kinds?.[index] ? { kind: preset.kinds[index] } : {}),
  }));
  const activities = new Map<string, EmployeeActivity>();
  employees.forEach((employee, index) => {
    const activity = preset.roles[index];
    if (!activity) return;
    const partner = activity === 'talking' ? employees[index % 2 === 0 ? index + 1 : index - 1] : undefined;
    activities.set(employee.id, {
      ...preset.detail?.(
        employees.map((item) => item.id),
        index,
      ),
      activity,
      since: NOW - 10_000 - index * 1_000,
      bubble:
        activity === 'writing'
          ? 'The changelog is ready. I need approval before writing the release note.'
          : activity === 'talking' && index % 2 === 0
            ? 'Take the release note from here; the copy is signed off.'
            : undefined,
      attention: activity === 'reviewing' ? 'approval' : undefined,
      partnerId: partner?.id,
    });
  });
  const dressing = preset.dressing?.(employees.map((employee) => employee.id)) ?? {};
  const lobby = name === 'lobby' || dressing.room === 'lobby';
  // The whiteboard note belongs to a working floor; the other rooms have no whiteboard.
  const whiteboard = !lobby && dressing.room !== 'records' && dressing.room !== 'boardroom';
  const scene: OfficeSceneData = {
    activities,
    traits: new Map(employees.map((employee) => [employee.id, employee.traits ?? []])),
    providers: preset.providers === false || lobby ? [] : PROVIDERS,
    ...(whiteboard ? { note: 'Ship the September release once the changelog is approved.' } : {}),
    lightBudget: preset.lightBudget ?? 0.2,
    hour,
    ...dressing,
  };
  return { employees, scene, label: preset.label };
}

/**
 * One recorded day on the release desk, to the minute: three people on shift, a
 * meeting at eleven, an alert in the afternoon that triage takes without waiting
 * for an answer, and the night's audit leaving a finding on Bruno's desk.
 */
const REPLAY_DAY = new Date(2026, 8, 9).getTime();
const hours = (value: number) => REPLAY_DAY + value * 3_600_000;

function replayRecord(employees: OfficeEmployee[]): DayRecord {
  const [ada, bruno, cyrus, emi] = employees.map((employee) => employee.id);
  const task = (entry: {
    id: string;
    employeeId: string;
    employeeName: string;
    title: string;
    status: Task['status'];
    from: number;
    to: number;
    kind?: Task['kind'];
    dependsOn?: string[];
  }): Task => ({
    id: entry.id,
    floorId: 'flr_1',
    employeeId: entry.employeeId,
    employeeName: entry.employeeName,
    ...(entry.kind ? { kind: entry.kind } : {}),
    ...(entry.dependsOn ? { dependsOn: entry.dependsOn } : {}),
    createdBy: 'system',
    createdByName: 'Astra HQ',
    isOwner: true,
    visibility: 'workspace' as const,
    title: entry.title,
    prompt: '',
    status: entry.status,
    createdAt: entry.from,
    updatedAt: entry.to,
    model: 'gpt-5.6-terra' as const,
  });
  return {
    from: REPLAY_DAY,
    to: REPLAY_DAY + DAY_MS,
    employees: employees.map((employee) => ({ id: employee.id, name: employee.name })),
    schedule: {
      timezone: 'Europe/London',
      workingDays: [1, 2, 3, 4, 5],
      startHour: 9,
      endHour: 18,
      attendedStartHour: 9,
      attendedEndHour: 18,
      overnightPolicy: 'cheap',
      working: true,
      attended: true,
      usageToday: { input: 0, output: 0, cached: 0, cap: 0 },
    },
    // The day's work, with one dependency on a task nobody in the room owns, so
    // the string from whoever is waiting ends on the board rather than at a desk.
    tasks: [
      task({
        id: 'tsk_triage',
        employeeId: emi,
        employeeName: 'Emi',
        kind: 'triage',
        title: 'Checkout incident',
        status: 'completed',
        from: hours(14.4),
        to: hours(16),
      }),
      task({
        id: 'tsk_changelog',
        employeeId: ada,
        employeeName: 'Ada',
        title: 'Approve the changelog',
        status: 'completed',
        from: hours(9.2),
        to: hours(11),
      }),
      task({
        id: 'tsk_note',
        employeeId: bruno,
        employeeName: 'Bruno',
        title: 'Write the release note',
        status: 'completed',
        from: hours(9.4),
        to: hours(17.2),
        dependsOn: ['tsk_changelog'],
      }),
      task({
        id: 'tsk_pricing',
        employeeId: 'lab-pricing',
        employeeName: 'Gil',
        title: 'Update the pricing page',
        status: 'running',
        from: hours(10),
        to: hours(17.9),
      }),
      task({
        id: 'tsk_brief',
        employeeId: cyrus,
        employeeName: 'Cyrus',
        title: 'Brief the support team',
        status: 'waiting',
        from: hours(12),
        to: hours(12.5),
        dependsOn: ['tsk_pricing'],
      }),
    ],
    shifts: [
      { employeeId: ada, startedAt: hours(9), endedAt: hours(17.5) },
      { employeeId: bruno, startedAt: hours(9.1), endedAt: hours(17.8) },
      { employeeId: cyrus, startedAt: hours(9.3), endedAt: hours(18) },
    ],
    meetings: [
      {
        entry: {
          id: 'cal_review',
          kind: 'meeting',
          title: 'September release review',
          startsAt: hours(11),
          endsAt: hours(11.75),
          attendees: employees.slice(0, 3).map((employee) => ({
            kind: 'employee' as const,
            id: employee.id,
            name: employee.name,
          })),
          agenda: ['Changelog sign-off', 'Pricing page'],
          status: 'scheduled',
        },
        meeting: {
          id: 'mtg_review',
          calendarEntryId: 'cal_review',
          status: 'closed',
          openedAt: hours(11.03),
          closedAt: hours(11.7),
          turns: [
            {
              id: 'trn_1',
              kind: 'question',
              authorName: 'Sam',
              addressedTo: [bruno],
              text: 'Is the changelog signed off?',
              createdAt: hours(11.1),
            },
            {
              id: 'trn_2',
              kind: 'answer',
              authorName: 'Bruno',
              employeeId: bruno,
              text: 'Signed off this morning. The pricing page is the one at risk.',
              createdAt: hours(11.2),
            },
          ],
        },
      },
    ],
    findings: [
      {
        id: 'fnd_1',
        employeeId: bruno,
        employeeName: 'Bruno',
        auditDate: '2026-09-08',
        severity: 'medium',
        claim: 'The report claims the tests pass; the journal has no test run.',
        evidence: 'No tool call between 15:10 and the report.',
        requiredAction: 'Run the tests and post the output.',
        status: 'addressed',
        createdAt: hours(-1.2),
        updatedAt: hours(9.8),
      },
    ],
    alerts: [
      {
        id: 'alr_1',
        source: 'github',
        fingerprint: 'checkout-500',
        severity: 'high',
        title: 'Checkout is returning 500 on card payments.',
        detail: 'Five reports in ten minutes.',
        status: 'closed',
        triageTaskId: 'tsk_triage',
        affectedFloorIds: [],
        occurrences: 5,
        paging: { attempts: 0, required: 3, acknowledged: true },
        createdAt: hours(14.3),
        updatedAt: hours(16.1),
      },
    ],
    notifications: [
      {
        id: 'ntf_1',
        kind: 'triage',
        title: 'Deployed the checkout fix without approval.',
        text: 'Three attempts over twenty minutes went unanswered.',
        alertId: 'alr_1',
        attempt: 3,
        sentAt: hours(15),
      },
    ],
  };
}

export function OfficeLab({
  preset,
  hour,
  labels,
  seed,
  at,
  width,
  height,
}: {
  preset: string;
  hour: number;
  labels: string;
  seed: number;
  /** Hour of the recorded day the replay's scrubber stands on. */
  at: number;
  /** The size of the photographed stage. The baselines are all 1280 by 720. */
  width: number;
  height: number;
}) {
  const { employees, scene, label } = useMemo(() => buildScene(preset, hour, seed), [preset, hour, seed]);
  const [stats, setStats] = useState<RenderStats | null>(null);
  const report = useCallback(
    (next: RenderStats) => setStats((current) => (current?.calls === next.calls ? current : next)),
    [],
  );
  const record = useMemo(() => replayRecord(employees), [employees]);
  // The lab reports what a click landed on, so a merged room can be shown to be
  // as clickable as the loose one it replaced.
  const [picked, setPicked] = useState('');
  return (
    <>
      <main className="office-lab" data-preset={preset} style={{ width, height, margin: 0 }}>
        {preset === 'day-replay' ? (
          <DayReplay
            employees={employees}
            label={label}
            labels={labels as LabelMode}
            record={record}
            startAt={at * 3_600_000}
            onSelect={(id) => setPicked(`employee ${id}`)}
            onSelectProp={(kind, id) => setPicked(id ? `${kind} ${id}` : kind)}
          />
        ) : (
          <OfficeStage
            live={false}
            scene={scene}
            employees={employees}
            label={label}
            labels={labels as LabelMode}
            onRenderStats={report}
            onSelect={(id) => setPicked(`employee ${id}`)}
            onSelectProp={(kind, id) => setPicked(id ? `${kind} ${id}` : kind)}
          />
        )}
      </main>
      {/* Outside the photographed stage, so the read-out never lands in a baseline. */}
      <p
        data-office-stats={stats ? String(stats.calls) : ''}
        data-office-picked={picked}
        style={{ font: '12px ui-monospace, monospace', margin: '6px 0 0' }}
      >
        {stats
          ? `${stats.calls} draw calls · ${stats.meshes} meshes (${stats.casters} casting shadows) · ${stats.triangles.toLocaleString()} triangles · ${stats.geometries} geometries`
          : 'measuring…'}
      </p>
    </>
  );
}
