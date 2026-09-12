import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc } from './_generated/dataModel';

export type Ctx = QueryCtx | MutationCtx;
export type Actor = { subject: string; orgId?: string; orgRole?: string };
export type WorkspaceRole = 'owner' | 'admin' | 'member';

export function cleanText(value: string, field: string, max: number) {
  const text = value.trim();
  if (!text) throw new Error(`${field} is required`);
  if (text.length > max) throw new Error(`${field} is too long`);
  return text;
}

export function serviceSecretMatches(actual: string) {
  const expected = process.env.AHQ_SERVICE_SECRET;
  if (!expected || !actual) return false;
  const length = Math.max(actual.length, expected.length);
  let difference = actual.length ^ expected.length;
  for (let index = 0; index < length; index++) {
    difference |= (actual.charCodeAt(index) || 0) ^ (expected.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export function requireService(secret: string) {
  if (!serviceSecretMatches(secret)) throw new Error('Unauthorized service request');
}

export async function identity(ctx: Ctx): Promise<Actor> {
  const value = await ctx.auth.getUserIdentity();
  if (!value) throw new Error('Authentication required');
  const claims = value as Record<string, unknown>;
  const organization =
    claims.o && typeof claims.o === 'object' && !Array.isArray(claims.o)
      ? (claims.o as Record<string, unknown>)
      : undefined;
  const orgId =
    typeof organization?.id === 'string'
      ? organization.id
      : typeof claims.org_id === 'string'
      ? claims.org_id
      : typeof claims.orgId === 'string'
        ? claims.orgId
        : undefined;
  const orgRole =
    typeof organization?.rol === 'string'
      ? organization.rol
      : typeof claims.org_role === 'string'
      ? claims.org_role
      : typeof claims.orgRole === 'string'
        ? claims.orgRole
        : undefined;
  return { subject: value.subject, orgId, orgRole };
}

export function authKey(subject: string, orgId?: string) {
  return orgId ? `org:${orgId}` : `user:${subject}`;
}

export function clerkRole(orgId: string | undefined, orgRole: string | undefined): WorkspaceRole {
  if (!orgId) return 'owner';
  return orgRole === 'org:admin' || orgRole === 'admin' ? 'admin' : 'member';
}

export async function workspaceForIdentity(
  ctx: Ctx,
  actor: Actor,
): Promise<{ workspace: Doc<'workspaces'>; role: WorkspaceRole } | null> {
  const workspace = await ctx.db
    .query('workspaces')
    .withIndex('by_auth_key', (q) => q.eq('authKey', authKey(actor.subject, actor.orgId)))
    .unique();
  if (!workspace) return null;
  const role = clerkRole(actor.orgId, actor.orgRole);
  return { workspace, role };
}

export async function requireWorkspace(
  ctx: Ctx,
): Promise<{ workspace: Doc<'workspaces'>; role: WorkspaceRole; actor: Actor }> {
  const actor = await identity(ctx);
  const found = await workspaceForIdentity(ctx, actor);
  if (!found) throw new Error('Create a workspace first');
  return { ...found, actor };
}

export function isPlatformAdmin(subject: string) {
  const ids = (process.env.PLATFORM_ADMIN_USER_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  return ids.includes(subject);
}

export async function requirePlatformAdmin(ctx: Ctx) {
  const actor = await identity(ctx);
  if (!isPlatformAdmin(actor.subject)) throw new Error('Platform administrator access required');
  return actor;
}

export function canSeeConnection(connection: Doc<'connections'>, subject: string, role: string) {
  void role;
  return connection.ownerSubject === subject || connection.visibleToSubjects.includes(subject);
}

export function randomToken() {
  return crypto.randomUUID();
}

export async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function visibleTo(
  item: { ownerSubject: string; visibleToSubjects: string[] },
  subject: string,
  role: string,
) {
  void role;
  return item.ownerSubject === subject || item.visibleToSubjects.includes(subject);
}
