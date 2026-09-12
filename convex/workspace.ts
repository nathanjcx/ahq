import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { registryToolsFor } from './registry';
import {
  authKey,
  canDecide,
  canSeeConnection,
  canSeeTask,
  cleanText,
  identity,
  isPlatformAdmin,
  requireWorkspace,
  usagePeriod,
  workspaceForIdentity,
} from './shared';
import { periodUsage } from './work';

export const bootstrap = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const actor = await identity(ctx);
    const existing = await workspaceForIdentity(ctx, actor);
    if (existing) return { workspaceId: existing.workspace._id };
    const workspaceId = await ctx.db.insert('workspaces', {
      authKey: authKey(actor.subject, actor.orgId),
      name: cleanText(args.name, 'Workspace name', 120),
      monthlyTokenCap: 0,
      nextSequence: 0,
      createdAt: Date.now(),
    });
    return { workspaceId };
  },
});

export const setTokenCap = mutation({
  args: { monthlyTokenCap: v.number() },
  handler: async (ctx, args) => {
    const { workspace, role } = await requireWorkspace(ctx);
    if (role !== 'owner' && role !== 'admin') throw new Error('Workspace administrator access required');
    if (!Number.isFinite(args.monthlyTokenCap) || args.monthlyTokenCap < 0)
      throw new Error('Invalid monthly token cap');
    await ctx.db.patch(workspace._id, { monthlyTokenCap: Math.floor(args.monthlyTokenCap) });
    return null;
  },
});

