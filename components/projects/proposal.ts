/**
 * Editing a roadmap proposal. Every function returns a new proposal, so the review panel holds one
 * draft in state and the arithmetic — moving deadlines, dropping work, answering a question — is
 * pure and testable.
 */
import type { RoadmapProposal } from '@/lib/contracts';

const DAY = 86_400_000;

type Milestone = RoadmapProposal['milestones'][number];
type Task = Milestone['tasks'][number];

export function editMilestone(
  proposal: RoadmapProposal,
  key: string,
  patch: Partial<Milestone>,
): RoadmapProposal {
  return {
    ...proposal,
    milestones: proposal.milestones.map((milestone) =>
      milestone.key === key ? { ...milestone, ...patch } : milestone,
    ),
  };
}

export function editTask(proposal: RoadmapProposal, key: string, patch: Partial<Task>): RoadmapProposal {
  return {
    ...proposal,
    milestones: proposal.milestones.map((milestone) => ({
      ...milestone,
      tasks: milestone.tasks.map((task) => (task.key === key ? { ...task, ...patch } : task)),
    })),
  };
}

/** Drops a task and every dependency on it, so nothing waits for work that is no longer planned. */
export function removeTask(proposal: RoadmapProposal, key: string): RoadmapProposal {
  return {
    ...proposal,
    milestones: proposal.milestones.map((milestone) => ({
      ...milestone,
      tasks: milestone.tasks
        .filter((task) => task.key !== key)
        .map((task) => ({ ...task, dependsOn: task.dependsOn.filter((id) => id !== key) })),
    })),
  };
}

/** Drops a milestone with its tasks, and the dependencies on both. */
export function removeMilestone(proposal: RoadmapProposal, key: string): RoadmapProposal {
  const milestone = proposal.milestones.find((entry) => entry.key === key);
  const taskKeys = new Set(milestone?.tasks.map((task) => task.key));
  return {
    ...proposal,
    milestones: proposal.milestones
      .filter((entry) => entry.key !== key)
      .map((entry) => ({
        ...entry,
        dependsOn: entry.dependsOn.filter((id) => id !== key),
        tasks: entry.tasks.map((task) => ({
          ...task,
          dependsOn: task.dependsOn.filter((id) => !taskKeys.has(id)),
        })),
      })),
  };
}

/** Moves every deadline in the roadmap, milestones and tasks alike, by whole days. */
export function shiftDeadlines(proposal: RoadmapProposal, days: number): RoadmapProposal {
  const move = (at?: number) => (at === undefined ? undefined : at + days * DAY);
  return {
    ...proposal,
    milestones: proposal.milestones.map((milestone) => ({
      ...milestone,
      deadlineAt: move(milestone.deadlineAt),
      tasks: milestone.tasks.map((task) => ({ ...task, deadlineAt: move(task.deadlineAt) })),
    })),
    meetings: proposal.meetings.map((meeting) => ({
      ...meeting,
      startsAt: meeting.startsAt + days * DAY,
    })),
  };
}

/** Takes a question off the roadmap once it has been answered. */
export function answerPrompt(proposal: RoadmapProposal, index: number): RoadmapProposal {
  return { ...proposal, prompts: proposal.prompts.filter((_prompt, at) => at !== index) };
}

/** What the roadmap adds up to: work, effort, and the floors it runs on. */
export function proposalTotals(proposal: RoadmapProposal) {
  const tasks = proposal.milestones.flatMap((milestone) => milestone.tasks);
  return {
    milestones: proposal.milestones.length,
    tasks: tasks.length,
    workingHours: tasks.reduce((total, task) => total + task.estimate.workingHours, 0),
    floorIds: [...new Set(tasks.map((task) => task.floorId))],
    /** The lowest confidence any estimate carries, which is the confidence of the total. */
    confidence: tasks.length ? Math.min(...tasks.map((task) => task.estimate.confidence)) : 0,
  };
}
