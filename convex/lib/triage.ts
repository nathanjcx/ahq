import { defaultWorkspaceSettings, type WorkspaceSettings } from '../../lib/contracts';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import type { Ctx } from '../shared';

export type EmployeeKind = NonNullable<Doc<'installations'>['kind']>;
/** Everything an attended-hours or rules decision needs, whether or not a settings row exists yet. */
export type Settings = WorkspaceSettings;

const DEFAULT_TIMEZONE = 'UTC';

export function settingsRow(ctx: Ctx, workspaceId: Id<'workspaces'>) {
  return ctx.db
    .query('workspaceSettings')
    .withIndex('by_workspace', (q) => q.eq('workspaceId', workspaceId))
    .unique();
}

/** Settings as the rest of the code reads them: the workspace's row, or the fixed defaults. */
export async function settingsFor(ctx: Ctx, workspaceId: Id<'workspaces'>): Promise<Settings> {
  const row = await settingsRow(ctx, workspaceId);
  if (!row) return { ...defaultWorkspaceSettings, timezone: DEFAULT_TIMEZONE, updatedAt: 0 };
  // The sealed alert secret is deliberately dropped here: it leaves Convex only through its own route.
  const {
    _id: _rowId,
    _creationTime: _createdAt,
    workspaceId: _workspaceId,
    alertSecretCiphertext: _secret,
    ...fields
  } = row;
  return fields;
}

/** The settings row, created from the defaults the first time a policy is written. */
export async function ensureSettings(ctx: MutationCtx, workspaceId: Id<'workspaces'>) {
  const existing = await settingsRow(ctx, workspaceId);
  if (existing) return existing;
  const id = await ctx.db.insert('workspaceSettings', {
    workspaceId,
    ...defaultWorkspaceSettings,
    timezone: DEFAULT_TIMEZONE,
    updatedAt: Date.now(),
  });
  const created = await ctx.db.get(id);
  if (!created) throw new Error('Workspace settings not found');
  return created;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * Local weekday and hour in the workspace's timezone. A minimal stand-in for `lib/time.ts`, which
 * the schedule workstream owns; reconcile when that module lands.
 */
export function localTime(now: number, timezone: string) {
  const format = (zone: string) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      weekday: 'short',
      hour: 'numeric',
      hour12: false,
    }).formatToParts(new Date(now));
  let parts;
  try {
    parts = format(timezone);
  } catch {
    parts = format(DEFAULT_TIMEZONE);
  }
  const weekday = parts.find((part) => part.type === 'weekday')?.value ?? 'Sun';
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0') % 24;
  return { weekday: WEEKDAYS[weekday] ?? 0, hour };
}

/** Attended hours are the window a person is expected to answer a notification in. */
export function isAttendedTime(now: number, settings: Settings) {
  const { weekday, hour } = localTime(now, settings.timezone);
  if (!settings.workingDays.includes(weekday)) return false;
  return hour >= settings.attendedStartHour && hour < settings.attendedEndHour;
}

/** A rule matches a GitHub label or any keyword in the delivery, case-insensitively. */
export function matchesTriageRules(rules: string[], haystacks: string[]) {
  const text = haystacks.join('\n').toLowerCase();
  return rules
    .map((rule) => rule.trim().toLowerCase())
    .filter(Boolean)
    .find((rule) => text.includes(rule));
}

/**
 * The workspace's own instance of a reserved employee kind, created once. A private copy of the
 * janitor's `ensureReservedInstance`; reconcile with `convex/lib/audit.ts` when that module lands.
 */
export async function ensureReservedInstance(
  ctx: MutationCtx,
  workspace: Doc<'workspaces'>,
  kind: EmployeeKind,
  name: string,
) {
  const installations = await ctx.db
    .query('installations')
    .withIndex('by_workspace', (q) => q.eq('workspaceId', workspace._id))
    .collect();
  const existing = installations.find((row) => row.kind === kind);
  if (existing) {
    const version = await ctx.db.get(existing.versionId);
    if (version) return { installation: existing, version };
  }
  const role = `${kind[0].toUpperCase()}${kind.slice(1)}`;
  const now = Date.now();
  const draftId = await ctx.db.insert('employeeDrafts', {
    createdBy: 'system',
    name,
    role,
    description: `Reserved ${kind} employee, created by the workspace rather than hired.`,
    category: 'Reserved',
    strengths: [],
    limitations: [],
    capabilities: [],
    model: 'gpt-5.6-terra',
    color: '#b4661f',
    media: [],
    instructions: `You are this workspace's ${kind}. Work only within the ${kind} duties the platform gives you, and record what you did.`,
    skills: [],
    updatedAt: now,
  });
  const draft = await ctx.db.get(draftId);
  if (!draft) throw new Error('Reserved employee draft not found');
  const versionId = await ctx.db.insert('employeeVersions', {
    draftId,
    version: 1,
    name: draft.name,
    role: draft.role,
    description: draft.description,
    category: draft.category,
    strengths: draft.strengths,
    limitations: draft.limitations,
    capabilities: draft.capabilities,
    model: draft.model,
    color: draft.color,
    media: draft.media,
    instructions: draft.instructions,
    skills: draft.skills,
    publishedBy: 'system',
    publishedAt: now,
  });
  const version = await ctx.db.get(versionId);
  if (!version) throw new Error('Reserved employee version not found');
  const employeeId = await ctx.db.insert('installations', {
    workspaceId: workspace._id,
    versionId,
    hiredBy: 'system',
    status: 'ready',
    name,
    kind,
    createdAt: now,
  });
  const installation = await ctx.db.get(employeeId);
  if (!installation) throw new Error('Reserved employee not found');
  return { installation, version };
}

/**
 * The reserved Triage floor with its triage instance staffed on it. Created once per workspace and
 * reused by every intake path, so an alert always has somewhere to land.
 */
export async function ensureTriageStaff(ctx: MutationCtx, workspace: Doc<'workspaces'>, createdBy: string) {
  const floors = await ctx.db
    .query('floors')
    .withIndex('by_workspace', (q) => q.eq('workspaceId', workspace._id))
    .collect();
  const now = Date.now();
  let floor = floors.find((row) => row.reserved === 'triage');
  if (!floor) {
    const floorId = await ctx.db.insert('floors', {
      workspaceId: workspace._id,
      createdBy,
      name: 'Triage',
      brief: 'Incidents preempt working hours here: reproduce, fix, post the post-mortem, close.',
      employeeIds: [],
      reserved: 'triage',
      createdAt: now,
      updatedAt: now,
    });
    const created = await ctx.db.get(floorId);
    if (!created) throw new Error('Floor not found');
    floor = created;
  }
  const { installation, version } = await ensureReservedInstance(ctx, workspace, 'triage', 'Triage');
  if (installation.floorId !== floor._id) await ctx.db.patch(installation._id, { floorId: floor._id });
  if (!floor.employeeIds.includes(installation._id)) {
    const employeeIds = [...floor.employeeIds, installation._id];
    await ctx.db.patch(floor._id, { employeeIds, updatedAt: now });
    floor = { ...floor, employeeIds };
  }
  return { floor, installation, version };
}
