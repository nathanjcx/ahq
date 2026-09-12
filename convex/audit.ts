import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import { groupFindings, publicFinding } from './lib/audit';
import { appendAgenda, nextScheduledMeeting } from './lib/calendar';
import { employeeName } from './lib/meetings';
import { channelFor, insertPost } from './lib/posts';
import { requireWorkspace, type Ctx, type WorkspaceRole } from './shared';

const findingStatus = v.union(
  v.literal('open'),
  v.literal('addressed'),
  v.literal('verified'),
  v.literal('escalated'),
);

async function workspaceFindings(ctx: Ctx, workspaceId: Id<'workspaces'>, date?: string) {
  return ctx.db
    .query('auditFindings')
    .withIndex('by_workspace_date', (q) =>
      date ? q.eq('workspaceId', workspaceId).eq('auditDate', date) : q.eq('workspaceId', workspaceId),
    )
    .order('desc')
    .take(500);
}

/** Findings the interface lists, filtered by employee, status, or audit date. */
export const findings = query({
  args: {
    employeeId: v.optional(v.id('installations')),
    status: v.optional(findingStatus),
    date: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspace(ctx);
    const rows = (await workspaceFindings(ctx, workspace._id, args.date)).filter(
      (finding) =>
        (!args.employeeId || finding.employeeId === args.employeeId) &&
        (!args.status || finding.status === args.status),
    );
    return Promise.all(rows.map((finding) => publicFinding(ctx, finding)));
  },
});

/** One night's findings grouped into a document per instance. */
export const documents = query({
  args: { date: v.string() },
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspace(ctx);
    const rows = await workspaceFindings(ctx, workspace._id, args.date);
    return groupFindings(await Promise.all(rows.map((finding) => publicFinding(ctx, finding))));
  },
});

/** The person who created the audited task, or a workspace owner or administrator, decides. */
function canDecideFinding(task: Doc<'tasks'> | null, subject: string, role: WorkspaceRole) {
  return role === 'owner' || role === 'admin' || task?.createdBy === subject;
}

async function decidableFinding(ctx: Ctx, workspaceId: Id<'workspaces'>, findingId: Id<'auditFindings'>) {
  const finding = await ctx.db.get(findingId);
  if (!finding || finding.workspaceId !== workspaceId) throw new Error('Finding not found');
  return finding;
}

/** A person records that a finding was dealt with; the next audit verifies it against the record. */
export const markAddressed = mutation({
  args: { id: v.id('auditFindings') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { workspace, role, actor } = await requireWorkspace(ctx);
    const finding = await decidableFinding(ctx, workspace._id, args.id);
    const task = finding.taskId ? await ctx.db.get(finding.taskId) : null;
    if (!canDecideFinding(task, actor.subject, role))
      throw new Error('Only the task owner or an administrator can address this finding');
    if (finding.status === 'open' || finding.status === 'escalated')
      await ctx.db.patch(finding._id, { status: 'addressed', updatedAt: Date.now() });
    return null;
  },
});

/**
 * An administrator escalates an ignored finding. It goes on the record twice: as a post in the
 * workspace channel, and as an item on the agenda of the next meeting already booked.
 */
export const escalate = mutation({
  args: { id: v.id('auditFindings') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { workspace, role, actor } = await requireWorkspace(ctx);
    if (role !== 'owner' && role !== 'admin') throw new Error('Only an administrator can escalate a finding');
    const finding = await decidableFinding(ctx, workspace._id, args.id);
    if (finding.status === 'verified' || finding.status === 'escalated') return null;
    await ctx.db.patch(finding._id, { status: 'escalated', updatedAt: Date.now() });
    const employee = await ctx.db.get(finding.employeeId);
    const who = employee ? await employeeName(ctx, employee) : 'An employee';
    await insertPost(ctx, {
      channel: await channelFor(ctx, workspace._id, 'workspace', ''),
      kind: 'finding',
      authorSubject: actor.subject,
      authorName: actor.name,
      text: `Escalated finding against ${who}: ${finding.claim}\nRequired action: ${finding.requiredAction}`,
      taskId: finding.taskId,
    });
    const meeting = await nextScheduledMeeting(ctx, workspace._id);
    if (meeting) await appendAgenda(ctx, meeting, [`Escalated finding: ${finding.claim}`]);
    return null;
  },
});
