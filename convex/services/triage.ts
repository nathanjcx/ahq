import { v } from 'convex/values';
import { emergencyOpen, livePages, pagingState } from '../../lib/paging';
import type { Doc, Id } from '../_generated/dataModel';
import { mutation, query } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import { MEMORY_LIMITS, proposeMemory } from '../lib/memory';
import { channelFor, findChannel, insertPost } from '../lib/posts';
import { ensureSettings, settingsFor } from '../lib/schedule';
import { assignmentForFloor, insertJob, openSessionTask, startTask } from '../lib/tasks';
import { isAttendedTime } from '../lib/time';
import { emergencyOnlyTools, ensureTriageStaff, isOpenAlert, matchesTriageRules } from '../lib/triage';
import { policiesFor } from '../registry';
import { severity as severityValidator } from '../schema';
import { cleanText, clerkRole, requireService, untrustedBlock, type Ctx } from '../shared';
import { privateConnection, taskForRunToken, workspaceForActor } from './context';
import { recordAttempts } from './notifications';

const alertSource = v.union(
  v.literal('github'),
  v.literal('webhook'),
  v.literal('email'),
  v.literal('manual'),
);
type AlertSource = Doc<'alerts'>['source'];
type Severity = Doc<'alerts'>['severity'];

interface AlertInput {
  source: AlertSource;
  fingerprint: string;
  severity: Severity;
  title: string;
  detail: string;
  url?: string;
  affectedFloorIds?: Id<'floors'>[];
}

/**
 * One alert, deduplicated by fingerprint. A repeat bumps the open alert's count and changes nothing
 * else; a new one opens the triage task and posts the notice to triage and to the affected floors.
 */
async function ingestAlert(ctx: MutationCtx, workspace: Doc<'workspaces'>, input: AlertInput) {
  const fingerprint = cleanText(input.fingerprint, 'Fingerprint', 300);
  const title = cleanText(input.title, 'Alert title', 300);
  const detail = cleanText(input.detail, 'Alert detail', 10_000);
  const now = Date.now();
  const open = (
    await ctx.db
      .query('alerts')
      .withIndex('by_workspace_fingerprint', (q) =>
        q.eq('workspaceId', workspace._id).eq('fingerprint', fingerprint),
      )
      .collect()
  ).find(isOpenAlert);
  if (open) {
    await ctx.db.patch(open._id, { occurrences: open.occurrences + 1, updatedAt: now });
    return { alertId: open._id, taskId: open.triageTaskId, created: false };
  }
  const affectedFloorIds = [];
  for (const floorId of input.affectedFloorIds ?? []) {
    const floor = await ctx.db.get(floorId);
    if (floor && floor.workspaceId === workspace._id) affectedFloorIds.push(floor._id);
  }
  const { floor, installation, version } = await ensureTriageStaff(ctx, workspace, 'system');
  const taskId = await startTask(ctx, {
    workspace,
    createdBy: 'system',
    createdByName: 'Triage',
    employeeId: installation._id,
    version,
    title: `Triage: ${title}`.slice(0, 200),
    prompt: `Reproduce and fix this incident, then post a post-mortem with cause, fix, prevention, and the regression test.\n\n${untrustedBlock(
      [title, detail, input.url].filter(Boolean).join('\n'),
    )}`,
    floor: await assignmentForFloor(ctx, workspace._id, floor._id, installation._id),
  });
  const alertId = await ctx.db.insert('alerts', {
    workspaceId: workspace._id,
    source: input.source,
    fingerprint,
    severity: input.severity,
    title,
    detail,
    url: input.url,
    status: 'open',
    triageTaskId: taskId,
    affectedFloorIds,
    occurrences: 1,
    createdAt: now,
    updatedAt: now,
  });
  await postToChannels(ctx, workspace, affectedFloorIds, {
    kind: 'alert',
    authorName: version.name,
    authorEmployeeId: installation._id,
    text: [`${input.severity.toUpperCase()}: ${title}`, detail, input.url].filter(Boolean).join('\n'),
    taskId,
  });
  return { alertId, taskId, created: true };
}