export const dashboard = query({
  args: {},
  handler: async (ctx) => {
    const actor = await identity(ctx);
    const viewer = { subject: actor.subject, name: actor.name };
    const found = await workspaceForIdentity(ctx, actor);
    if (!found)
      return {
        workspace: null,
        viewer,
        isPlatformAdmin: isPlatformAdmin(actor.subject),
        employees: [],
        connections: [],
        projects: [],
        tasks: [],
        events: [],
        proposals: [],
        inbox: [],
        artifacts: [],
      };
    const { workspace, role } = found;
    const [installations, allConnections, projects, tasks, events, proposals, inbox, artifacts, usage] =
      await Promise.all([
        ctx.db
          .query('installations')
          .withIndex('by_workspace', (q) => q.eq('workspaceId', workspace._id))
          .collect(),
        ctx.db
          .query('connections')
          .withIndex('by_workspace', (q) => q.eq('workspaceId', workspace._id))
          .collect(),
        ctx.db
          .query('projects')
          .withIndex('by_workspace', (q) => q.eq('workspaceId', workspace._id))
          .collect(),
        ctx.db
          .query('tasks')
          .withIndex('by_workspace', (q) => q.eq('workspaceId', workspace._id))
          .order('desc')
          .take(200),
        ctx.db
          .query('events')
          .withIndex('by_workspace_sequence', (q) => q.eq('workspaceId', workspace._id))
          .order('desc')
          .take(500),
        ctx.db
          .query('proposals')
          .withIndex('by_workspace', (q) => q.eq('workspaceId', workspace._id))
          .order('desc')
          .take(200),
        ctx.db
          .query('inbox')
          .withIndex('by_workspace', (q) => q.eq('workspaceId', workspace._id))
          .order('desc')
          .take(200),
        ctx.db
          .query('artifacts')
          .withIndex('by_workspace', (q) => q.eq('workspaceId', workspace._id))
          .order('desc')
          .take(200),
        periodUsage(ctx, workspace._id),
      ]);
    const connections = allConnections.filter((connection) => canSeeConnection(connection, actor.subject));
    const connectionsById = new Map(allConnections.map((connection) => [connection._id, connection]));
    const visibleTasks = tasks.filter((task) => canSeeTask(task, actor.subject));
    const visibleTaskIds = new Set(visibleTasks.map((task) => task._id));
    const reviewed = new Map<string, Set<string>>();
    for (const connection of connections) {
      if (reviewed.has(connection.provider)) continue;
      reviewed.set(
        connection.provider,
        new Set(
          (await registryToolsFor(ctx, connection.provider))
            .filter((tool) => tool.mode !== 'blocked')
            .map((tool) => tool.name),
        ),
      );
    }
    const connectionCapabilities = new Map<string, Set<string>>();
    for (const connection of connections) {
      if (connection.status !== 'connected') continue;
      const existing = connectionCapabilities.get(connection.provider) || new Set<string>();
      connection.allowedTools.forEach((tool: string) => existing.add(tool));
      connectionCapabilities.set(connection.provider, existing);
    }
    const employees = await Promise.all(
      installations.map(async (installation) => {
        const version = await ctx.db.get(installation.versionId);
        if (!version) return null;
        const missingCapabilities = version.capabilities
          .filter((capability) => {
            if (capability.optional) return false;
            const tools = connectionCapabilities.get(capability.provider);
            return !tools || capability.tools.some((tool: string) => !tools.has(tool));
          })
          .map((capability) => capability.provider);
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
    const openHandoffs = new Map<Id<'projects'>, number>();
    for (const project of projects) {
      const posts = await ctx.db
        .query('projectPosts')
        .withIndex('by_project_kind', (q) => q.eq('projectId', project._id).eq('kind', 'handoff'))
        .collect();
      openHandoffs.set(project._id, posts.filter((post) => post.handoff?.status === 'pending').length);
    }
    return {
      workspace: {
        id: workspace._id,
        name: workspace.name,
        role,
        monthlyTokenCap: workspace.monthlyTokenCap,
        usage: {
          period: usagePeriod(),
          byModel: usage.map((row) => ({
            model: row.model,
            input: row.input,
            cached: row.cached,
            output: row.output,
            tasks: row.tasks,
          })),
        },
      },
      viewer,
      isPlatformAdmin: isPlatformAdmin(actor.subject),
      employees: employees.filter(Boolean),
      connections: connections.map((connection) => ({
        id: connection._id,
        provider: connection.provider,
        name: connection.name,
        account: connection.account,
        serverUrl: connection.serverUrl,
        status: connection.status,
        ownerSubject: connection.ownerSubject,
        ownerName: connection.ownerName,
        isOwner: connection.ownerSubject === actor.subject,
        visibility: connection.visibility,
        visibleToSubjects: connection.visibleToSubjects,
        // Only reviewed tools can be granted, so that is the list the owner manages.
        tools: connection.tools.filter((tool) => reviewed.get(connection.provider)?.has(tool)),
        allowedTools: connection.allowedTools,
        resourceScope: connection.resourceScope,
        inboxResources: connection.inboxResources,
        lastCheckedAt: connection.lastCheckedAt,
        inboxMode: connection.inboxMode,
        error: connection.error,
      })),
      projects: projects.map((project) => ({
        id: project._id,
        name: project.name,
        brief: project.brief,
        employeeIds: project.employeeIds,
        archivedAt: project.archivedAt,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        openHandoffs: openHandoffs.get(project._id) ?? 0,
      })),
      tasks: visibleTasks.map((task) => ({
        id: task._id,
        projectId: task.projectId,
        projectContext: task.projectContext,
        sourceTaskId: task.sourceTaskId,
        employeeId: task.employeeId,
        employeeName: task.employeeName,
        createdBy: task.createdBy,
        createdByName: task.createdByName,
        isOwner: task.createdBy === actor.subject,
        visibility: task.visibility,
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
        .filter((event) => visibleTaskIds.has(event.taskId))
        .sort((a, b) => b.sequence - a.sequence)
        .slice(0, 500)
        .reverse()
        .map((event) => ({
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
        // A pending write on your own connection is yours to decide even on a private task.
        .filter(
          (proposal) =>
            visibleTaskIds.has(proposal.taskId) ||
            connectionsById.get(proposal.connectionId)?.ownerSubject === actor.subject,
        )
        .map((proposal) => ({
          id: proposal._id,
          taskId: proposal.taskId,
          connectionId: proposal.connectionId,
          employeeName: proposal.employeeName,
          provider: proposal.provider,
          tool: proposal.tool,
          arguments: proposal.arguments,
          summary: proposal.summary,
          status: proposal.status,
          correction: proposal.correction,
          correctionReason: proposal.correctionReason,
          beforeState: proposal.beforeState,
          afterState: proposal.afterState,
          createdAt: proposal.createdAt,
          approvedBy: proposal.approvedBy,
          approvedByName: proposal.approvedByName,
          approvedAt: proposal.approvedAt,
          result: proposal.result,
          originalActionId: proposal.originalActionId,
          canDecide: canDecide(connectionsById.get(proposal.connectionId) ?? null, actor.subject, role),
        })),
      inbox: inbox
        .filter((item) => {
          const connection = connectionsById.get(item.connectionId);
          return connection ? canSeeConnection(connection, actor.subject) : false;
        })
        .map((item) => ({
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
        .filter((artifact) => visibleTaskIds.has(artifact.taskId))
        .map((artifact) => ({
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
