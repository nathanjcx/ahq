import type { TaskKind } from '../../lib/contracts/core';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import {
  canSeeConnection,
  cleanText,
  randomToken,
  usagePeriod,
  type Ctx,
  type WorkspaceRole,
} from '../shared';
import { assertAcyclic, dependentsOf, readyToStart } from './dependencies';
import { systemPost } from './posts';
import { settingsFor } from './schedule';

/** Task fields the roadmap and the dependency graph add to plain task creation. */
export type TaskPlan = {
  projectId?: Id<'projects'>;
  milestoneId?: Id<'milestones'>;
  cadence?: 'once' | 'daily';
  deadlineAt?: number;
  dependsOn?: Id<'tasks'>[];
};

export async function requireFloor(
  ctx: Ctx,
  workspaceId: Id<'workspaces'>,
  floorId: Id<'floors'>,
): Promise<Doc<'floors'>> {
  const floor = await ctx.db.get(floorId);
  if (!floor || floor.workspaceId !== workspaceId) throw new Error('Floor not found');
  return floor;
}

export async function assignmentForFloor(
  ctx: Ctx,
  workspaceId: Id<'workspaces'>,
  floorId: Id<'floors'>,
  employeeId: Id<'installations'>,
) {
  const floor = await requireFloor(ctx, workspaceId, floorId);
  if (floor.archivedAt !== undefined) throw new Error('Floor is archived');
  if (!floor.employeeIds.includes(employeeId)) throw new Error('Employee is not assigned to this floor');
  return { floorId: floor._id, floorContext: { name: floor.name, brief: floor.brief } };
}

/** An employee is ready when its version is live and the viewer can reach every required capability. */
export async function assertEmployeeReady(
  ctx: Ctx,
  workspace: Doc<'workspaces'>,
  subject: string,
  employeeId: Id<'installations'>,
) {
  const installation = await ctx.db.get(employeeId);
  if (!installation || installation.workspaceId !== workspace._id) throw new Error('Employee not found');
  const version = await ctx.db.get(installation.versionId);
  if (!version || version.retiredAt) throw new Error('Employee version is retired');
  const connections = await ctx.db
    .query('connections')
    .withIndex('by_workspace', (q) => q.eq('workspaceId', workspace._id))
    .collect();
  const visible = connections.filter(
    (connection) => connection.status === 'connected' && canSeeConnection(connection, subject),
  );
  for (const capability of version.capabilities) {
    if (capability.optional) continue;
    if (
      !visible.some(
        (connection) =>
          connection.provider === capability.provider &&
          capability.tools.every((tool: string) => connection.allowedTools.includes(tool)),
      )
    )
      throw new Error(`Connect ${capability.provider} with the required permissions first`);
  }
  return { installation, version };
}

export async function periodUsage(ctx: Ctx, workspaceId: Id<'workspaces'>, period = usagePeriod()) {
  return ctx.db
    .query('usage')
    .withIndex('by_workspace_period_model', (q) => q.eq('workspaceId', workspaceId).eq('period', period))
    .collect();
}

/** Usage is recorded, never reserved, so the cap is checked only when new work is accepted. */
export async function assertTokenCap(ctx: Ctx, workspace: Doc<'workspaces'>) {
  if (workspace.monthlyTokenCap <= 0) return;
  const rows = await periodUsage(ctx, workspace._id);
  const used = rows.reduce((total, row) => total + row.input + row.output, 0);
  if (used >= workspace.monthlyTokenCap) throw new Error('Monthly token cap reached');
}

/**
 * Under a `hard` audit policy an instance with open findings runs nothing else until they are
 * addressed, so it takes no new work either: the planner holds its day and this holds its queue.
 * Reserved staff are exempt, because the audit, curation, and triage runs are how a finding is
 * addressed at all, and a workspace that blocked those could never clear one.
 */
export async function assertFindingsCleared(
  ctx: Ctx,
  workspace: Doc<'workspaces'>,
  employeeId: Id<'installations'>,
) {
  const settings = await settingsFor(ctx, workspace._id);
  if (settings.auditPolicy !== 'hard') return;
  const installation = await ctx.db.get(employeeId);
  if (!installation || (installation.kind ?? 'worker') !== 'worker') return;
  for (const status of ['open', 'escalated'] as const) {
    const finding = await ctx.db
      .query('auditFindings')
      .withIndex('by_employee_status', (q) => q.eq('employeeId', employeeId).eq('status', status))
      .first();
    if (finding)
      throw new Error(
        'This instance has audit findings to address, and this workspace’s audit policy holds its other work until they are',
      );
  }
}