/** The triage channel always hears about an incident; affected floors hear about their own. */
async function postToChannels(
  ctx: MutationCtx,
  workspace: Doc<'workspaces'>,
  floorIds: Id<'floors'>[],
  post: {
    kind: Doc<'posts'>['kind'];
    flag?: Doc<'posts'>['flag'];
    authorName: string;
    authorEmployeeId?: Id<'installations'>;
    text: string;
    taskId?: Id<'tasks'>;
  },
) {
  const channels = [await channelFor(ctx, workspace._id, 'triage', '')];
  for (const floorId of floorIds) channels.push(await channelFor(ctx, workspace._id, 'floor', floorId));
  for (const channel of channels) await insertPost(ctx, { channel, ...post });
}

export const ingest = mutation({
  args: {
    secret: v.string(),
    workspaceId: v.id('workspaces'),
    source: alertSource,
    fingerprint: v.string(),
    severity: severityValidator,
    title: v.string(),
    detail: v.string(),
    url: v.optional(v.string()),
    affectedFloorIds: v.optional(v.array(v.id('floors'))),
  },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) throw new Error('Workspace not found');
    return ingestAlert(ctx, workspace, args);
  },
});

function text(value: unknown, max: number) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

/** Labels, title, and body of a GitHub issue, pull request, or comment delivery. */
function githubDelivery(payload: string) {
  const parsed: unknown = JSON.parse(payload);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('GitHub payload must be an object');
  const body = parsed as Record<string, unknown>;
  const subject = (body.issue ?? body.pull_request) as Record<string, unknown> | undefined;
  const repository = body.repository as Record<string, unknown> | undefined;
  if (!subject || !repository) return null;
  const comment = body.comment as Record<string, unknown> | undefined;
  const labels = Array.isArray(subject.labels)
    ? subject.labels.map((label) =>
        label && typeof label === 'object' ? text((label as Record<string, unknown>).name, 120) : '',
      )
    : [];
  const repositoryName = text(repository.full_name, 200);
  const number = typeof subject.number === 'number' ? subject.number : 0;
  return {
    labels: labels.filter(Boolean),
    title: text(subject.title, 300) || `Activity in ${repositoryName}`,
    body: text(comment?.body ?? subject.body, 5_000),
    url: text(comment?.html_url ?? subject.html_url, 2_048),
    fingerprint: `github:${repositoryName}#${number}`,
  };
}

async function matchGithubFor(ctx: MutationCtx, workspace: Doc<'workspaces'>, payload: string) {
  const settings = await settingsFor(ctx, workspace._id);
  const rules = settings.triageRules ?? [];
  if (!rules.length) return { matched: false as const };
  const delivery = githubDelivery(payload);
  if (!delivery) return { matched: false as const };
  const rule = matchesTriageRules(rules, [...delivery.labels, delivery.title, delivery.body]);
  if (!rule) return { matched: false as const };
  const alert = await ingestAlert(ctx, workspace, {
    source: 'github',
    fingerprint: delivery.fingerprint,
    severity: 'high',
    title: delivery.title,
    detail: [`Matched triage rule "${rule}".`, delivery.body].filter(Boolean).join('\n'),
    url: delivery.url || undefined,
  });
  return { matched: true as const, rule, ...alert };
}

/** Decides whether one GitHub delivery is an alert for this workspace, by label or keyword rule. */
export const matchGithub = mutation({
  args: { secret: v.string(), workspaceId: v.id('workspaces'), payload: v.string() },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) throw new Error('Workspace not found');
    return matchGithubFor(ctx, workspace, args.payload);
  },
});

/**
 * The same decision for a native webhook, which knows the repository it came from but not the
 * workspaces following it. Runs once per workspace with a connected GitHub account on that resource.
 */
export const matchGithubDelivery = mutation({
  args: { secret: v.string(), resourceIds: v.array(v.string()), payload: v.string() },
  returns: v.object({ matched: v.number() }),
  handler: async (ctx, args) => {
    requireService(args.secret);
    const connections = await ctx.db
      .query('connections')
      .withIndex('by_provider_status', (q) => q.eq('provider', 'github').eq('status', 'connected'))
      .collect();
    const workspaceIds = new Set(
      connections
        .filter((connection) =>
          connection.inboxResources.some((resource) => args.resourceIds.includes(resource)),
        )
        .map((connection) => connection.workspaceId),
    );
    let matched = 0;
    for (const workspaceId of workspaceIds) {
      const workspace = await ctx.db.get(workspaceId);
      if (!workspace) continue;
      if ((await matchGithubFor(ctx, workspace, args.payload)).matched) matched += 1;
    }
    return { matched };
  },
});

