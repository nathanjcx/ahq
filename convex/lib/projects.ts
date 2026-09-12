import type { ModelId, Project, ProjectTask, RoadmapProposal } from '../../lib/contracts';
import type { Doc, Id } from '../_generated/dataModel';
import type { Ctx } from '../shared';
import { milestoneStatus } from './dependencies';
import { findChannel } from './posts';

/** Statuses that mean a task will not be worked on again. */
const FINISHED = ['completed', 'cancelled'];
/** Working hours and tokens assumed for a task when the workspace has no history for the version. */
const DEFAULT_ESTIMATES: Record<ModelId, { workingHours: number; tokens: number }> = {
  'gpt-5.6-luna': { workingHours: 2, tokens: 40_000 },
  'gpt-5.6-terra': { workingHours: 4, tokens: 90_000 },
  'gpt-5.6-sol': { workingHours: 6, tokens: 160_000 },
  'gpt-6-astra': { workingHours: 8, tokens: 260_000 },
};
/** Completed tasks read when estimating; recent work describes the current employee better than old work. */
const HISTORY_SAMPLE = 200;
/** A meeting the planner asks for lasts half an hour unless a person changes it. */
const MEETING_MINUTES = 30;
const WEEK_MS = 7 * 24 * 60 * 60 * 1_000;

export async function requireProject(
  ctx: Ctx,
  workspaceId: Id<'workspaces'>,
  projectId: Id<'projects'>,
): Promise<Doc<'projects'>> {
  const project = await ctx.db.get(projectId);
  if (!project || project.workspaceId !== workspaceId) throw new Error('Project not found');
  return project;
}

/** A milestone of this workspace, and of the named project when a task claims both. */
export async function requireProjectMilestone(
  ctx: Ctx,
  workspaceId: Id<'workspaces'>,
  milestoneId: Id<'milestones'>,
  projectId?: Id<'projects'>,
): Promise<Doc<'milestones'>> {
  const milestone = await ctx.db.get(milestoneId);
  if (!milestone || milestone.workspaceId !== workspaceId) throw new Error('Milestone not found');
  if (projectId && milestone.projectId !== projectId)
    throw new Error('That milestone belongs to another project');
  return milestone;
}

/**
 * The project as the interface renders it. Milestone status is derived from the tasks rather than
 * read from the row, so a milestone cannot claim to be planned while its work is running.
 */
export async function projectView(ctx: Ctx, project: Doc<'projects'>): Promise<Project> {
  const [milestones, tasks, channel] = await Promise.all([
    ctx.db
      .query('milestones')
      .withIndex('by_project', (q) => q.eq('projectId', project._id))
      .collect(),
    ctx.db
      .query('tasks')
      .withIndex('by_project', (q) => q.eq('projectId', project._id))
      .collect(),
    findChannel(ctx, project.workspaceId, 'project', project._id),
  ]);
  const statuses = tasks.map((task) => ({ id: String(task._id), status: task.status }));
  const now = Date.now();
  const views = milestones
    .sort((a, b) => a.order - b.order)
    .map((milestone) => {
      const taskIds = tasks
        .filter((task) => task.milestoneId === milestone._id)
        .map((task) => String(task._id));
      return {
        id: String(milestone._id),
        projectId: String(milestone.projectId),
        order: milestone.order,
        title: milestone.title,
        description: milestone.description,
        deadlineAt: milestone.deadlineAt,
        dependsOn: milestone.dependsOn.map(String),
        status: milestoneStatus({ taskIds }, statuses),
        taskIds,
      };
    });
  return {
    id: String(project._id),
    name: project.name,
    brief: project.brief,
    deadlineAt: project.deadlineAt,
    floorIds: project.floorIds.map(String),
    status: project.status,
    createdBy: project.createdBy,
    createdByName: project.createdByName,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    milestones: views,
    // Session tasks (planner, standing) carry the project id but are not work.
    openTasks: tasks.filter((task) => (task.kind ?? 'work') === 'work' && !FINISHED.includes(task.status))
      .length,
    behindMilestones: views.filter(
      (milestone) =>
        milestone.status !== 'done' && milestone.deadlineAt !== undefined && milestone.deadlineAt < now,
    ).length,
    channelId: channel ? String(channel._id) : undefined,
  };
}