export async function insertJob(
  ctx: MutationCtx,
  values: {
    workspaceId: Id<'workspaces'>;
    taskId: Id<'tasks'>;
    uniqueKey: string;
    kind: string;
    payload: string;
    proposalId?: Id<'proposals'>;
  },
) {
  const existing = await ctx.db
    .query('jobs')
    .withIndex('by_unique_key', (q) => q.eq('uniqueKey', values.uniqueKey))
    .unique();
  if (existing) return existing._id;
  const now = Date.now();
  return ctx.db.insert('jobs', {
    ...values,
    state: 'queued',
    attempts: 0,
    availableAt: now,
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * The queue command that hands a task to the worker. Tasks that wait on a dependency get theirs only
 * when the dependency completes, and the unique key makes a double release a no-op.
 */
export async function queueStartTask(
  ctx: MutationCtx,
  task: Pick<Doc<'tasks'>, '_id' | 'workspaceId' | 'cadence'>,
  payload: Record<string, unknown> = {},
) {
  // A daily task's work arrives as a shift the planner schedules: inside working hours, against the
  // day's caps and free slots, with a shift row and a report. Starting it as an ordinary session
  // would run it at once outside all of that, and the shift brief already carries the prompt.
  if (task.cadence === 'daily') return;
  await insertJob(ctx, {
    workspaceId: task.workspaceId,
    taskId: task._id,
    uniqueKey: `start:${task._id}`,
    kind: 'start_task',
    payload: JSON.stringify({ taskId: task._id, ...payload }),
  });
}

/** Whether every dependency a task names has completed. */
export async function dependenciesReady(ctx: Ctx, dependsOn: readonly Id<'tasks'>[]) {
  if (!dependsOn.length) return true;
  const docs = await Promise.all(dependsOn.map((id) => ctx.db.get(id)));
  const statuses = new Map(
    docs.filter((doc) => doc !== null).map((doc) => [String(doc._id), { status: doc.status }]),
  );
  return readyToStart({ id: 'task', dependsOn: dependsOn.map(String) }, statuses);
}

/**
 * Checks proposed dependencies before they are stored: every one is a task of this workspace, and
 * following them upwards never arrives back at the task itself. Only the ancestors are read, so the
 * check costs the depth of the graph rather than the size of the workspace.
 */
export async function assertDependencies(
  ctx: Ctx,
  workspaceId: Id<'workspaces'>,
  taskId: Id<'tasks'> | null,
  dependsOn: readonly Id<'tasks'>[],
) {
  if (new Set(dependsOn).size !== dependsOn.length)
    throw new Error('A task cannot depend on the same task twice');
  const self = taskId ? String(taskId) : 'new task';
  const nodes = [{ id: self, dependsOn: dependsOn.map(String) }];
  const seen = new Set<string>();
  const queue = [...dependsOn];
  while (queue.length) {
    const id = queue.shift();
    if (!id || seen.has(String(id))) continue;
    seen.add(String(id));
    const dependency = await ctx.db.get(id);
    if (!dependency || dependency.workspaceId !== workspaceId)
      throw new Error('A dependency must be a task in this workspace');
    // The proposed edges replace whatever the task itself stores, so its stored node is left out.
    if (String(dependency._id) === self) continue;
    const next = dependency.dependsOn ?? [];
    nodes.push({ id: String(dependency._id), dependsOn: next.map(String) });
    queue.push(...next);
  }
  assertAcyclic(nodes);
}

/**
 * A finished task settles the tasks waiting on it: dependents whose dependencies have all completed
 * are queued, and a dependency that failed or was cancelled blocks them with the reason.
 */
export async function releaseDependents(ctx: MutationCtx, task: Doc<'tasks'>, status: string) {
  if (!['completed', 'failed', 'cancelled'].includes(status)) return;
  // Nothing indexes `dependsOn`, so the workspace's waiting set is scanned; those tasks are few.
  const waiting = await ctx.db
    .query('tasks')
    .withIndex('by_workspace_status', (q) => q.eq('workspaceId', task.workspaceId).eq('status', 'waiting'))
    .collect();
  const candidates = waiting.map((doc) => ({
    id: String(doc._id),
    dependsOn: (doc.dependsOn ?? []).map(String),
    doc,
  }));
  const now = Date.now();
  for (const { doc } of dependentsOf(String(task._id), candidates)) {
    if (status !== 'completed') {
      await ctx.db.patch(doc._id, {
        status: 'blocked',
        error: `Blocked: ${task.title} ${status}`,
        updatedAt: now,
      });
      continue;
    }
    if (!(await dependenciesReady(ctx, doc.dependsOn ?? []))) continue;
    await ctx.db.patch(doc._id, { status: 'queued', error: undefined, updatedAt: now });
    await queueStartTask(ctx, doc);
  }
}

/** A task is edited by the person who created it or by a workspace owner or administrator. */
export async function requireEditableTask(
  ctx: Ctx,
  workspace: Doc<'workspaces'>,
  actor: { subject: string },
  role: WorkspaceRole,
  taskId: Id<'tasks'>,
) {
  const task = await ctx.db.get(taskId);
  if (!task || task.workspaceId !== workspace._id) throw new Error('Task not found');
  if (task.createdBy !== actor.subject && role !== 'owner' && role !== 'admin')
    throw new Error('Only the person who created this task or an administrator can change it');
  return task;
}

/** The single path that puts a task and its first queue command into the database. */
export async function startTask(
  ctx: MutationCtx,
  input: {
    workspace: Doc<'workspaces'>;
    createdBy: string;
    createdByName: string;
    employeeId: Id<'installations'>;
    version: Doc<'employeeVersions'>;
    title: string;
    prompt: string;
    floor?: { floorId: Id<'floors'>; floorContext: { name: string; brief: string } };
    sourceTaskId?: Id<'tasks'>;
    sourceProposalId?: Id<'proposals'>;
    messageExternalId?: string;
    jobPayload?: Record<string, unknown>;
  } & TaskPlan,
) {
  await assertFindingsCleared(ctx, input.workspace, input.employeeId);
  const now = Date.now();
  const title = cleanText(input.title, 'Title', 200);
  const prompt = cleanText(input.prompt, 'Prompt', 50_000);
  const dependsOn = input.dependsOn ?? [];
  // A task that still waits on a dependency is stored, shown, and left alone until it is released.
  const ready = await dependenciesReady(ctx, dependsOn);
  const taskId = await ctx.db.insert('tasks', {
    workspaceId: input.workspace._id,
    ...(input.floor ?? {}),
    ...(input.sourceTaskId ? { sourceTaskId: input.sourceTaskId } : {}),
    ...(input.sourceProposalId ? { sourceProposalId: input.sourceProposalId } : {}),
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.milestoneId ? { milestoneId: input.milestoneId } : {}),
    ...(input.cadence ? { cadence: input.cadence } : {}),
    ...(input.deadlineAt !== undefined ? { deadlineAt: input.deadlineAt } : {}),
    ...(dependsOn.length ? { dependsOn } : {}),
    createdBy: input.createdBy,
    createdByName: input.createdByName,
    visibility: input.floor ? 'workspace' : 'private',
    employeeId: input.employeeId,
    versionId: input.version._id,
    employeeName: input.version.name,
    title,
    prompt,
    status: ready ? 'queued' : 'waiting',
    model: input.version.model,
    createdAt: now,
    updatedAt: now,
    runToken: randomToken(),
  });
  await ctx.db.insert('messages', {
    workspaceId: input.workspace._id,
    taskId,
    externalId: input.messageExternalId || `initial:${taskId}`,
    role: 'user',
    text: prompt,
    createdAt: now,
  });
  const task = await ctx.db.get(taskId);
  if (task) {
    if (ready) await queueStartTask(ctx, task, input.jobPayload ?? {});
    await systemPost(
      ctx,
      task,
      ready
        ? `${input.version.name} started: ${title}`
        : `${input.version.name} is waiting on ${dependsOn.length} task(s): ${title}`,
    );
  }
  return taskId;
}

/** Who a session task is filed under, so the records still say what opened it. */
const SESSION_AUTHORS: Record<SessionKind, string> = {
  meeting: 'Meeting',
  audit: 'Audit',
  curation: 'Curation',
  triage: 'Triage',
  standing: 'Schedule',
};
/** The kinds of task that exist only to hold a session; `work` is what a person asked for. */
type SessionKind = Exclude<TaskKind, 'work'>;

/**
 * A task that exists only to hold a session: meetings, audits, curation, triage, and the standing
 * sessions reserved employees live in. It carries no `start_task` job, because the run arrives as its
 * own job kind, and it is keyed so calling this again returns the session already open.
 */
export async function openSessionTask(
  ctx: MutationCtx,
  input: {
    workspace: Doc<'workspaces'>;
    employeeId: Id<'installations'>;
    version: Doc<'employeeVersions'>;
    kind: SessionKind;
    /** Caller key that identifies this session, such as a date or a meeting id. */
    key: string;
    title: string;
    prompt: string;
    floor?: { floorId: Id<'floors'>; floorContext: { name: string; brief: string } };
    project?: Id<'projects'>;
  },
) {
  const existing = await ctx.db
    .query('tasks')
    .withIndex('by_session', (q) =>
      q.eq('employeeId', input.employeeId).eq('kind', input.kind).eq('sessionKey', input.key),
    )
    .first();
  if (existing) return existing._id;
  const installation = await ctx.db.get(input.employeeId);
  const now = Date.now();
  return ctx.db.insert('tasks', {
    workspaceId: input.workspace._id,
    ...(input.floor ?? {}),
    ...(input.project ? { projectId: input.project } : {}),
    kind: input.kind,
    sessionKey: input.key,
    cadence: 'once',
    createdBy: 'system',
    createdByName: SESSION_AUTHORS[input.kind],
    visibility: 'workspace',
    employeeId: input.employeeId,
    versionId: input.version._id,
    employeeName: installation?.name ?? input.version.name,
    title: cleanText(input.title, 'Title', 200),
    prompt: cleanText(input.prompt, 'Prompt', 50_000),
    status: 'queued',
    model: input.version.model,
    createdAt: now,
    updatedAt: now,
    runToken: randomToken(),
  });
}

/** The sealed audit timeline for one task. Only the web service can unseal tool-call evidence. */
export async function taskTimeline(ctx: Ctx, task: Doc<'tasks'>) {
  const [events, messages, toolCalls, proposals] = await Promise.all([
    ctx.db
      .query('events')
      .withIndex('by_task', (q) => q.eq('taskId', task._id))
      .collect(),
    ctx.db
      .query('messages')
      .withIndex('by_task', (q) => q.eq('taskId', task._id))
      .collect(),
    ctx.db
      .query('toolCalls')
      .withIndex('by_task', (q) => q.eq('taskId', task._id))
      .collect(),
    ctx.db
      .query('proposals')
      .withIndex('by_task_status', (q) => q.eq('taskId', task._id))
      .collect(),
  ]);
  const providers = new Map<string, string>();
  for (const call of toolCalls) {
    if (providers.has(call.connectionId)) continue;
    const connection = await ctx.db.get(call.connectionId);
    if (connection) providers.set(call.connectionId, connection.provider);
  }
  return {
    task: {
      id: task._id,
      title: task.title,
      employeeName: task.employeeName,
      status: task.status,
      createdAt: task.createdAt,
      createdByName: task.createdByName,
    },
    events: events.map((event) => ({
      id: event._id,
      at: event.createdAt,
      type: event.type,
      text: event.text,
      gap: event.gap,
    })),
    messages: messages.map((message) => ({
      id: message._id,
      at: message.createdAt,
      role: message.role,
      text: message.text,
      phase: message.phase,
    })),
    toolCalls: toolCalls.map((call) => ({
      id: call._id,
      at: call.createdAt,
      operationId: call.operationId,
      connectionId: call.connectionId,
      provider: providers.get(call.connectionId),
      tool: call.tool,
      outcome: call.outcome,
      reason: call.reason,
      durationMs: call.durationMs,
      argumentsCiphertext: call.argumentsCiphertext,
      resultCiphertext: call.resultCiphertext,
      sha256: call.sha256,
      proposalId: call.proposalId,
    })),
    proposals: await Promise.all(
      proposals.map(async (proposal) => ({
        id: proposal._id,
        at: proposal.createdAt,
        tool: proposal.tool,
        provider: proposal.provider,
        summary: proposal.summary,
        status: proposal.status,
        correction: proposal.correction,
        arguments: proposal.arguments,
        beforeState: proposal.beforeState,
        afterState: proposal.afterState,
        transitions: (
          await ctx.db
            .query('actionTransitions')
            .withIndex('by_proposal', (q) => q.eq('proposalId', proposal._id))
            .collect()
        ).map((transition) => ({
          from: transition.from,
          to: transition.to,
          actor: transition.actor,
          at: transition.at,
          detail: transition.detail,
        })),
      })),
    ),
  };
}

export async function finalAssistantMessage(ctx: Ctx, taskId: Id<'tasks'>) {
  const messages = await ctx.db
    .query('messages')
    .withIndex('by_task', (q) => q.eq('taskId', taskId))
    .collect();
  return messages
    .filter((message) => message.role === 'assistant' && message.completed)
    .sort((a, b) => a.createdAt - b.createdAt)
    .at(-1)?.text;
}
