'use client';

import dynamic from 'next/dynamic';
import { useMemo } from 'react';
import { deriveActivities, deriveFloorSignals, type DayInput, type EmployeeActivity } from './activity';
import { startOfDay } from './day-replay';
import type { LabelMode } from './office-labels';
import { boardCards, type CalendarEntry, type MemoryFill } from './office-layout';
import type { SelectProp } from './office-props';
import type { OfficeDressing, OfficeEmployee, OfficeProvider, OfficeRoom } from './office-scene';
import type { RenderStats } from './office-view';
import { C } from './palette';
import { useActivityCues } from './sound';
import { useDayQueries, useNow, useWeekCalendar } from './use-day';
import { useFloorMemory } from './use-memory';
import { useUiQuery } from '@/components/shared/use-ui-query';
import type { Dashboard, FloorPost } from '@/lib/contracts';
import { providers as providerCatalog } from '@/lib/providers';
import { nextWorkingStart } from '@/lib/time';
import { asId, uiApi } from '@/lib/ui-api';

const OfficeView = dynamic(() => import('./office-view'), { ssr: false });

const NOTE_CHARS = 120;
const DEGRADED = new Set(['degraded', 'revoked']);

/** Everything the office needs beyond its people. Replay supplies this directly. */
export type OfficeSceneData = {
  activities: Map<string, EmployeeActivity>;
  /** Persona traits per employee. They only tune the idle animations. */
  traits?: Map<string, string[]>;
  providers: OfficeProvider[];
  note?: string;
  /** Fraction of the workspace token cap used, 0 to 1. */
  lightBudget: number;
  /** Local hour override, for replay and tests. */
  hour?: number;
} & OfficeDressing;

const emptyScene: OfficeSceneData = { activities: new Map(), providers: [], lightBudget: 0 };

export type OfficeStageProps = {
  /** Who is on this floor, in the shape the 3D scene understands. */
  employees: OfficeEmployee[];
  /** The floor being shown. Omit for the lobby, which holds unassigned work. */
  floorId?: string;
  /** Whether a Convex client exists. Without one the office stays furnished and still. */
  live: boolean;
  /** The workspace as the page reads it. The office derives the whole room from it. */
  dashboard?: Dashboard;
  /** Which room of the tower this is. A floor by default. */
  room?: OfficeRoom;
  /** Overrides live data, so replay never touches the subscription. */
  scene?: OfficeSceneData;
  archived?: boolean;
  label?: string;
  emptyMessage?: string;
  /** What the legend's Labels control is set to. */
  labels?: LabelMode;
  onSelect?: (id: string) => void;
  /** Called when a prop is clicked: the binder, a notebook, a card, a shelf, a lamp. */
  onSelectProp?: SelectProp;
  /** Reports what the renderer did on the last frame. Only the lab asks. */
  onRenderStats?: (stats: RenderStats) => void;
};

const NO_DAY: DayInput = {};

/** Everything the live office reads, in one argument, so the derivation stays one function. */
export type SceneInput = {
  dashboard: Dashboard;
  /** This floor's channel, which is where the whiteboard note comes from. */
  posts: FloorPost[];
  /** Who the room is showing, which is who the day is derived for. */
  employees: { id: string; name: string }[];
  /** The floor on show. Omit for the lobby, which holds unassigned work. */
  floorId?: string;
  now: number;
  /** The rest of the workspace's day: shifts, meetings, findings, alerts, pages. */
  day?: DayInput;
  room?: OfficeRoom;
  /** How full the floor's memory and its instances' notebooks are. */
  memory?: MemoryFill;
  /** The week on the lobby's calendar wall. */
  calendar?: CalendarEntry[];
};

