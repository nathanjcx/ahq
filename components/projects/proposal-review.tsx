'use client';

import { CalendarClock, Check, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { shortDate, shortTime } from '../shared/time';
import { ProjectionNote, tokenCount } from './projection-note';
import {
  answerPrompt,
  dateTime,
  dateValue,
  editMilestone,
  editTask,
  proposalTotals,
  removeMilestone,
  removeTask,
  shiftDeadlines,
} from './proposal';
import { ProposalQuestions, type HireSuggestion } from './proposal-questions';
import { proposalTimeline } from './roadmap';
import { RoadmapTimeline } from './roadmap-timeline';
import type { Employee, Floor, PlanProjection, Project, RoadmapProposal } from '@/lib/contracts';
import { pluralize } from '@/lib/text';

/**
 * The planner's roadmap before anything exists: the timeline, the bottleneck questions with the
 * controls that answer them, and every milestone and task open to editing. Nothing is created until
 * Confirm; Save keeps the edits for later.
 */
export function ProposalReview({
  project,
  proposal,
  floors,
  employees,
  projection,
  busy,
  onSave,
  onConfirm,
  onHire,
}: {
  project: Project;
  proposal: RoadmapProposal;
  /** Every floor of the workspace; the project's own are picked out of it. */
  floors: Floor[];
  employees: Employee[];
  projection?: PlanProjection;
  busy: boolean;
  onSave: (proposal: RoadmapProposal) => void;
  onConfirm: (proposal: RoadmapProposal) => void;
  onHire: (listingId: string, floorId: string, count: number) => void;
}) {
  const [draft, setDraft] = useState(proposal);
  const [edited, setEdited] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const change = (next: RoadmapProposal) => {
    setDraft(next);
    setEdited(true);
  };

  const projectFloors = floors.filter((floor) => project.floorIds.includes(floor.id));
  const floorName = (id: string) => floors.find((floor) => floor.id === id)?.name ?? 'Floor';
  const employeeName = (id?: string) => employees.find((employee) => employee.id === id)?.name ?? 'Unstaffed';
  /** The instances a floor holds, which are the people a task on that floor can go to. */
  const floorStaff = (floorId: string) => {
    const staff = floors.find((floor) => floor.id === floorId)?.employeeIds ?? [];
    return employees.filter((employee) => staff.includes(employee.id));
  };
  const totals = proposalTotals(draft);
  const timeline = proposalTimeline(draft, { floor: floorName, employee: employeeName });
  const unstaffed = draft.milestones
    .flatMap((milestone) => milestone.tasks)
    .filter((task) => !task.employeeId).length;

  // The planner names a version it wants more of; hiring needs the listing that version came from.
  const suggestions: HireSuggestion[] = draft.staffing.flatMap((entry) =>
    entry.suggestedHires.flatMap((hire) => {
      const employee = employees.find((candidate) => candidate.versionId === hire.versionId);
      if (!employee?.listingId) return [];
      return [
        {
          listingId: employee.listingId,
          name: employee.instanceOf,
          floorId: entry.floorId,
          count: hire.count,
          reason: hire.reason,
        },
      ];
    }),
  );

  return (
    <section className="proposal">
      <header className="proposal-head">
        <div>
          <span className="eyebrow">PROPOSED ROADMAP</span>
          <h2>{project.name}</h2>
          <p>
            {pluralize(totals.milestones, 'milestone')} · {pluralize(totals.tasks, 'task')} ·{' '}
            {totals.workingHours} working hours · estimates {Math.round(totals.confidence * 100)}% confident
          </p>
        </div>
        <div className="proposal-actions">
          <button className="secondary-button" disabled={busy || !edited} onClick={() => onSave(draft)}>
            <Save size={16} />
            Save edits
          </button>
          <button
            className="primary-button"
            disabled={busy || unstaffed > 0}
            onClick={() => onConfirm(draft)}
          >
            <Check size={16} />
            Confirm roadmap
          </button>
        </div>
      </header>
      <ProjectionNote projection={projection} projectedTokens={draft.projectedTokens} />
      {unstaffed > 0 && (
        <p className="proposal-blocker">
          {pluralize(unstaffed, 'task')} still need someone to do them before this can be confirmed.
        </p>
      )}
      <ProposalQuestions
        prompts={draft.prompts}
        floors={projectFloors}
        suggestions={suggestions}
        busy={busy}
        onHire={onHire}
        onShift={(days) => change(shiftDeadlines(draft, days))}
        onAccept={(index) => change(answerPrompt(draft, index))}
      />
      <RoadmapTimeline timeline={timeline} onSelectBar={setHighlight} />
      <ol className="milestone-editors">
        {draft.milestones.map((milestone, index) => (
          <li key={milestone.key}>
            <header>
              <span className="milestone-index">{index + 1}</span>
              <input
                aria-label={`Milestone ${index + 1} title`}
                value={milestone.title}
                onChange={(event) =>
                  change(editMilestone(draft, milestone.key, { title: event.target.value }))
                }
              />
              <input
                type="date"
                aria-label={`Milestone ${index + 1} deadline`}
                value={dateValue(milestone.deadlineAt)}
                onChange={(event) =>
                  change(editMilestone(draft, milestone.key, { deadlineAt: dateTime(event.target.value) }))
                }
              />
              <button
                className="icon-button"
                aria-label={`Remove ${milestone.title}`}
                disabled={busy}
                onClick={() => change(removeMilestone(draft, milestone.key))}
              >
                <Trash2 size={15} />
              </button>
            </header>
            <p>{milestone.description}</p>
            <ul className="task-editors">
              {milestone.tasks.map((task) => (
                <li key={task.key} data-active={highlight === task.key}>
                  <input
                    aria-label={`Task title: ${task.title}`}
                    value={task.title}
                    onChange={(event) => change(editTask(draft, task.key, { title: event.target.value }))}
                  />
                  <select
                    aria-label={`Who does ${task.title}`}
                    value={task.employeeId ?? ''}
                    onChange={(event) =>
                      change(editTask(draft, task.key, { employeeId: event.target.value || undefined }))
                    }
                  >
                    <option value="">Unstaffed</option>
                    {floorStaff(task.floorId).map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="date"
                    aria-label={`Deadline for ${task.title}`}
                    value={dateValue(task.deadlineAt)}
                    onChange={(event) =>
                      change(editTask(draft, task.key, { deadlineAt: dateTime(event.target.value) }))
                    }
                  />
                  <button
                    className="icon-button"
                    aria-label={`Remove ${task.title}`}
                    disabled={busy}
                    onClick={() => change(removeTask(draft, task.key))}
                  >
                    <Trash2 size={15} />
                  </button>
                  <small>
                    {floorName(task.floorId)} · {task.estimate.workingHours}h ·{' '}
                    {tokenCount(task.estimate.tokens)}
                    {task.dependsOn.length ? ` · waits for ${task.dependsOn.length}` : ''}
                  </small>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      {draft.meetings.length > 0 && (
        <div className="proposal-meetings">
          <div className="section-title">
            <CalendarClock size={16} />
            <h2>Meeting points</h2>
          </div>
          <ul>
            {draft.meetings.map((meeting) => (
              <li key={`${meeting.title}-${meeting.startsAt}`}>
                <strong>{meeting.title}</strong>
                <span>
                  {shortDate(meeting.startsAt)} · {shortTime(meeting.startsAt)}
                </span>
                <small>{meeting.purpose}</small>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
