import { useId, useMemo, useState } from 'react';
import {
  ArrowRight,
  CalendarDays,
  Check,
  Circle,
  GitBranch,
  List,
  Plus,
  Search,
  Target,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { AppState, Commitment } from '../../shared/types';
import { dueLabel, employeeById } from '../lib/store';
import Avatar from './Avatar';
import './roadmap.css';

type RoadmapProps = {
  state: AppState;
  onSelect: (commitment: Commitment) => void;
  onCreate: () => void;
  onEditGoal: () => void;
};

const CARD_WIDTH = 258;
const CARD_HEIGHT = 184;
const COLUMN_STEP = 338;
const ROW_STEP = 220;
const TOP = 66;
const LEFT = 36;
const statusLabels: Record<Commitment['status'], string> = {
  planned: 'Planned',
  'in-progress': 'In progress',
  review: 'Your review',
  done: 'Completed',
};

type RoadmapNode = { commitment: Commitment; x: number; y: number; level: number };
type RoadmapEdge = { from: RoadmapNode; to?: RoadmapNode; loop: boolean };

// Condense dependency loops before laying out the graph. A loop remains visible,
// but cannot prevent its milestones or later milestones from appearing.
export function buildRoadmapGraph(commitments: Commitment[]) {
  const byId = new Map(commitments.map((commitment) => [commitment.id, commitment]));
  const sequence = [...byId.values()];
  const order = new Map(sequence.map((commitment, index) => [commitment.id, index]));
  const dependencies = new Map(
    sequence.map((commitment) => [
      commitment.id,
      [...new Set(commitment.dependencies)].filter((id) => byId.has(id)),
    ]),
  );
  let cursor = 0;
  const indices = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];
  const componentById = new Map<string, number>();

  function visit(id: string) {
    indices.set(id, cursor);
    low.set(id, cursor++);
    stack.push(id);
    onStack.add(id);
    for (const dependency of dependencies.get(id) ?? []) {
      if (!indices.has(dependency)) {
        visit(dependency);
        low.set(id, Math.min(low.get(id)!, low.get(dependency)!));
      } else if (onStack.has(dependency)) {
        low.set(id, Math.min(low.get(id)!, indices.get(dependency)!));
      }
    }
    if (low.get(id) !== indices.get(id)) return;
    const component: string[] = [];
    let member: string;
    do {
      member = stack.pop()!;
      onStack.delete(member);
      componentById.set(member, components.length);
      component.push(member);
    } while (member !== id);
    components.push(component);
  }
  for (const commitment of sequence) if (!indices.has(commitment.id)) visit(commitment.id);

  const next = components.map(() => new Set<number>());
  const pending = components.map(() => 0);
  for (const commitment of sequence) {
    const target = componentById.get(commitment.id)!;
    for (const dependency of dependencies.get(commitment.id) ?? []) {
      const source = componentById.get(dependency)!;
      if (source !== target && !next[source].has(target)) {
        next[source].add(target);
        pending[target]++;
      }
    }
  }
  const levels = components.map(() => 0);
  const queue = pending.flatMap((count, index) => (count === 0 ? [index] : []));
  for (let index = 0; index < queue.length; index++) {
    const source = queue[index];
    for (const target of next[source]) {
      levels[target] = Math.max(levels[target], levels[source] + 1);
      if (--pending[target] === 0) queue.push(target);
    }
  }
  const maxLevel = levels.length ? Math.max(...levels) : 0;
  const columns = Array.from({ length: maxLevel + 1 }, () => [] as Commitment[]);
  for (const commitment of sequence) columns[levels[componentById.get(commitment.id)!]].push(commitment);
  for (const column of columns) column.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  const nodes: RoadmapNode[] = columns.flatMap((column, level) =>
    column.map((commitment, row) => ({
      commitment,
      level,
      x: LEFT + level * COLUMN_STEP,
      y: TOP + row * ROW_STEP,
    })),
  );
  const nodeById = new Map(nodes.map((node) => [node.commitment.id, node]));
  const edges: RoadmapEdge[] = [];
  for (const node of nodes) {
    for (const dependency of dependencies.get(node.commitment.id) ?? []) {
      edges.push({
        from: nodeById.get(dependency)!,
        to: node,
        loop: componentById.get(dependency) === componentById.get(node.commitment.id),
      });
    }
    if (next[componentById.get(node.commitment.id)!].size === 0) {
      edges.push({ from: node, loop: false });
    }
  }
  const goal = { x: LEFT + (maxLevel + 1) * COLUMN_STEP, y: TOP };
  return {
    nodes,
    edges,
    columns,
    goal,
    width: goal.x + 300 + LEFT,
    height: Math.max(390, TOP + Math.max(1, ...columns.map((column) => column.length)) * ROW_STEP),
    hasLoops: edges.some((edge) => edge.loop),
    hasMissing: sequence.some((commitment) => commitment.dependencies.some((id) => !byId.has(id))),
  };
}

