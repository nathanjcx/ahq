'use client';

import { AlertTriangle, MessagesSquare, RefreshCw } from 'lucide-react';
import type { ChannelFeedActions } from '../shared/channel-feed';
import { ChannelFeed } from '../shared/channel-feed';
import { EmptyMini } from '../shared/empty';
import { OverflowMenu } from '../shared/overflow-menu';
import { dateInputTime, dateInputValue, shortDate } from '../shared/time';
import { ProjectStatusPill } from './project-card';
import { ProjectTaskRow } from './project-task-row';
import { projectTimeline } from './roadmap';
import { RoadmapTimeline } from './roadmap-timeline';
import type { Floor, Project, ProjectTask } from '@/lib/contracts';
import { pluralize } from '@/lib/text';

/** Statuses that mean the task is not being worked on and says why. */
const HELD = ['waiting', 'blocked'];

/**
 * A project as it runs: where it stands, the roadmap on its axis, every milestone with its work, the
 * tasks that are held up and what releases them, and the project's own channel.
 */
export function ProjectDetail({
  project,
  tasks,
  floors,
  actions,
  busy,
  onOpenTask,
  onReplan,
  onArchive,
  onFinish,
  onProjectDeadline,
  onDeadline,
  onCadence,
  onUnblock,
}: {
  project: Project;
  tasks: ProjectTask[];
  floors: Floor[];
  /** Passed through to the project's channel. */
  actions: ChannelFeedActions;
  busy: boolean;
  onOpenTask: (taskId: string) => void;
  onReplan: () => void;
  onArchive: () => void;
  onFinish: () => void;
  /** The project's own due date, which the planner works back from. */
  onProjectDeadline: (deadlineAt?: number) => void;
  onDeadline: (taskId: string, deadlineAt?: number) => void;
  onCadence: (taskId: string, cadence: 'once' | 'daily') => void;
  onUnblock: (taskId: string) => void;
}) {
  const floorName = (id?: string) => floors.find((floor) => floor.id === id)?.name ?? 'Lobby';
  const timeline = projectTimeline(project, tasks, { floor: floorName });
  const done = project.milestones.filter((milestone) => milestone.status === 'done').length;
  const titles = new Map(tasks.map((task) => [task.id, task.title]));
  const held = tasks.filter((task) => HELD.includes(task.status));
  const unplanned = tasks.filter((task) => !task.milestoneId);

  const taskRow = (task: ProjectTask) => (
    <ProjectTaskRow
      key={task.id}
      task={task}
      waitingFor={task.dependsOn.map((id) => titles.get(id) ?? 'another task')}
      busy={busy}
      onOpen={onOpenTask}
      onDeadline={onDeadline}
      onCadence={onCadence}
      onUnblock={onUnblock}
    />
  );

  return (
    <article className="project-detail">
      <header className="project-head">
        <div>
          <ProjectStatusPill status={project.status} />
          <h2>{project.name}</h2>
          <p>{project.brief}</p>
          <ul className="project-facts">
            <li>
              <small>Milestones</small>
              <strong>
                {done} of {project.milestones.length}
              </strong>
            </li>
            <li>
              <small>Open tasks</small>
              <strong>{project.openTasks}</strong>
            </li>
            <li>
              <label>
                <small>Deadline</small>
                <input
                  type="date"
                  className="project-deadline"
                  value={dateInputValue(project.deadlineAt)}
                  disabled={busy}
                  onChange={(event) => onProjectDeadline(dateInputTime(event.target.value))}
                />
              </label>
            </li>
            <li>
              <small>Floors</small>
              <strong>{project.floorIds.map((id) => floorName(id)).join(', ') || 'None'}</strong>
            </li>
          </ul>
          {project.behindMilestones > 0 && (
            <p className="project-behind">
              <AlertTriangle size={15} />
              {pluralize(project.behindMilestones, 'milestone')} past deadline. Replan, or move the work that
              is late.
            </p>
          )}
        </div>
        <div className="project-head-actions">
          <button className="secondary-button" disabled={busy} onClick={onReplan}>
            <RefreshCw size={16} />
            Replan
          </button>
          <OverflowMenu
            label={`Actions for ${project.name}`}
            actions={[
              { label: 'Mark finished', onSelect: onFinish, disabled: busy || project.status === 'done' },
              {
                label: 'Archive project',
                onSelect: onArchive,
                danger: true,
                disabled: busy || project.status === 'archived',
              },
            ]}
          />
        </div>
      </header>
      {timeline.rows.length > 0 && <RoadmapTimeline timeline={timeline} onSelectBar={onOpenTask} />}
      {held.length > 0 && (
        <section>
          <div className="section-title">
            <AlertTriangle size={16} />
            <h2>Held up</h2>
          </div>
          <ul className="project-tasks">{held.map(taskRow)}</ul>
        </section>
      )}
      <section className="project-milestones">
        <div className="section-title">
          <h2>Milestones</h2>
        </div>
        {project.milestones.length ? (
          <ol>
            {project.milestones.map((milestone, index) => (
              <li key={milestone.id} data-status={milestone.status}>
                <header>
                  <span className="milestone-index">{index + 1}</span>
                  <strong>{milestone.title}</strong>
                  <span className="milestone-status">{milestone.status}</span>
                  <span className="milestone-deadline">
                    {milestone.deadlineAt ? shortDate(milestone.deadlineAt) : 'No deadline'}
                  </span>
                </header>
                <p>{milestone.description}</p>
                <ul className="project-tasks">
                  {tasks.filter((task) => task.milestoneId === milestone.id).map(taskRow)}
                </ul>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyMini
            icon={<RefreshCw size={18} />}
            title="No milestones yet"
            text="Replan to have the planner propose a roadmap for this project."
          />
        )}
        {unplanned.length > 0 && (
          <>
            <div className="section-title">
              <h2>Outside the roadmap</h2>
            </div>
            <ul className="project-tasks">{unplanned.map(taskRow)}</ul>
          </>
        )}
      </section>
      <section>
        <div className="section-title">
          <MessagesSquare size={16} />
          <h2>Project channel</h2>
        </div>
        {project.channelId ? (
          <ChannelFeed channelId={project.channelId} actions={actions} onTask={onOpenTask} />
        ) : (
          <EmptyMini
            icon={<MessagesSquare size={18} />}
            title="Nothing posted yet"
            text="Reports, decisions, and questions about this project will appear here."
          />
        )}
      </section>
    </article>
  );
}
