'use client';

import { useCallback, useMemo, useState } from 'react';
import type { Activity, EmployeeActivity } from '@/components/office/activity';
import type { LabelMode } from '@/components/office/office-labels';
import type { BoardCard, ShelfSpec } from '@/components/office/office-layout';
import type { EmployeeKind } from '@/components/office/office-people';
import type { OfficeDressing, OfficeEmployee, OfficeProvider } from '@/components/office/office-scene';
import { OfficeStage, type OfficeSceneData } from '@/components/office/office-stage';
import type { RenderStats } from '@/components/office/office-view';

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
  { at: '17:00', label: 'Audit pass · Floor 1' },
  { at: '21:00', label: 'Janitor · memory curation' },
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
    detail: (_ids, index) =>
      index === 0
        ? { alertId: 'alr_1', bubble: 'Checkout is returning 500 on card payments.' }
        : index === 2
          ? { waitingOn: 'c2' }
          : index === 3
            ? { waitingOn: 'c3' }
            : {},
    dressing: () => ({
      board: { cards: CARDS },
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

export function OfficeLab({
  preset,
  hour,
  labels,
  seed,
}: {
  preset: string;
  hour: number;
  labels: string;
  seed: number;
}) {
  const { employees, scene, label } = useMemo(() => buildScene(preset, hour, seed), [preset, hour, seed]);
  const [stats, setStats] = useState<RenderStats | null>(null);
  const report = useCallback(
    (next: RenderStats) => setStats((current) => (current?.calls === next.calls ? current : next)),
    [],
  );
  return (
    <>
      <main className="office-lab" data-preset={preset} style={{ width: 1280, height: 720, margin: 0 }}>
        <OfficeStage
          live={false}
          scene={scene}
          employees={employees}
          label={label}
          labels={labels as LabelMode}
          onRenderStats={report}
        />
      </main>
      {/* Outside the photographed stage, so the read-out never lands in a baseline. */}
      <p
        data-office-stats={stats ? String(stats.calls) : ''}
        style={{ font: '12px ui-monospace, monospace', margin: '6px 0 0' }}
      >
        {stats
          ? `${stats.calls} draw calls · ${stats.triangles.toLocaleString()} triangles · ${stats.geometries} geometries · ${stats.textures} textures`
          : 'measuring…'}
      </p>
    </>
  );
}
