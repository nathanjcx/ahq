import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { cleanText, stableJson, type Ctx } from '../shared';
import { settingsFor } from './schedule';
import { requireFloor } from './tasks';

/** The profile fields a listing publishes: what a diff reports and what an upgrade can change. */
export const VERSION_FIELDS = [
  'name',
  'role',
  'description',
  'category',
  'strengths',
  'limitations',
  'capabilities',
  'model',
  'color',
  'media',
  'instructions',
  'skills',
  'persona',
] as const;
export type VersionField = (typeof VERSION_FIELDS)[number];
type Profile = Pick<Doc<'employeeVersions'>, VersionField>;

/** Field names that differ between two profiles, in the order the studio lists them. */
export function changedFields(before: Profile, after: Profile): VersionField[] {
  return VERSION_FIELDS.filter((field) => stableJson(before[field]) !== stableJson(after[field]));
}

/** A profile field as text, so a diff reads the same way for a string, a list, and an object. */
export function renderField(value: Profile[VersionField]): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value))
    return value.map((item) => (typeof item === 'string' ? item : stableJson(item))).join('\n');
  return stableJson(value);
}

export function listingForDraft(ctx: Ctx, draftId: Id<'employeeDrafts'>) {
  return ctx.db
    .query('listings')
    .withIndex('by_draft', (q) => q.eq('draftId', draftId))
    .unique();
}

/**
 * Marketplace usage count, kept as a counter because the alternative is scanning every task in the
 * deployment at list time. Called from `services/sessions:recordEvents` when a task completes.
 */
export async function recordCompletedTask(ctx: MutationCtx, employeeId: Id<'installations'>) {
  const installation = await ctx.db.get(employeeId);
  const listing = installation?.listingId ? await ctx.db.get(installation.listingId) : null;
  if (listing) await ctx.db.patch(listing._id, { completedTasks: listing.completedTasks + 1 });
}

/** `Ada`, `Ada 2`, `Ada 3`: the first free names from `base`, reserved in `taken` as they are used. */
export function instanceNames(base: string, taken: Set<string>, count: number): string[] {
  const names: string[] = [];
  for (let index = 1; names.length < count; index++) {
    const candidate = index === 1 ? base : `${base} ${index}`;
    if (taken.has(candidate)) continue;
    taken.add(candidate);
    names.push(candidate);
  }
  return names;
}

/** `Ada 2` is another `Ada`: numbering starts again from the stem when a name has to move. */
export function nameStem(name: string) {
  return name.replace(/ \d+$/, '');
}

export async function liveInstances(ctx: Ctx, workspaceId: Id<'workspaces'>) {
  const installations = await ctx.db
    .query('installations')
    .withIndex('by_workspace', (q) => q.eq('workspaceId', workspaceId))
    .collect();
  return installations.filter((installation) => installation.status !== 'retired');
}

/** Instance names already in use on one floor, where an absent floor is the lobby. */
export async function namesOnFloor(
  ctx: Ctx,
  workspaceId: Id<'workspaces'>,
  floorId: Id<'floors'> | undefined,
  exclude?: Id<'installations'>,
) {
  const instances = (await liveInstances(ctx, workspaceId)).filter(
    (installation) => installation.floorId === floorId && installation._id !== exclude,
  );
  const names = await Promise.all(
    instances.map(async (installation) => {
      if (installation.name) return installation.name;
      const version = await ctx.db.get(installation.versionId);
      return version?.name ?? '';
    }),
  );
  return new Set(names.filter(Boolean));
}

export async function addToFloor(ctx: MutationCtx, floor: Doc<'floors'>, employeeIds: Id<'installations'>[]) {
  const missing = employeeIds.filter((id) => !floor.employeeIds.includes(id));
  if (missing.length)
    await ctx.db.patch(floor._id, {
      employeeIds: [...floor.employeeIds, ...missing],
      updatedAt: Date.now(),
    });
}

export async function removeFromFloor(
  ctx: MutationCtx,
  floorId: Id<'floors'>,
  employeeId: Id<'installations'>,
) {
  const floor = await ctx.db.get(floorId);
  if (!floor?.employeeIds.includes(employeeId)) return;
  await ctx.db.patch(floorId, {
    employeeIds: floor.employeeIds.filter((id) => id !== employeeId),
    updatedAt: Date.now(),
  });
}

export async function requireInstance(
  ctx: Ctx,
  workspaceId: Id<'workspaces'>,
  employeeId: Id<'installations'>,
) {
  const installation = await ctx.db.get(employeeId);
  if (!installation || installation.workspaceId !== workspaceId) throw new Error('Employee not found');
  if (installation.status === 'retired') throw new Error('Employee is retired');
  return installation;
}

/**
 * Hires `count` instances of the listing's current version onto one floor, named apart from the
 * instances already there. The concurrency cap counts hired instances; the janitor, auditors, and
 * triage employees the workspace makes for itself are not hired and do not consume it.
 */
export async function createInstances(
  ctx: MutationCtx,
  workspace: Doc<'workspaces'>,
  listing: Doc<'listings'>,
  hiredBy: string,
  input: { floorId?: Id<'floors'>; count: number; name?: string },
) {
  const version = await ctx.db.get(listing.currentVersionId);
  if (!version || version.retiredAt) throw new Error('Employee version is unavailable');
  const settings = await settingsFor(ctx, workspace._id);
  const hired = (await liveInstances(ctx, workspace._id)).filter(
    (installation) => (installation.kind ?? 'worker') === 'worker',
  ).length;
  if (hired + input.count > settings.maxConcurrentInstances)
    throw new Error(
      `This workspace runs at most ${settings.maxConcurrentInstances} instances and already has ${hired}. Retire one or raise the limit in Settings.`,
    );
  const floor = input.floorId ? await requireFloor(ctx, workspace._id, input.floorId) : null;
  if (floor && floor.archivedAt !== undefined) throw new Error('Floor is archived');
  const base = input.name ? cleanText(input.name, 'Employee name', 120) : version.name;
  const names = instanceNames(base, await namesOnFloor(ctx, workspace._id, input.floorId), input.count);
  const now = Date.now();
  const employeeIds: Id<'installations'>[] = [];
  for (const name of names)
    employeeIds.push(
      await ctx.db.insert('installations', {
        workspaceId: workspace._id,
        versionId: version._id,
        listingId: listing._id,
        hiredBy,
        status: 'blocked',
        floorId: input.floorId,
        name,
        kind: 'worker',
        createdAt: now,
      }),
    );
  if (floor) await addToFloor(ctx, floor, employeeIds);
  await ctx.db.patch(listing._id, { hires: listing.hires + employeeIds.length });
  return employeeIds;
}