/** One task of a project as the project page lists it: who holds it, when it is due, what it waits for. */
export function projectTaskView(task: Doc<'tasks'>): ProjectTask {
  return {
    id: String(task._id),
    title: task.title,
    status: task.status,
    employeeId: String(task.employeeId),
    employeeName: task.employeeName,
    floorId: task.floorId ? String(task.floorId) : undefined,
    milestoneId: task.milestoneId ? String(task.milestoneId) : undefined,
    cadence: task.cadence ?? 'once',
    deadlineAt: task.deadlineAt,
    dependsOn: (task.dependsOn ?? []).map(String),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    error: task.error,
  };
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * What one task by this employee version is likely to cost. Median tokens and working hours over the
 * workspace's completed tasks of the same cadence; without history, the per-model default at the
 * confidence the plan fixes for a guess.
 */
export async function estimateTask(
  ctx: Ctx,
  workspaceId: Id<'workspaces'>,
  versionId: Id<'employeeVersions'>,
  kind: 'once' | 'daily',
): Promise<{ workingHours: number; tokens: number; confidence: number; model: ModelId }> {
  const version = await ctx.db.get(versionId);
  if (!version) throw new Error('Employee version not found');
  const completed = await ctx.db
    .query('tasks')
    .withIndex('by_status', (q) => q.eq('status', 'completed'))
    .order('desc')
    .take(HISTORY_SAMPLE);
  const history = completed.filter(
    (task) =>
      task.workspaceId === workspaceId && task.versionId === versionId && (task.cadence ?? 'once') === kind,
  );
  if (!history.length) return { ...DEFAULT_ESTIMATES[version.model], confidence: 0.3, model: version.model };
  return {
    workingHours:
      Math.round(median(history.map((task) => (task.updatedAt - task.createdAt) / 3_600_000)) * 10) / 10,
    tokens: Math.round(
      median(history.map((task) => (task.usage ? task.usage.input + task.usage.output : 0))),
    ),
    // History is worth more the more of it there is, and never counts as certainty.
    confidence: Math.min(0.9, 0.3 + 0.1 * history.length),
    model: version.model,
  };
}

/** One floor's parallelism: the instances staffed on it can run one task each at a time. */
export interface FloorCapacity {
  floorId: string;
  name: string;
  instances: number;
}

function weekOf(at: number) {
  return new Date(Math.floor(at / WEEK_MS) * WEEK_MS).toISOString().slice(0, 10);
}

/**
 * The questions a person has to answer before the roadmap can be confirmed: floors with more work
 * due in one week than they have instances, deadlines that fall before the work they depend on, and
 * milestones planned past the project's own deadline, which is a field rather than a line in the brief.
 */
export function bottleneckPrompts(
  proposal: RoadmapProposal,
  capacity: readonly FloorCapacity[],
  projectDeadlineAt?: number,
): RoadmapProposal['prompts'] {
  const prompts: RoadmapProposal['prompts'] = [];
  if (projectDeadlineAt !== undefined)
    for (const milestone of proposal.milestones)
      if (milestone.deadlineAt !== undefined && milestone.deadlineAt > projectDeadlineAt)
        prompts.push({
          kind: 'deadline',
          text: `Milestone "${milestone.title}" is due after the project itself. Move it, or move the project deadline.`,
        });
  const tasks = proposal.milestones.flatMap((milestone) => milestone.tasks);
  const byFloorWeek = new Map<string, number>();
  for (const task of tasks) {
    if (task.deadlineAt === undefined) continue;
    const key = `${task.floorId}|${weekOf(task.deadlineAt)}`;
    byFloorWeek.set(key, (byFloorWeek.get(key) ?? 0) + 1);
  }
  for (const [key, count] of byFloorWeek) {
    const [floorId, week] = key.split('|');
    const floor = capacity.find((entry) => entry.floorId === floorId);
    const instances = floor?.instances ?? 0;
    if (count <= instances) continue;
    prompts.push({
      kind: 'capacity',
      text: `${floor?.name ?? 'A floor'} has ${count} tasks due in the week of ${week} and ${instances} instance(s). Hire more or move the deadline.`,
    });
  }
  const taskByKey = new Map(tasks.map((task) => [task.key, task]));
  for (const task of tasks) {
    if (task.deadlineAt === undefined) continue;
    for (const key of task.dependsOn) {
      const dependency = taskByKey.get(key);
      if (dependency?.deadlineAt === undefined || dependency.deadlineAt <= task.deadlineAt) continue;
      prompts.push({
        kind: 'deadline',
        text: `"${task.title}" is due before "${dependency.title}", which it depends on. Move one of the deadlines.`,
      });
    }
  }
  const milestoneByKey = new Map(proposal.milestones.map((milestone) => [milestone.key, milestone]));
  for (const milestone of proposal.milestones) {
    if (milestone.deadlineAt === undefined) continue;
    for (const key of milestone.dependsOn) {
      const dependency = milestoneByKey.get(key);
      if (dependency?.deadlineAt === undefined || dependency.deadlineAt <= milestone.deadlineAt) continue;
      prompts.push({
        kind: 'deadline',
        text: `Milestone "${milestone.title}" is due before "${dependency.title}", which it depends on. Move one of the deadlines.`,
      });
    }
  }
  return prompts;
}

/** A meeting the confirmed roadmap asks the calendar workstream to create. */
export interface MeetingRequest {
  title: string;
  startsAt: number;
  endsAt: number;
  purpose: string;
  milestoneKey?: string;
}

/** The meetings in a proposal, as calendar requests. Confirming a roadmap returns these; it inserts none. */
export function meetingRequests(proposal: RoadmapProposal): MeetingRequest[] {
  return proposal.meetings.map((meeting) => ({
    title: meeting.title,
    startsAt: meeting.startsAt,
    endsAt: meeting.startsAt + MEETING_MINUTES * 60_000,
    purpose: meeting.purpose,
    milestoneKey: meeting.milestoneKey,
  }));
}

/*
 * Proposal validation. The roadmap is a nested document with keyed cross-references, which a Convex
 * validator cannot express without restating it three times, so `saveProposal` and `recordProposal`
 * take it as `v.any()` under a size cap and this checker turns the unknown value into a
 * `RoadmapProposal` or throws. It is the one documented `any` in the projects workstream.
 */

/** Longest proposal accepted, serialized. A planner turn that needs more is proposing too much at once. */
export const PROPOSAL_LIMIT = 200_000;
const LIMITS = { staffing: 20, milestones: 50, tasks: 100, meetings: 50, prompts: 50, hires: 20 };
const MODELS: ModelId[] = ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-6-astra'];
const PROMPT_KINDS: RoadmapProposal['prompts'][number]['kind'][] = ['capacity', 'deadline', 'order', 'cost'];

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${field} must be an object`);
  return value as Record<string, unknown>;
}

function list(value: unknown, field: string, max: number): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  if (value.length > max) throw new Error(`${field} has more than ${max} entries`);
  return value;
}

function text(value: unknown, field: string, max = 5_000): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
  if (value.length > max) throw new Error(`${field} is too long`);
  return value;
}

function texts(value: unknown, field: string, max: number): string[] {
  return list(value, field, max).map((entry, index) => text(entry, `${field}[${index}]`, 200));
}

function count(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${field} must be a number`);
  return value;
}

