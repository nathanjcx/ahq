/**
 * The roadmap timeline as plain numbers. A proposal and a confirmed project both become the same
 * model — rows of bars on a shared time axis with the milestones marked — so one component draws
 * both and the arithmetic can be tested without a browser.
 */
import type { MilestoneStatus, Project, ProjectTask, RoadmapProposal, TaskStatus } from '@/lib/contracts';

const DAY = 86_400_000;
/** Height of one timeline row in pixels. The stylesheet takes it from the container. */
export const ROW_HEIGHT = 34;
/** Hours in a working day, for turning an estimate into a length on the axis. */
const WORKING_HOURS = 8;
/** The shortest axis worth drawing: a roadmap inside a day still reads as a fortnight. */
const MIN_SPAN = 14 * DAY;

export interface TimelineBar {
  id: string;
  title: string;
  startAt: number;
  endAt: number;
  dependsOn: string[];
  /** A confirmed task carries its status; a proposed one has none yet. */
  status?: TaskStatus;
  row: number;
}
export interface TimelineRow {
  key: string;
  floorName: string;
  /** True on the first row of a floor, so the labels can rule a line above it. */
  firstOfFloor: boolean;
  employeeName: string;
  bars: TimelineBar[];
}
export interface TimelineMarker {
  id: string;
  title: string;
  at: number;
  status: MilestoneStatus;
  behind: boolean;
}
export interface Timeline {
  startAt: number;
  endAt: number;
  /** The clock when the timeline was built, for the today line and the behind markers. */
  todayAt: number;
  rows: TimelineRow[];
  markers: TimelineMarker[];
  /** Week ticks along the axis. */
  ticks: number[];
  /** Total height of the rows, in pixels. */
  height: number;
}
/** One bar before it knows which row it sits on. */
interface BarInput extends Omit<TimelineBar, 'row'> {
  floorName: string;
  employeeName: string;
}

/** Where a moment falls on the axis, as a fraction of its width. */
export function fraction(timeline: Pick<Timeline, 'startAt' | 'endAt'>, at: number) {
  const span = timeline.endAt - timeline.startAt;
  return span <= 0 ? 0 : Math.min(1, Math.max(0, (at - timeline.startAt) / span));
}

/** The dependency strings: one line from the end of a bar to the start of the bar that waits for it. */
export function dependencyEdges(timeline: Timeline) {
  const bars = new Map(timeline.rows.flatMap((row) => row.bars).map((bar) => [bar.id, bar]));
  const middle = (bar: TimelineBar) => bar.row * ROW_HEIGHT + ROW_HEIGHT / 2;
  return timeline.rows
    .flatMap((row) => row.bars)
    .flatMap((bar) =>
      bar.dependsOn.flatMap((id) => {
        const from = bars.get(id);
        if (!from) return [];
        return [
          {
            key: `${id}-${bar.id}`,
            x1: fraction(timeline, from.endAt),
            y1: middle(from),
            x2: fraction(timeline, bar.startAt),
            y2: middle(bar),
          },
        ];
      }),
    );
}

function build(bars: BarInput[], markers: TimelineMarker[], now: number): Timeline {
  const moments = [...bars.flatMap((bar) => [bar.startAt, bar.endAt]), ...markers.map((marker) => marker.at)];
  const from = moments.length ? Math.min(...moments) : now;
  const to = moments.length ? Math.max(...moments) : from + MIN_SPAN;
  const span = Math.max(MIN_SPAN, to - from);
  // A margin at each end so a bar that ends on the last day is not flush against the edge.
  const startAt = from - span * 0.04;
  const endAt = from + span * 1.06;

  const rows: TimelineRow[] = [];
  const floors = [...new Set(bars.map((bar) => bar.floorName))];
  for (const floorName of floors) {
    const onFloor = bars.filter((bar) => bar.floorName === floorName);
    for (const employeeName of [...new Set(onFloor.map((bar) => bar.employeeName))]) {
      const row = rows.length;
      rows.push({
        key: `${floorName}-${employeeName}`,
        floorName,
        firstOfFloor: !rows.some((entry) => entry.floorName === floorName),
        employeeName,
        bars: onFloor
          .filter((bar) => bar.employeeName === employeeName)
          .map(({ floorName: _floor, employeeName: _employee, ...bar }) => ({ ...bar, row })),
      });
    }
  }

  const ticks: number[] = [];
  for (let at = Math.ceil(startAt / (7 * DAY)) * 7 * DAY; at < endAt; at += 7 * DAY) ticks.push(at);
  return { startAt, endAt, todayAt: now, rows, markers, ticks, height: rows.length * ROW_HEIGHT };
}

/** A roadmap nobody has confirmed yet. Bars run back from their deadline by the planner's estimate. */
export function proposalTimeline(
  proposal: RoadmapProposal,
  names: { floor: (id: string) => string; employee: (id?: string) => string },
): Timeline {
  const now = Date.now();
  const bars: BarInput[] = [];
  const markers: TimelineMarker[] = [];
  for (const [index, milestone] of proposal.milestones.entries()) {
    if (milestone.deadlineAt !== undefined)
      markers.push({
        id: milestone.key,
        title: `${index + 1}. ${milestone.title}`,
        at: milestone.deadlineAt,
        status: 'planned',
        behind: false,
      });
    for (const task of milestone.tasks) {
      const endAt = task.deadlineAt ?? milestone.deadlineAt ?? now + 7 * DAY;
      const length = Math.max(DAY, (task.estimate.workingHours / WORKING_HOURS) * DAY);
      bars.push({
        id: task.key,
        title: task.title,
        startAt: endAt - length,
        endAt,
        dependsOn: task.dependsOn,
        floorName: names.floor(task.floorId),
        employeeName: names.employee(task.employeeId),
      });
    }
  }
  return build(bars, markers, now);
}

/** A confirmed roadmap: real tasks between the day they were created and the day they are due. */
export function projectTimeline(
  project: Project,
  tasks: ProjectTask[],
  names: { floor: (id?: string) => string },
): Timeline {
  const now = Date.now();
  const bars: BarInput[] = tasks.map((task) => ({
    id: task.id,
    title: task.title,
    startAt: task.createdAt,
    endAt: Math.max(task.deadlineAt ?? task.updatedAt + DAY, task.createdAt + DAY),
    dependsOn: task.dependsOn,
    status: task.status,
    floorName: names.floor(task.floorId),
    employeeName: task.employeeName,
  }));
  const markers = project.milestones
    .filter((milestone) => milestone.deadlineAt !== undefined)
    .map((milestone, index) => ({
      id: milestone.id,
      title: `${index + 1}. ${milestone.title}`,
      at: milestone.deadlineAt ?? now,
      status: milestone.status,
      behind: milestone.status !== 'done' && (milestone.deadlineAt ?? now) < now,
    }));
  return build(bars, markers, now);
}

/** The next milestone deadline still ahead of the project, if it has one. */
export function nextDeadline(project: Project) {
  const now = Date.now();
  return project.milestones
    .filter((milestone) => milestone.status !== 'done' && milestone.deadlineAt !== undefined)
    .map((milestone) => milestone.deadlineAt ?? 0)
    .sort((a, b) => a - b)
    .find((at) => at >= now);
}

