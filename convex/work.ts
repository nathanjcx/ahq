import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { canSeeConnection, cleanText, randomToken, usagePeriod, type Ctx } from './shared';

export async function requireProject(
  ctx: Ctx,
  workspaceId: Id<'workspaces'>,
  projectId: Id<'projects'>,
): Promise<Doc<'projects'>> {
  const project = await ctx.db.get(projectId);
  if (!project || project.workspaceId !== workspaceId) throw new Error('Project not found');
  return project;
}

export async function assignmentForProject(
  ctx: Ctx,
  workspaceId: Id<'workspaces'>,
  projectId: Id<'projects'>,
  employeeId: Id<'installations'>,
) {
  const project = await requireProject(ctx, workspaceId, projectId);
  if (project.archivedAt !== undefined) throw new Error('Project is archived');
  if (!project.employeeIds.includes(employeeId)) throw new Error('Employee is not assigned to this project');
  return { projectId: project._id, projectContext: { name: project.name, brief: project.brief } };
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

export async function systemPost(ctx: MutationCtx, task: Doc<'tasks'>, text: string) {
  if (!task.projectId) return;
  await ctx.db.insert('projectPosts', {
    workspaceId: task.workspaceId,
    projectId: task.projectId,
    kind: 'system',
    authorName: task.employeeName,
    text: text.slice(0, 2_000),
    taskId: task._id,
    createdAt: Date.now(),
  });
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
    project?: { projectId: Id<'projects'>; projectContext: { name: string; brief: string } };
    sourceTaskId?: Id<'tasks'>;
    sourceProposalId?: Id<'proposals'>;
    messageExternalId?: string;
    jobPayload?: Record<string, unknown>;
  },
) {
  const now = Date.now();
  const title = cleanText(input.title, 'Title', 200);
  const prompt = cleanText(input.prompt, 'Prompt', 50_000);
  const taskId = await ctx.db.insert('tasks', {
    workspaceId: input.workspace._id,
    ...(input.project ?? {}),
    ...(input.sourceTaskId ? { sourceTaskId: input.sourceTaskId } : {}),
    ...(input.sourceProposalId ? { sourceProposalId: input.sourceProposalId } : {}),
    createdBy: input.createdBy,
    createdByName: input.createdByName,
    visibility: input.project ? 'workspace' : 'private',
    employeeId: input.employeeId,
    versionId: input.version._id,
    employeeName: input.version.name,
    title,
    prompt,
    status: 'queued',
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
  await insertJob(ctx, {
    workspaceId: input.workspace._id,
    taskId,
    uniqueKey: `start:${taskId}`,
    kind: 'start_task',
    payload: JSON.stringify({ taskId, ...(input.jobPayload ?? {}) }),
  });
  const task = await ctx.db.get(taskId);
  if (task) await systemPost(ctx, task, `${input.version.name} started: ${title}`);
  return taskId;
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

export async function insertNote(
  ctx: MutationCtx,
  input: {
    project: Doc<'projects'>;
    authorSubject?: string;
    authorName: string;
    text: string;
    taskId?: Id<'tasks'>;
  },
) {
  if (input.project.archivedAt !== undefined) throw new Error('Project is archived');
  const postId = await ctx.db.insert('projectPosts', {
    workspaceId: input.project.workspaceId,
    projectId: input.project._id,
    kind: 'note',
    authorSubject: input.authorSubject,
    authorName: input.authorName,
    text: cleanText(input.text, 'Post', 5_000),
    taskId: input.taskId,
    createdAt: Date.now(),
  });
  return { postId };
}

/** A handoff names a staffed employee, a brief, and the task whose result carries the context. */
export async function insertHandoff(
  ctx: MutationCtx,
  input: {
    project: Doc<'projects'>;
    authorSubject?: string;
    authorName: string;
    toEmployeeId: Id<'installations'>;
    brief: string;
    sourceTaskId?: Id<'tasks'>;
  },
) {
  if (input.project.archivedAt !== undefined) throw new Error('Project is archived');
  const installation = await ctx.db.get(input.toEmployeeId);
  if (!installation || installation.workspaceId !== input.project.workspaceId)
    throw new Error('Employee not found');
  if (!input.project.employeeIds.includes(installation._id))
    throw new Error('Employee is not assigned to this project');
  const version = await ctx.db.get(installation.versionId);
  if (!version) throw new Error('Employee version is retired');
  const brief = cleanText(input.brief, 'Handoff brief', 5_000);
  const postId = await ctx.db.insert('projectPosts', {
    workspaceId: input.project.workspaceId,
    projectId: input.project._id,
    kind: 'handoff',
    authorSubject: input.authorSubject,
    authorName: input.authorName,
    text: brief,
    taskId: input.sourceTaskId,
    handoff: {
      toEmployeeId: installation._id,
      toEmployeeName: version.name,
      brief,
      status: 'pending',
    },
    createdAt: Date.now(),
  });
  return { postId };
}