function optionalCount(value: unknown, field: string): number | undefined {
  return value === undefined || value === null ? undefined : count(value, field);
}

function member<Value extends string>(value: unknown, field: string, allowed: Value[]): Value {
  if (typeof value !== 'string' || !allowed.includes(value as Value))
    throw new Error(`${field} must be one of ${allowed.join(', ')}`);
  return value as Value;
}

/** Turns an unchecked planner answer into a roadmap proposal, or explains what is wrong with it. */
export function parseProposal(value: unknown): RoadmapProposal {
  if (JSON.stringify(value ?? null).length > PROPOSAL_LIMIT) throw new Error('Proposal is too large');
  const source = record(value, 'Proposal');
  const staffing = list(source.staffing, 'staffing', LIMITS.staffing).map((entry, index) => {
    const staff = record(entry, `staffing[${index}]`);
    return {
      floorId: text(staff.floorId, `staffing[${index}].floorId`, 100),
      employeeIds: texts(staff.employeeIds, `staffing[${index}].employeeIds`, LIMITS.hires),
      suggestedHires: list(staff.suggestedHires, `staffing[${index}].suggestedHires`, LIMITS.hires).map(
        (hire, hireIndex) => {
          const field = `staffing[${index}].suggestedHires[${hireIndex}]`;
          const suggestion = record(hire, field);
          return {
            versionId: text(suggestion.versionId, `${field}.versionId`, 100),
            count: count(suggestion.count, `${field}.count`),
            reason: text(suggestion.reason, `${field}.reason`),
          };
        },
      ),
    };
  });
  const milestones = list(source.milestones, 'milestones', LIMITS.milestones).map((entry, index) => {
    const milestone = record(entry, `milestones[${index}]`);
    return {
      key: text(milestone.key, `milestones[${index}].key`, 100),
      title: text(milestone.title, `milestones[${index}].title`, 200),
      description: text(milestone.description, `milestones[${index}].description`),
      deadlineAt: optionalCount(milestone.deadlineAt, `milestones[${index}].deadlineAt`),
      dependsOn: texts(milestone.dependsOn, `milestones[${index}].dependsOn`, LIMITS.milestones),
      tasks: list(milestone.tasks, `milestones[${index}].tasks`, LIMITS.tasks).map((item, taskIndex) => {
        const field = `milestones[${index}].tasks[${taskIndex}]`;
        const task = record(item, field);
        const estimate = record(task.estimate, `${field}.estimate`);
        return {
          key: text(task.key, `${field}.key`, 100),
          title: text(task.title, `${field}.title`, 200),
          prompt: text(task.prompt, `${field}.prompt`, 50_000),
          employeeId:
            task.employeeId === undefined || task.employeeId === null
              ? undefined
              : text(task.employeeId, `${field}.employeeId`, 100),
          floorId: text(task.floorId, `${field}.floorId`, 100),
          dependsOn: texts(task.dependsOn, `${field}.dependsOn`, LIMITS.tasks),
          deadlineAt: optionalCount(task.deadlineAt, `${field}.deadlineAt`),
          estimate: {
            workingHours: count(estimate.workingHours, `${field}.estimate.workingHours`),
            tokens: count(estimate.tokens, `${field}.estimate.tokens`),
            confidence: count(estimate.confidence, `${field}.estimate.confidence`),
            model: member(estimate.model, `${field}.estimate.model`, MODELS),
          },
        };
      }),
    };
  });
  const meetings = list(source.meetings, 'meetings', LIMITS.meetings).map((entry, index) => {
    const meeting = record(entry, `meetings[${index}]`);
    return {
      title: text(meeting.title, `meetings[${index}].title`, 200),
      startsAt: count(meeting.startsAt, `meetings[${index}].startsAt`),
      purpose: text(meeting.purpose, `meetings[${index}].purpose`),
      milestoneKey:
        meeting.milestoneKey === undefined || meeting.milestoneKey === null
          ? undefined
          : text(meeting.milestoneKey, `meetings[${index}].milestoneKey`, 100),
    };
  });
  const prompts = list(source.prompts, 'prompts', LIMITS.prompts).map((entry, index) => {
    const prompt = record(entry, `prompts[${index}]`);
    return {
      kind: member(prompt.kind, `prompts[${index}].kind`, PROMPT_KINDS),
      text: text(prompt.text, `prompts[${index}].text`),
    };
  });
  return {
    staffing,
    milestones,
    meetings,
    prompts,
    projectedTokens: count(source.projectedTokens, 'projectedTokens'),
  };
}

/** The stored proposal of a project, or undefined when there is none to show. */
export function storedProposal(project: Doc<'projects'>): RoadmapProposal | undefined {
  if (!project.proposal) return undefined;
  return parseProposal(JSON.parse(project.proposal));
}