/** Email the classifier turn has not seen yet. The worker answers with `recordEmailClassification`. */
export const classifyEmailInputs = query({
  args: { secret: v.string(), workspaceId: v.id('workspaces') },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const rows = await ctx.db
      .query('inbox')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', args.workspaceId))
      .order('desc')
      .take(200);
    return rows
      .filter((row) => row.provider === 'google-workspace' && row.triageCheckedAt === undefined)
      .slice(0, 20)
      .map((row) => ({
        itemId: row._id,
        title: row.title,
        preview: row.preview,
        sourceUrl: row.sourceUrl,
        createdAt: row.createdAt,
      }));
  },
});

export const recordEmailClassification = mutation({
  args: {
    secret: v.string(),
    itemId: v.id('inbox'),
    isAlert: v.boolean(),
    severity: v.optional(severityValidator),
    title: v.optional(v.string()),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new Error('Inbox item not found');
    await ctx.db.patch(item._id, { triageCheckedAt: Date.now() });
    if (!args.isAlert) return { alertId: undefined, created: false };
    const workspace = await ctx.db.get(item.workspaceId);
    if (!workspace) throw new Error('Workspace not found');
    return ingestAlert(ctx, workspace, {
      source: 'email',
      fingerprint: `email:${item.externalId}`,
      severity: args.severity ?? 'medium',
      title: args.title || item.title,
      detail: args.detail || item.preview,
      url: item.sourceUrl,
    });
  },
});

function alertForTask(ctx: Ctx, taskId: Id<'tasks'>) {
  return ctx.db
    .query('alerts')
    .withIndex('by_triage_task', (q) => q.eq('triageTaskId', taskId))
    .first();
}

/** The post-mortem: cause, fix, prevention, regression test. It closes the fix, not the alert. */
export const resolve = mutation({
  args: {
    secret: v.string(),
    taskId: v.id('tasks'),
    cause: v.string(),
    fix: v.string(),
    prevention: v.string(),
    regressionRef: v.string(),
  },
  returns: v.object({ alertId: v.id('alerts') }),
  handler: async (ctx, args) => {
    requireService(args.secret);
    const task = await ctx.db.get(args.taskId);
    const alert = await alertForTask(ctx, args.taskId);
    if (!task || !alert) throw new Error('Alert not found');
    const workspace = await ctx.db.get(alert.workspaceId);
    if (!workspace) throw new Error('Workspace not found');
    const now = Date.now();
    const body = [
      `Post-mortem: ${alert.title}`,
      `Cause: ${cleanText(args.cause, 'Cause', 2_000)}`,
      `Fix: ${cleanText(args.fix, 'Fix', 2_000)}`,
      `Prevention: ${cleanText(args.prevention, 'Prevention', 2_000)}`,
      `Regression test: ${cleanText(args.regressionRef, 'Regression test', 500)}`,
    ].join('\n');
    await postToChannels(ctx, workspace, alert.affectedFloorIds, {
      kind: 'finding',
      authorName: task.employeeName,
      authorEmployeeId: task.employeeId,
      text: body,
      taskId: task._id,
    });
    // The prevention is the claim worth keeping. It enters memory proposed; the janitor and an
    // administrator decide whether it becomes workspace memory.
    await proposeMemory(ctx, {
      workspaceId: workspace._id,
      scope: 'workspace',
      scopeId: workspace._id,
      kind: 'procedure',
      text: `${alert.title}: ${args.prevention}`.slice(0, MEMORY_LIMITS.text),
      tags: ['triage', 'post-mortem'],
      sourceTaskId: task._id,
      author: 'agent',
      authorName: task.employeeName,
      confidence: 0.6,
    });
    await ctx.db.patch(alert._id, { status: 'fixed', updatedAt: now });
    return { alertId: alert._id };
  },
});

/**
 * When this run last reached a tool nothing but the emergency rule would have admitted.
 *
 * Newest first, and only the calls that went through: an incident's task is reused for the whole
 * lifetime of the alert and every dispatch writes a started row beside its terminal one, so reading
 * the oldest rows would lose sight of the emergency call after a hundred ordinary ones.
 */
