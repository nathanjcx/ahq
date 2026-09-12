import type { Persona } from '../../lib/contracts/core';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

/** Employee kinds the workspace creates for itself. `worker` is hired from the marketplace instead. */
export type ReservedKind = 'janitor' | 'auditor' | 'triage';

/** The category and publisher that keep a reserved employee out of the marketplace listing. */
export const RESERVED_CATEGORY = 'Reserved';
export const RESERVED_PUBLISHER = 'system';

/** A version is reserved when the workspace made it, whatever category a later edit gives it. */
export function isReservedVersion(version: Doc<'employeeVersions'>) {
  return version.category === RESERVED_CATEGORY || version.publishedBy === RESERVED_PUBLISHER;
}

/**
 * The workspace's single instance of a reserved kind, with the draft and version it runs on, created
 * on first use. Reserved employees are made by the workspace rather than hired, carry no
 * capabilities, and never appear in the marketplace. Safe to call on every tick.
 */
export async function ensureReservedInstance(
  ctx: MutationCtx,
  workspaceId: Id<'workspaces'>,
  kind: ReservedKind,
  name: string,
  persona: Persona,
): Promise<{ installation: Doc<'installations'>; version: Doc<'employeeVersions'> }> {
  const installations = await ctx.db
    .query('installations')
    .withIndex('by_workspace', (q) => q.eq('workspaceId', workspaceId))
    .collect();
  const existing = installations.find((row) => row.kind === kind && row.status !== 'retired');
  if (existing) {
    const version = await ctx.db.get(existing.versionId);
    if (version) return { installation: existing, version };
  }
  const now = Date.now();
  const role = `${kind[0].toUpperCase()}${kind.slice(1)}`;
  const profile = {
    name,
    role,
    description: `Reserved ${kind} employee, created by the workspace rather than hired.`,
    category: RESERVED_CATEGORY,
    strengths: [],
    limitations: [],
    capabilities: [],
    model: 'gpt-5.6-terra' as const,
    color: '#5b6472',
    media: [],
    instructions: `You are ${name}, the ${kind} of this workspace. Work only within the ${kind} duties the platform gives you, from the records you are given, and record what you did.`,
    skills: [],
    persona,
  };
  const draftId = await ctx.db.insert('employeeDrafts', {
    createdBy: RESERVED_PUBLISHER,
    ...profile,
    updatedAt: now,
  });
  const versionId = await ctx.db.insert('employeeVersions', {
    draftId,
    version: 1,
    ...profile,
    publishedBy: RESERVED_PUBLISHER,
    publishedAt: now,
  });
  const employeeId = await ctx.db.insert('installations', {
    workspaceId,
    versionId,
    hiredBy: RESERVED_PUBLISHER,
    status: 'ready',
    name,
    kind,
    createdAt: now,
  });
  const [installation, version] = await Promise.all([ctx.db.get(employeeId), ctx.db.get(versionId)]);
  if (!installation || !version) throw new Error('Reserved employee was not created');
  return { installation, version };
}