/** Turns one dashboard, one board and the day around them into everything the room shows. */
export function deriveScene({
  dashboard,
  posts,
  employees,
  floorId,
  now,
  day: around = NO_DAY,
  room,
  memory,
  calendar,
}: SceneInput): OfficeSceneData {
  const tasks = dashboard.tasks.filter((task) => (floorId ? task.floorId === floorId : !task.floorId));
  const taskIds = new Set(tasks.map((task) => task.id));
  const connected = dashboard.connections.filter((connection) => connection.status === 'connected');
  const providers: OfficeProvider[] = [];
  for (const connection of connected) {
    if (providers.some((provider) => provider.id === connection.provider)) continue;
    providers.push({
      id: connection.provider,
      name: providerCatalog.find((item) => item.id === connection.provider)?.name ?? connection.provider,
      color: providerCatalog.find((item) => item.id === connection.provider)?.color ?? C.metalDeep,
      degraded: dashboard.connections.some(
        (other) => other.provider === connection.provider && DEGRADED.has(other.status),
      ),
    });
  }
  const cap = dashboard.workspace?.monthlyTokenCap ?? 0;
  const used = (dashboard.workspace?.usage.byModel ?? []).reduce(
    (total, row) => total + row.input + row.output,
    0,
  );
  const note = [...posts].reverse().find((post) => post.kind === 'note');
  // The workspace's hours belong to the day: they are what makes somebody off
  // shift, and what turns the end of a shift into writing the day's report.
  const day: DayInput = {
    ...around,
    ...(dashboard.schedule ? { schedule: dashboard.schedule } : {}),
  };
  const signals = deriveFloorSignals(day, floorId, now);
  const cards = floorId ? boardCards(tasks) : [];
  return {
    traits: new Map(
      dashboard.employees
        .filter((employee) => employee.persona?.traits.length)
        .map((employee) => [employee.id, employee.persona!.traits]),
    ),
    activities: deriveActivities({
      employees,
      tasks,
      events: dashboard.events.filter((event) => event.taskId && taskIds.has(event.taskId)),
      proposals: dashboard.proposals,
      posts,
      now,
      day,
    }),
    providers,
    ...(note ? { note: note.text.slice(0, NOTE_CHARS) } : {}),
    lightBudget: cap > 0 ? Math.min(1, used / cap) : 0,
    // The room follows the viewer's clock rather than the hour it was opened at.
    hour: new Date(now).getHours(),
    ...(room ? { room } : {}),
    ...(cards.length ? { board: { cards } } : {}),
    ...(memory ? { memory } : {}),
    ...(calendar?.length ? { calendar } : {}),
    ...(signals.incident ? { incident: true, incidentCount: signals.incidentCount } : {}),
    ...(signals.emergency ? { emergency: signals.emergency } : {}),
    ...(signals.meeting ? { meeting: signals.meeting } : {}),
    ...(signals.findings.size ? { findings: signals.findings } : {}),
    ...(dashboard.schedule
      ? {
          schedule: {
            working: dashboard.schedule.working,
            attended: dashboard.schedule.attended,
            overnightCheap: dashboard.schedule.overnightPolicy === 'cheap',
          },
        }
      : {}),
  };
}

/**
 * The office, dressed by the workspace the page is showing. A scene given to it —
 * a replay, or the lab — dresses itself and is shown as it stands; without a
 * workspace to read, the room is furnished and still.
 */
export function OfficeStage({ live, scene, room, dashboard, ...props }: OfficeStageProps) {
  const still = useMemo(() => (room ? { ...emptyScene, room } : emptyScene), [room]);
  if (scene) return <Stage {...props} scene={scene} />;
  if (!live || !dashboard) return <Stage {...props} scene={still} />;
  return <LiveStage {...props} room={room} dashboard={dashboard} />;
}

function LiveStage({
  dashboard,
  ...props
}: Omit<OfficeStageProps, 'live' | 'scene' | 'dashboard'> & { dashboard: Dashboard }) {
  const posts = useUiQuery(
    uiApi.floorBoard,
    props.floorId ? { floorId: asId<'floors'>(props.floorId) } : 'skip',
  );
  const now = useNow(5_000);
  const midnight = startOfDay(now);
  const day = useDayQueries(midnight);
  const memory = useFloorMemory(props.floorId);
  const calendar = useWeekCalendar(props.room === 'lobby' ? midnight : undefined);
  const { employees, floorId, room } = props;
  const scene = useMemo(
    () =>
      deriveScene({
        dashboard,
        posts: posts ?? [],
        employees,
        ...(floorId ? { floorId } : {}),
        now,
        day,
        ...(room ? { room } : {}),
        ...(memory ? { memory } : {}),
        calendar,
      }),
    [dashboard, posts, employees, floorId, now, day, room, memory, calendar],
  );
  useActivityCues(scene.activities);
  const notice = useMemo(
    () => offShiftNotice(employees, scene, now, dashboard),
    [employees, scene, now, dashboard],
  );
  return <Stage {...props} scene={scene} notice={notice} />;
}

/** When everyone in the room has gone home, say so and when they are back, in the workspace's zone. */
function offShiftNotice(
  employees: OfficeEmployee[],
  scene: OfficeSceneData,
  now: number,
  dashboard: Dashboard,
): string | undefined {
  if (!employees.length || !dashboard.schedule) return undefined;
  const everyoneOff = employees.every(
    (employee) => scene.activities.get(employee.id)?.activity === 'off_shift',
  );
  if (!everyoneOff) return undefined;
  const back = nextWorkingStart(now, dashboard.schedule);
  if (!back) return 'Everyone is off shift.';
  const when = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: dashboard.schedule.timezone,
  }).format(back);
  return `Everyone is off shift. Back ${when}.`;
}

function Stage({
  employees,
  scene,
  archived,
  label,
  emptyMessage,
  notice,
  labels,
  onSelect,
  onSelectProp,
  onRenderStats,
}: Omit<OfficeStageProps, 'live' | 'floorId'> & { scene: OfficeSceneData; notice?: string }) {
  const dressed = useMemo(
    () =>
      employees.map((employee) => {
        const state = scene.activities.get(employee.id);
        const traits = scene.traits?.get(employee.id);
        return { ...employee, ...(state ? { state } : {}), ...(traits ? { traits } : {}) };
      }),
    [employees, scene],
  );
  return (
    <OfficeView
      employees={dressed}
      onSelect={onSelect}
      label={label}
      emptyMessage={emptyMessage}
      notice={notice}
      archived={archived}
      labels={labels}
      providers={scene.providers}
      note={scene.note}
      lightBudget={scene.lightBudget}
      hour={scene.hour}
      dressing={scene}
      onSelectProp={onSelectProp}
      onRenderStats={onRenderStats}
    />
  );
}