async function lastEmergencyCall(ctx: Ctx, task: Doc<'tasks'>) {
  const settings = await settingsFor(ctx, task.workspaceId);
  const emergencyOnly = emergencyOnlyTools(settings);
  if (!emergencyOnly.size) return undefined;
  const calls = await ctx.db
    .query('toolCalls')
    .withIndex('by_task', (q) => q.eq('taskId', task._id))
    .filter((q) => q.eq(q.field('outcome'), 'succeeded'))
    .order('desc')
    .take(200);
  return calls.find((call) => emergencyOnly.has(call.tool))?.createdAt;
}

/**
 * Whether the run's latest emergency call has an incident report, its own or the placeholder filed
 * for it. The report has to be newer than the call: the alert's task is reused across runs, so an
 * earlier incident's report would otherwise stand in for every later emergency action on it.
 */
async function hasIncidentReport(ctx: Ctx, task: Doc<'tasks'>, since: number) {
  const channel = await findChannel(ctx, task.workspaceId, 'triage', '');
  if (!channel) return false;
  const posts = await ctx.db
    .query('posts')
    .withIndex('by_channel_kind', (q) => q.eq('channelId', channel._id).eq('kind', 'finding'))
    .order('desc')
    .take(100);
  return posts.some(
    (post) =>
      post.taskId === task._id &&
      post.createdAt >= since &&
      (post.flag === 'incident' || post.flag === 'missing'),
  );
}

const REPORT_SECTIONS = [
  ['issue', 'Issue'],
  ['reproduction', 'Reproduction'],
  ['fix', 'Fix'],
  ['reason', 'Why it acted without permission'],
  ['sideEffects', 'Side effects'],
  ['risks', 'Knock-on risks'],
] as const;

/**
 * The incident report the emergency rule requires: what broke, how it was reproduced, what was
 * changed, why it was done without permission, and what it might have knocked over. It goes to the
 * triage channel and to every affected floor, and the Triage page lists it through
 * `triage:incidentReports`.
 */
export const fileIncidentReport = mutation({
  args: {
    secret: v.string(),
    runToken: v.string(),
    issue: v.string(),
    reproduction: v.string(),
    fix: v.string(),
    reason: v.string(),
    sideEffects: v.string(),
    risks: v.string(),
  },
  returns: v.object({ filed: v.boolean(), alertId: v.union(v.id('alerts'), v.null()) }),
  handler: async (ctx, args) => {
    requireService(args.secret);
    const task = await taskForRunToken(ctx, args.runToken);
    const installation = await ctx.db.get(task.employeeId);
    if (!installation || installation.kind !== 'triage') throw new Error('Triage access required');
    const workspace = await ctx.db.get(task.workspaceId);
    if (!workspace) throw new Error('Workspace not found');
    const alert = await alertForTask(ctx, task._id);
    const body = [
      `Incident report: ${alert?.title ?? task.title}`,
      ...REPORT_SECTIONS.map(([field, label]) => `${label}: ${cleanText(args[field], label, 5_000)}`),
    ].join('\n');
    await postToChannels(ctx, workspace, alert?.affectedFloorIds ?? [], {
      kind: 'finding',
      flag: 'incident',
      authorName: task.employeeName,
      authorEmployeeId: task.employeeId,
      text: body,
      taskId: task._id,
    });
    return { filed: true, alertId: alert?._id ?? null };
  },
});

/**
 * The end of a triage run, and the one place the mandatory report is enforced.
 *
 * A run that reached the emergency allow-list and filed no report does not get to leave it unwritten:
 * the platform files a placeholder marked `missing` in its place, so the Triage page shows the gap
 * rather than nothing, and posts an escalation to the workspace channel for the next meeting.
 */
export const closeRun = mutation({
  args: { secret: v.string(), taskId: v.id('tasks') },
  returns: v.object({ emergency: v.boolean(), reportMissing: v.boolean() }),
  handler: async (ctx, args) => {
    requireService(args.secret);
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error('Task not found');
    const workspace = await ctx.db.get(task.workspaceId);
    if (!workspace) throw new Error('Workspace not found');
    const emergencyAt = await lastEmergencyCall(ctx, task);
    if (emergencyAt === undefined) return { emergency: false, reportMissing: false };
    if (await hasIncidentReport(ctx, task, emergencyAt)) return { emergency: true, reportMissing: false };
    const alert = await alertForTask(ctx, task._id);
    const title = alert?.title ?? task.title;
    await postToChannels(ctx, workspace, alert?.affectedFloorIds ?? [], {
      kind: 'finding',
      flag: 'missing',
      authorName: 'Triage',
      text: [
        `Incident report missing: ${title}`,
        `${task.employeeName} used the emergency allow-list on this incident and filed no incident report.`,
        'The issue, the reproduction, the fix, why it acted without permission, and the side effects are all unrecorded. Read the timeline for what it actually called.',
      ].join('\n'),
      taskId: task._id,
    });
    await insertPost(ctx, {
      channel: await channelFor(ctx, workspace._id, 'workspace', ''),
      kind: 'system',
      authorName: 'Triage',
      text: `Escalation: ${task.employeeName} acted under the emergency rule on "${title}" and filed no incident report.`,
      taskId: task._id,
    });
    return { emergency: true, reportMissing: true };
  },
});