function edgePath(edge: RoadmapEdge, goal: { x: number; y: number }) {
  const startX = edge.from.x + CARD_WIDTH;
  const startY = edge.from.y + CARD_HEIGHT / 2;
  const endX = edge.to?.x ?? goal.x;
  const endY = (edge.to?.y ?? goal.y) + CARD_HEIGHT / 2;
  if (edge.loop) {
    const top = Math.min(startY, endY) - CARD_HEIGHT / 2 - 18;
    return `M ${startX} ${startY} C ${startX + 38} ${startY}, ${startX + 38} ${top}, ${startX} ${top} L ${endX - 18} ${top} Q ${endX - 28} ${top}, ${endX - 28} ${top + 12} L ${endX - 28} ${endY - 12} Q ${endX - 28} ${endY}, ${endX - 12} ${endY} L ${endX - 5} ${endY}`;
  }
  const bend = Math.max(38, (endX - startX) / 2);
  return `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX - 5} ${endY}`;
}

function progressFor(commitment: Commitment) {
  return commitment.status === 'done' ? 100 : Math.round(Math.max(0, Math.min(100, commitment.progress)));
}

export default function Roadmap({ state, onSelect, onCreate, onEditGoal }: RoadmapProps) {
  const [view, setView] = useState<'graph' | 'list'>('graph');
  const [zoom, setZoom] = useState(1);
  const [query, setQuery] = useState('');
  const markerId = useId().replace(/:/g, '');
  const graph = useMemo(() => buildRoadmapGraph(state.commitments), [state.commitments]);
  const completed = state.commitments.filter((commitment) => commitment.status === 'done').length;
  const reviews = state.commitments.filter((commitment) => commitment.status === 'review').length;
  const matching = state.commitments.filter((commitment) =>
    `${commitment.title} ${commitment.description} ${employeeById(state.employees, commitment.ownerId)?.name ?? ''}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );

  function milestoneCard(commitment: Commitment, node?: RoadmapNode) {
    const owner = employeeById(state.employees, commitment.ownerId);
    const dependencies = [...new Set(commitment.dependencies)];
    const waiting = dependencies.filter(
      (id) => state.commitments.find((item) => item.id === id)?.status !== 'done',
    );
    const deadline =
      commitment.deadline && Number.isFinite(new Date(commitment.deadline).getTime())
        ? dueLabel(commitment.deadline)
        : 'No date yet';
    return (
      <button
        key={commitment.id}
        className={`roadmap-milestone ${node ? 'roadmap-positioned' : ''} roadmap-status-${commitment.status}`}
        style={node ? { left: node.x, top: node.y, width: CARD_WIDTH, height: CARD_HEIGHT } : undefined}
        onClick={() => onSelect(commitment)}
        aria-label={`${commitment.title}. ${statusLabels[commitment.status]}. ${progressFor(commitment)} percent complete. Assigned to ${owner?.name ?? 'you'}.${dependencies.length ? ` Depends on ${dependencies.map((id) => state.commitments.find((item) => item.id === id)?.title ?? 'an unavailable milestone').join(', ')}.` : ''} Open milestone.`}
        title={commitment.title}
      >
        <span className="roadmap-milestone-top">
          <span className="roadmap-status">
            {commitment.status === 'done' ? <Check size={12} /> : <Circle size={8} fill="currentColor" />}
            {statusLabels[commitment.status]}
          </span>
          <ArrowRight size={14} />
        </span>
        <strong className="roadmap-milestone-title">{commitment.title}</strong>
        <span className="roadmap-milestone-next">
          {commitment.nextStep || commitment.description || 'Open this milestone to shape the next step.'}
        </span>
        <span className="roadmap-milestone-meta">
          <span>
            <Avatar employee={owner} size={22} />
            {owner?.name ?? 'You'}
          </span>
          <span>
            <CalendarDays size={12} />
            {deadline}
          </span>
        </span>
        <span className="roadmap-progress-track" aria-hidden="true">
          <span style={{ width: `${progressFor(commitment)}%` }} />
        </span>
        <span className="roadmap-milestone-bottom">
          <span>{progressFor(commitment)}%</span>
          <span>
            {waiting.length && commitment.status !== 'done'
              ? `Waiting on ${waiting.length}`
              : dependencies.length
                ? `${dependencies.length} linked`
                : 'Independent step'}
          </span>
        </span>
      </button>
    );
  }

  const goalCard = (
    <button
      className="roadmap-goal roadmap-positioned"
      style={{ left: graph.goal.x, top: graph.goal.y }}
      onClick={onEditGoal}
      title={state.goal}
      aria-label={`Workspace goal: ${state.goal}. Edit goal.`}
    >
      <span className="roadmap-goal-icon">
        <Target size={24} strokeWidth={1.6} />
      </span>
      <span className="roadmap-goal-label">THE GOAL</span>
      <strong>{state.goal || 'Give your team a shared direction.'}</strong>
      <span className="roadmap-goal-caption">
        {completed} of {state.commitments.length} milestones completed
      </span>
      <span className="roadmap-goal-edit">
        Refine the goal <ArrowRight size={13} />
      </span>
    </button>
  );

  return (
    <section className="roadmap-page" aria-label="Project roadmap">
      <div className="roadmap-surface">
        <div className="roadmap-toolbar">
          <div className="roadmap-view-switch" role="group" aria-label="Roadmap view">
            <button
              className={view === 'graph' ? 'selected' : ''}
              aria-pressed={view === 'graph'}
              onClick={() => setView('graph')}
            >
              <GitBranch size={15} />
              Graph
            </button>
            <button
              className={view === 'list' ? 'selected' : ''}
              aria-pressed={view === 'list'}
              onClick={() => setView('list')}
            >
              <List size={15} />
              List
            </button>
          </div>
          <div className="roadmap-totals">
            <span>{state.commitments.length} milestones</span>
            <span>
              <Check size={13} />
              {completed} completed
            </span>
            {reviews > 0 && <span className="roadmap-review-count">{reviews} to review</span>}
          </div>
          {view === 'graph' && (
            <div className="roadmap-zoom" role="group" aria-label="Graph zoom">
              <button
                aria-label="Zoom out roadmap"
                disabled={zoom <= 0.5}
                onClick={() => setZoom((current) => Math.max(0.5, +(current - 0.1).toFixed(1)))}
              >
                <ZoomOut size={16} />
              </button>
              <button
                className="roadmap-zoom-reset"
                onClick={() => setZoom(1)}
                aria-label="Reset roadmap zoom"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                aria-label="Zoom in roadmap"
                disabled={zoom >= 1.3}
                onClick={() => setZoom((current) => Math.min(1.3, +(current + 0.1).toFixed(1)))}
              >
                <ZoomIn size={16} />
              </button>
            </div>
          )}
        </div>
        {view === 'graph' ? (
          <div
            className="roadmap-graph-scroll"
            tabIndex={0}
            role="region"
            aria-label="Milestone dependency graph. Scroll to explore, or switch to List for a compact view."
          >
            <div style={{ width: graph.width * zoom, height: graph.height * zoom }}>
              <div
                className="roadmap-canvas"
                style={{ width: graph.width, height: graph.height, transform: `scale(${zoom})` }}
              >
                <svg
                  className="roadmap-connections"
                  width={graph.width}
                  height={graph.height}
                  aria-hidden="true"
                >
                  <defs>
                    <marker
                      id={markerId}
                      viewBox="0 0 8 8"
                      refX="7"
                      refY="4"
                      markerWidth="5"
                      markerHeight="5"
                      orient="auto-start-reverse"
                    >
                      <path d="M 0 0 L 8 4 L 0 8 z" fill="#9aa991" />
                    </marker>
                  </defs>
                  {graph.edges.map((edge) => (
                    <path
                      key={`${edge.from.commitment.id}:${edge.to?.commitment.id ?? 'goal'}`}
                      d={edgePath(edge, graph.goal)}
                      className={
                        edge.loop
                          ? 'roadmap-edge-loop'
                          : edge.from.commitment.status === 'done'
                            ? 'roadmap-edge-done'
                            : ''
                      }
                      markerEnd={`url(#${markerId})`}
                    />
                  ))}
                  {!graph.nodes.length && (
                    <path
                      d={`M ${LEFT + CARD_WIDTH} ${TOP + CARD_HEIGHT / 2} H ${graph.goal.x - 8}`}
                      className="roadmap-edge-empty"
                      markerEnd={`url(#${markerId})`}
                    />
                  )}
                </svg>
                {graph.columns.map((_, level) => (
                  <span
                    className="roadmap-column-label"
                    key={level}
                    style={{ left: LEFT + level * COLUMN_STEP }}
                  >
                    {level === 0 ? 'START HERE' : `NEXT · ${level + 1}`}
                  </span>
                ))}
                <span className="roadmap-column-label" style={{ left: graph.goal.x }}>
                  WORKING TOWARD
                </span>
                {graph.nodes.map((node) => milestoneCard(node.commitment, node))}
                {!graph.nodes.length && (
                  <button
                    className="roadmap-start roadmap-positioned"
                    style={{ left: LEFT, top: TOP, width: CARD_WIDTH, height: CARD_HEIGHT }}
                    onClick={onCreate}
                  >
                    <span className="roadmap-start-icon">
                      <Plus size={22} />
                    </span>
                    <strong>What comes first?</strong>
                    <span>
                      Add your first milestone.
                      <br />A small step toward the bigger picture.
                    </span>
                    <span className="roadmap-start-action">
                      Create a milestone <ArrowRight size={13} />
                    </span>
                  </button>
                )}
                {goalCard}
              </div>
            </div>
          </div>
        ) : (
          <div className="roadmap-list-view">
            <button className="roadmap-list-goal" onClick={onEditGoal}>
              <Target size={21} />
              <span>
                <small>THE GOAL</small>
                <strong>{state.goal}</strong>
              </span>
              <ArrowRight size={16} />
            </button>
            {state.commitments.length > 0 && (
              <div className="inline-search roadmap-search">
                <Search size={16} />
                <input
                  aria-label="Find a milestone or owner"
                  placeholder="Find a milestone or owner…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
            )}
            <div className="roadmap-list">{matching.map((commitment) => milestoneCard(commitment))}</div>
            {!matching.length && (
              <div className="roadmap-list-empty">
                <p>
                  {query ? `No milestones match “${query}”.` : 'Your goal is ready for its first milestone.'}
                </p>
                {!query && (
                  <button className="button secondary" onClick={onCreate}>
                    <Plus size={15} />
                    Add milestone
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        <div className="roadmap-footer">
          <span>
            <GitBranch size={14} />
            Arrows connect the steps that depend on each other.
          </span>
          <span>Select any milestone to guide the work.</span>
        </div>
      </div>
      {(graph.hasLoops || graph.hasMissing) && (
        <p className="roadmap-data-note">
          {graph.hasLoops && 'Some milestones depend on each other in a loop; those links are dashed. '}
          {graph.hasMissing &&
            'Some dependencies are no longer available. Open the affected milestones to review their links.'}
        </p>
      )}
    </section>
  );
}
