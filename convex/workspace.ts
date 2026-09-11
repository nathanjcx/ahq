import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import {
  authKey,
  canSeeConnection,
  cleanText,
  identity,
  isPlatformAdmin,
  requireWorkspace,
  visibleTo,
  workspaceForIdentity,
} from './shared';

function publicConnection(connection: any) {
  return {
    id: connection._id,
    provider: connection.provider,
    name: connection.name,
    account: connection.account,
    status: connection.status,
    tools: connection.tools,
    allowedTools: connection.allowedTools,
    resourceScope: connection.resourceScope,
    lastCheckedAt: connection.lastCheckedAt,
    inboxMode: connection.inboxMode,
    error: connection.error,
  };
}

export const bootstrap = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const actor = await identity(ctx);
    const existing = await workspaceForIdentity(ctx, actor);
    if (existing) return { workspaceId: existing.workspace._id };
    const now = Date.now();
    const workspaceId = await ctx.db.insert('workspaces', {
      authKey: authKey(actor.subject, actor.orgId),
      name: cleanText(args.name, 'Workspace name', 120),
      monthlyBudget: 100,
      spent: 0,
      reserved: 0,
      nextSequence: 0,
      createdAt: now,
    });
    return { workspaceId };
  },
});

export const setBudget = mutation({
  args: { monthlyBudget: v.number() },
  handler: async (ctx, args) => {
    const { workspace, role } = await requireWorkspace(ctx);
    if (role !== 'owner' && role !== 'admin') throw new Error('Workspace administrator access required');
    if (!Number.isFinite(args.monthlyBudget) || args.monthlyBudget < 0 || args.monthlyBudget > 1_000_000)
      throw new Error('Invalid monthly budget');
    await ctx.db.patch(workspace._id, { monthlyBudget: Math.round(args.monthlyBudget * 100) / 100 });
    return null;
  },
});

export const dashboard = query({
  args: {},
  handler: async (ctx) => {
    const actor = await identity(ctx);
    const found = await workspaceForIdentity(ctx, actor);
    if (!found)
      return {
        workspace: null,
        isPlatformAdmin: isPlatformAdmin(actor.subject),
        employees: [],
        connections: [],
        tasks: [],
        events: [],
        proposals: [],
        inbox: [],
        artifacts: [],
      };
    const { workspace, role } = found;
    const [installations, allConnections, tasks, events, proposals, inbox, artifacts] = await Promise.all([
      ctx.db
        .query('installations')
        .withIndex('by_workspace', (q: any) => q.eq('workspaceId', workspace._id))
        .collect(),
      ctx.db
        .query('connections')
        .withIndex('by_workspace', (q: any) => q.eq('workspaceId', workspace._id))
        .collect(),
      ctx.db
        .query('tasks')
        .withIndex('by_workspace', (q: any) => q.eq('workspaceId', workspace._id))
        .order('desc')
        .take(200),
      ctx.db
        .query('events')
        .withIndex('by_workspace_sequence', (q: any) => q.eq('workspaceId', workspace._id))
        .order('desc')
        .take(500),
      ctx.db
        .query('proposals')
        .withIndex('by_workspace', (q: any) => q.eq('workspaceId', workspace._id))
        .order('desc')
        .take(200),
      ctx.db
        .query('inbox')
        .withIndex('by_workspace', (q: any) => q.eq('workspaceId', workspace._id))
        .order('desc')
        .take(200),
      ctx.db
        .query('artifacts')
        .withIndex('by_workspace', (q: any) => q.eq('workspaceId', workspace._id))
        .order('desc')
        .take(200),
    ]);
    const connections = allConnections.filter((connection: any) =>
      canSeeConnection(connection, actor.subject, role),
    );
    const visibleTasks = tasks.filter((task: any) => task.createdBy === actor.subject);
    const visibleTaskIds = new Set(visibleTasks.map((task: any) => task._id));
    const connectionCapabilities = new Map<string, Set<string>>();
    for (const connection of connections) {
      if (connection.status !== 'connected') continue;
      const existing = connectionCapabilities.get(connection.provider) || new Set<string>();
      connection.allowedTools.forEach((tool: string) => existing.add(tool));
      connectionCapabilities.set(connection.provider, existing);
    }
    const employees = await Promise.all(
      installations.map(async (installation: any) => {
        const version = await ctx.db.get(installation.versionId);
        if (!version) return null;
        const missingCapabilities = version.capabilities
          .filter((capability: any) => {
            if (capability.optional) return false;
            const tools = connectionCapabilities.get(capability.provider);
            return !tools || capability.tools.some((tool: string) => !tools.has(tool));
          })
          .map((capability: any) => capability.provider);
        return {
          id: installation._id,
          versionId: version._id,
          name: version.name,
          role: version.role,
          color: version.color,
          model: version.model,
          status: version.retiredAt ? 'retired' : missingCapabilities.length ? 'blocked' : 'ready',
          missingCapabilities,
        };
      }),
    );
    return {
      workspace: {
        id: workspace._id,
        name: workspace.name,
        role,
        monthlyBudget: workspace.monthlyBudget,
        spent: workspace.spent,
      },
      isPlatformAdmin: isPlatformAdmin(actor.subject),
      employees: employees.filter(Boolean),
      connections: connections.map(publicConnection),
      tasks: visibleTasks.map((task: any) => ({
        id: task._id,
        employeeId: task.employeeId,
        employeeName: task.employeeName,
        title: task.title,
        prompt: task.prompt,
        status: task.status,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        sessionId: task.sessionId,
        error: task.error,
        model: task.model,
        usage: task.usage,
      })),
      events: events
        .filter((event: any) => visibleTaskIds.has(event.taskId))
        .sort((a: any, b: any) => b.sequence - a.sequence)
        .slice(0, 500)
        .reverse()
        .map((event: any) => ({
          id: event._id,
          sequence: event.sequence,
          taskId: event.taskId,
          type: event.type,
          text: event.text,
          createdAt: event.createdAt,
          employeeName: event.employeeName,
          gap: event.gap,
        })),
      proposals: proposals
        .filter((proposal: any) => visibleTaskIds.has(proposal.taskId))
        .map((proposal: any) => ({
          id: proposal._id,
          taskId: proposal.taskId,
          employeeName: proposal.employeeName,
          provider: proposal.provider,
          tool: proposal.tool,
          arguments: proposal.arguments,
          summary: proposal.summary,
          status: proposal.status,
          correction: proposal.correction,
          correctionReason: proposal.correctionReason,
          createdAt: proposal.createdAt,
          result: proposal.result,
          originalActionId: proposal.originalActionId,
        })),
      inbox: inbox
        .filter((item: any) => visibleTo(item, actor.subject, role))
        .map((item: any) => ({
          id: item._id,
          provider: item.provider,
          title: item.title,
          preview: item.preview,
          sourceUrl: item.sourceUrl,
          createdAt: item.createdAt,
          status: item.status,
          taskId: item.taskId,
        })),
      artifacts: artifacts
        .filter((artifact: any) => visibleTaskIds.has(artifact.taskId))
        .map((artifact: any) => ({
          id: artifact._id,
          taskId: artifact.taskId,
          name: artifact.name,
          mediaType: artifact.mediaType,
          size: artifact.size,
          createdAt: artifact.createdAt,
        })),
    };
  },
});