/**
 * One page for one open incident, recorded and handed back for delivery.
 *
 * The scheduler decides when a page is due; this writes the attempt and says what it is for, so the
 * wording of an escalation lives with the ledger rather than in the worker. A settled incident and an
 * answered one page nobody, which is what makes an acknowledgement reset the rule.
 */
export const pageAlert = mutation({
  args: { secret: v.string(), alertId: v.id('alerts') },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const alert = await ctx.db.get(args.alertId);
    if (!alert) throw new Error('Alert not found');
    const workspace = await ctx.db.get(alert.workspaceId);
    if (!workspace) throw new Error('Workspace not found');
    const now = Date.now();
    const rows = await ctx.db
      .query('notifications')
      .withIndex('by_alert', (q) => q.eq('alertId', alert._id))
      .collect();
    const paging = pagingState(rows, now);
    if (!isOpenAlert(alert) || paging.acknowledged || paging.nextAttemptAt === undefined) return [];
    // One page reaches every subject at once, so the attempt is the page's number and not the row's.
    const attempt = livePages(rows).pages.length + 1;
    const remaining = paging.required - attempt;
    return recordAttempts(ctx, workspace, {
      kind: 'triage',
      title: `Incident needs a person: ${alert.title}`,
      text: [
        `A ${alert.severity} incident is open outside attended hours and needs a person to go further.`,
        remaining > 0
          ? `Attempt ${attempt} of ${paging.required}. ${remaining} more unanswered and triage may merge and deploy under the emergency rule.`
          : `Attempt ${attempt} of ${paging.required}. Unanswered, triage may merge and deploy under the emergency rule twenty minutes after the first attempt.`,
      ].join('\n'),
      alertId: alert._id,
    });
  },
});

/**
 * What the gateway needs to decide which triage tools to expose: whether a person is expected to be
 * watching, the two allow-lists, and how far the emergency rule has run on this incident.
 *
 * The ledger is read whole, from the first page that still stands rather than over a rolling window,
 * so the count only grows while nobody answers and `emergency` turns on exactly once three delivered
 * pages have gone unanswered for twenty minutes. An acknowledgement resets it.
 */
export const authority = query({
  args: { secret: v.string(), runToken: v.string() },
  returns: v.object({
    attended: v.boolean(),
    allowList: v.array(v.string()),
    emergencyAllowList: v.array(v.string()),
    unattendedAttempts: v.number(),
    emergency: v.boolean(),
  }),
  handler: async (ctx, args) => {
    requireService(args.secret);
    const task = await taskForRunToken(ctx, args.runToken);
    const settings = await settingsFor(ctx, task.workspaceId);
    const alert = await alertForTask(ctx, task._id);
    const now = Date.now();
    const paging = pagingState(
      alert && isOpenAlert(alert)
        ? await ctx.db
            .query('notifications')
            .withIndex('by_alert', (q) => q.eq('alertId', alert._id))
            .collect()
        : [],
      now,
    );
    const attended = isAttendedTime(now, settings);
    return {
      attended,
      allowList: settings.triageAllowList,
      emergencyAllowList: settings.emergencyAllowList,
      unattendedAttempts: paging.attempts,
      emergency: !attended && emergencyOpen(paging, now),
    };
  },
});

/**
 * The connections a triage run may write through, and the policies for them.
 *
 * Triage authority comes from the workspace's allow-list, not from a marketplace capability: the
 * reserved triage employee has none, so `activeTaskContext` would hand it nothing. The intersection
 * that matters here is the allow-list against what the connection was actually granted, and the
 * gateway still re-checks `authority` on every call before it dispatches one of these.
 */
