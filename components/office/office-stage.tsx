'use client';

import dynamic from 'next/dynamic';
import { useQuery } from 'convex/react';
import { useEffect, useMemo, useState } from 'react';
import type { Dashboard, ProjectPost } from '@/lib/contracts';
import { providers as providerCatalog } from '@/lib/providers';
import { asId, uiApi } from '@/lib/ui-api';
import { deriveActivities, type EmployeeActivity } from './activity';
import { useActivityCues } from './sound';
import type { OfficeEmployee, OfficeProvider } from './office-scene';

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
};

const emptyScene: OfficeSceneData = { activities: new Map(), providers: [], lightBudget: 0 };

export type OfficeStageProps = {
  /** Who is on this floor, in the shape the 3D scene understands. */
  employees: OfficeEmployee[];
  /** The floor being shown. Omit for the lobby, which holds unassigned work. */
  projectId?: string;
  /** Whether a Convex client exists. Without one the office stays furnished and still. */
  live: boolean;
  /** Overrides live data, so replay never touches the subscription. */
  scene?: OfficeSceneData;
  archived?: boolean;
  label?: string;
  emptyMessage?: string;
  onSelect?: (id: string) => void;
};

/** Turns one dashboard and one board into everything the room shows. */
export function deriveScene(
  dashboard: Dashboard,
  posts: ProjectPost[],
  projectId: string | undefined,
  now: number,
): OfficeSceneData {
  const tasks = dashboard.tasks.filter((task) =>
    projectId ? task.projectId === projectId : !task.projectId,
  );
  const taskIds = new Set(tasks.map((task) => task.id));
  const connected = dashboard.connections.filter((connection) => connection.status === 'connected');
  const providers: OfficeProvider[] = [];
  for (const connection of connected) {
    if (providers.some((provider) => provider.id === connection.provider)) continue;
    providers.push({
      id: connection.provider,
      name: providerCatalog.find((item) => item.id === connection.provider)?.name ?? connection.provider,
      color: providerCatalog.find((item) => item.id === connection.provider)?.color ?? '#607565',
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
  return {
    traits: new Map(
      dashboard.employees
        .filter((employee) => employee.persona?.traits.length)
        .map((employee) => [employee.id, employee.persona!.traits]),
    ),
    activities: deriveActivities({
      employees: dashboard.employees,
      tasks,
      events: dashboard.events.filter((event) => event.taskId && taskIds.has(event.taskId)),
      proposals: dashboard.proposals,
      posts,
      now,
    }),
    providers,
    ...(note ? { note: note.text.slice(0, NOTE_CHARS) } : {}),
    lightBudget: cap > 0 ? Math.min(1, used / cap) : 0,
  };
}

/**
 * The office, dressed by the journal. With a Convex client it subscribes for the
 * dashboard and the floor board itself, so the pages above it keep their own shape.
 */
export function OfficeStage({ live, scene, ...props }: OfficeStageProps) {
  if (scene) return <Stage {...props} scene={scene} />;
  if (!live) return <Stage {...props} scene={emptyScene} />;
  return <LiveStage {...props} />;
}

/** Activities age out on their own, so the office re-reads the journal on a slow tick. */
function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function LiveStage(props: Omit<OfficeStageProps, 'live' | 'scene'>) {
  const dashboard = useQuery(uiApi.dashboard, {});
  const posts = useQuery(
    uiApi.projectBoard,
    props.projectId ? { projectId: asId<'projects'>(props.projectId) } : 'skip',
  );
  const now = useNow(5_000);
  const scene = useMemo(
    () => (dashboard ? deriveScene(dashboard, posts ?? [], props.projectId, now) : emptyScene),
    [dashboard, posts, props.projectId, now],
  );
  useActivityCues(scene.activities);
  return <Stage {...props} scene={scene} />;
}

function Stage({
  employees,
  scene,
  archived,
  label,
  emptyMessage,
  onSelect,
}: Omit<OfficeStageProps, 'live' | 'projectId'> & { scene: OfficeSceneData }) {
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
      archived={archived}
      providers={scene.providers}
      note={scene.note}
      lightBudget={scene.lightBudget}
      hour={scene.hour}
    />
  );
}
