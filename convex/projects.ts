import { v } from 'convex/values';
import { mutation } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { cleanText, requireWorkspace } from './shared';

function projectFields(name: string, brief: string) {
  return {
    name: cleanText(name, 'Project name', 120),
    brief: cleanText(brief, 'Project brief', 5_000),
  };
}

async function validateEmployees(
  ctx: MutationCtx,
  workspaceId: Id<'workspaces'>,
  employeeIds: Id<'installations'>[],
) {
  if (new Set(employeeIds).size !== employeeIds.length)
    throw new Error('A project cannot include the same employee more than once');
  for (const employeeId of employeeIds) {
    const employee = await ctx.db.get(employeeId);
    if (!employee || employee.workspaceId !== workspaceId) throw new Error('Employee not found');
  }
}

export async function assignmentForProject(
  ctx: MutationCtx,
  workspaceId: Id<'workspaces'>,
  projectId: Id<'projects'>,
  employeeId: Id<'installations'>,
) {
  const project = await ctx.db.get(projectId);
  if (!project || project.workspaceId !== workspaceId) throw new Error('Project not found');
  if (project.archivedAt !== undefined) throw new Error('Project is archived');
  if (!project.employeeIds.includes(employeeId)) throw new Error('Employee is not assigned to this project');
  return {
    projectId: project._id,
    projectContext: { name: project.name, brief: project.brief },
  };
}

async function requireProject(
  ctx: MutationCtx,
  workspaceId: Id<'workspaces'>,
  projectId: Id<'projects'>,
): Promise<Doc<'projects'>> {
  const project = await ctx.db.get(projectId);
  if (!project || project.workspaceId !== workspaceId) throw new Error('Project not found');
  return project;
}

export const create = mutation({
  args: { name: v.string(), brief: v.string(), employeeIds: v.array(v.id('installations')) },
  handler: async (ctx, args) => {
    const { workspace, actor } = await requireWorkspace(ctx);
    const fields = projectFields(args.name, args.brief);
    await validateEmployees(ctx, workspace._id, args.employeeIds);
    const now = Date.now();
    const projectId = await ctx.db.insert('projects', {
      workspaceId: workspace._id,
      createdBy: actor.subject,
      ...fields,
      employeeIds: args.employeeIds,
      createdAt: now,
      updatedAt: now,
    });
    return { projectId };
  },
});

export const update = mutation({
  args: {
    projectId: v.id('projects'),
    name: v.string(),
    brief: v.string(),
    employeeIds: v.array(v.id('installations')),
  },
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspace(ctx);
    const project = await requireProject(ctx, workspace._id, args.projectId);
    const fields = projectFields(args.name, args.brief);
    await validateEmployees(ctx, workspace._id, args.employeeIds);
    await ctx.db.patch(project._id, { ...fields, employeeIds: args.employeeIds, updatedAt: Date.now() });
    return null;
  },
});

export const setArchived = mutation({
  args: { projectId: v.id('projects'), archived: v.boolean() },
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspace(ctx);
    const project = await requireProject(ctx, workspace._id, args.projectId);
    await ctx.db.patch(project._id, {
      archivedAt: args.archived ? project.archivedAt || Date.now() : undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});