export const writeConnections = query({
  args: { secret: v.string(), runToken: v.string() },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const task = await taskForRunToken(ctx, args.runToken);
    const installation = await ctx.db.get(task.employeeId);
    if (!installation || installation.kind !== 'triage') throw new Error('Triage access required');
    const settings = await settingsFor(ctx, task.workspaceId);
    const admitted = new Set([...settings.triageAllowList, ...settings.emergencyAllowList]);
    const rows = await ctx.db
      .query('connections')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', task.workspaceId))
      .collect();
    const connections = rows
      // A member's private connection is theirs; an unattended merge must not run on a credential
      // nobody shared with the workspace. `activeTaskContext` holds the same line for ordinary work.
      .filter((row) => row.status === 'connected' && row.visibility === 'workspace')
      .map((row) => ({ ...row, allowedTools: row.allowedTools.filter((tool) => admitted.has(tool)) }))
      .filter((row) => row.allowedTools.length > 0);
    return {
      connections: connections.map(privateConnection),
      policies: await policiesFor(
        ctx,
        connections.map((connection) => connection.provider),
      ),
    };
  },
});

/**
 * Opens the classifier turn over the workspace's unchecked email. The triage instance's standing
 * session runs it, because a classification is triage work with no incident of its own yet.
 */
/** Opens the hourly email classifier turn in the triage standing session. Idempotent per hour. */
export async function enqueueEmailClassificationFor(ctx: MutationCtx, workspace: Doc<'workspaces'>) {
  const { floor, installation, version } = await ensureTriageStaff(ctx, workspace, 'system');
  const taskId = await openSessionTask(ctx, {
    workspace,
    employeeId: installation._id,
    version,
    kind: 'standing',
    key: 'standing',
    title: `${installation.name ?? version.name} standing session`,
    prompt: 'You answer this workspace’s incidents. Wait for a triage run; do nothing until one arrives.',
    floor: await assignmentForFloor(ctx, workspace._id, floor._id, installation._id),
  });
  const jobId = await insertJob(ctx, {
    workspaceId: workspace._id,
    taskId,
    uniqueKey: `email_classify:${workspace._id}:${Math.floor(Date.now() / 3_600_000)}`,
    kind: 'email_classify',
    payload: JSON.stringify({ workspaceId: workspace._id, model: version.model }),
  });
  return { taskId, jobId: jobId ?? null };
}

export const enqueueEmailClassification = mutation({
  args: { secret: v.string(), workspaceId: v.id('workspaces') },
  returns: v.object({ taskId: v.id('tasks'), jobId: v.union(v.id('jobs'), v.null()) }),
  handler: async (ctx, args) => {
    requireService(args.secret);
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) throw new Error('Workspace not found');
    return enqueueEmailClassificationFor(ctx, workspace);
  },
});

/** The sealed alert-intake secret, unsealed only by the web service that verifies a signature. */
export const alertSecret = query({
  args: { secret: v.string(), workspaceId: v.id('workspaces') },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    requireService(args.secret);
    const settings = await ctx.db
      .query('workspaceSettings')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', args.workspaceId))
      .unique();
    return settings?.alertSecretCiphertext ?? null;
  },
});

/**
 * The same write, made by a workspace administrator rather than by the platform.
 *
 * The plaintext secret never reaches Convex: the web route seals it and passes the ciphertext with
 * the signed-in actor, and the role is decided here from the same Clerk claims every other mutation
 * uses. Passing no ciphertext clears the secret and closes the signed endpoint.
 */
export const setAlertSecretForActor = mutation({
  args: {
    secret: v.string(),
    authSubject: v.string(),
    authOrgId: v.optional(v.string()),
    authOrgRole: v.optional(v.string()),
    alertSecretCiphertext: v.optional(v.string()),
  },
  returns: v.object({ updatedAt: v.number() }),
  handler: async (ctx, args) => {
    requireService(args.secret);
    const workspace = await workspaceForActor(ctx, args.authSubject, args.authOrgId);
    if (!workspace) throw new Error('Create a workspace first');
    const role = clerkRole(args.authOrgId, args.authOrgRole);
    if (role !== 'owner' && role !== 'admin') throw new Error('Workspace administrator access required');
    const settings = await ensureSettings(ctx, workspace._id);
    const updatedAt = Date.now();
    await ctx.db.patch(settings._id, {
      alertSecretCiphertext: args.alertSecretCiphertext,
      alertSecretUpdatedAt: updatedAt,
      updatedAt,
    });
    return { updatedAt };
  },
});
