import { z } from 'zod';
/**
 * The request and response shape of every web route, in one place. Routes parse requests with these
 * schemas and declare their responses `satisfies` the inferred type; the browser client parses the
 * responses back. The schemas are the contract both sides compile against.
 */

const providerId = z.enum(['linear', 'slack', 'github', 'google-workspace', 'canva']);
const taskStatus = z.enum([
  'queued',
  'running',
  'awaiting_approval',
  'completed',
  'failed',
  'cancelled',
  'uncertain',
]);
const correctionKind = z.enum(['supported', 'partial', 'manual', 'irreversible', 'unknown']);
const proposalStatus = z.enum([
  'pending',
  'approved',
  'rejected',
  'executing',
  'succeeded',
  'failed',
  'uncertain',
  'corrected',
]);
const memberRole = z.enum(['owner', 'admin', 'member']);

/** The error envelope every route uses for every failure. */
export const errorResponse = z.object({ error: z.string(), code: z.string().optional() });

// Integrations, connect.
export const connectRequest = z.object({
  provider: z.string(),
  serverUrls: z.array(z.string().max(2048)).min(1).max(10).optional(),
});
export const connectResponse = z.object({ authorizationUrl: z.string() });

// Integrations, relay secret. The same body answers reveal (GET) and rotate (POST).
export const relaySecretResponse = z.object({ url: z.string(), secret: z.string() });

// Workspace members.
export const memberSchema = z.object({
  subject: z.string(),
  name: z.string(),
  email: z.string().optional(),
  imageUrl: z.string().optional(),
  role: memberRole,
});
export const membersResponse = z.array(memberSchema);

// Audit timeline.
const transition = z.object({
  from: z.string().optional(),
  to: z.string(),
  actor: z.string(),
  at: z.number(),
  detail: z.string().optional(),
});
const auditEntry = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('event'),
    id: z.string(),
    at: z.number(),
    type: z.string(),
    text: z.string(),
    gap: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('message'),
    id: z.string(),
    at: z.number(),
    role: z.enum(['user', 'assistant', 'system']),
    text: z.string(),
    phase: z.string().optional(),
  }),
  z.object({
    kind: z.literal('tool_call'),
    id: z.string(),
    at: z.number(),
    operationId: z.string(),
    connectionId: z.string(),
    provider: providerId,
    tool: z.string(),
    outcome: z.enum(['started', 'succeeded', 'failed', 'denied']),
    reason: z.string().optional(),
    durationMs: z.number().optional(),
    arguments: z.unknown().optional(),
    result: z.unknown().optional(),
    resultSha256: z.string().optional(),
    proposalId: z.string().optional(),
  }),
  z.object({
    kind: z.literal('proposal'),
    id: z.string(),
    at: z.number(),
    tool: z.string(),
    provider: providerId,
    summary: z.string(),
    status: proposalStatus,
    correction: correctionKind,
    arguments: z.unknown(),
    beforeState: z.unknown().optional(),
    afterState: z.unknown().optional(),
    transitions: z.array(transition),
  }),
]);
export const auditResponse = z.object({
  task: z.object({
    id: z.string(),
    title: z.string(),
    employeeName: z.string(),
    status: taskStatus,
    createdAt: z.number(),
    createdByName: z.string(),
  }),
  entries: z.array(auditEntry),
  /** True when older entries were dropped to keep the response bounded. */
  truncated: z.boolean(),
});

// Administrator configuration. Secrets travel in, never out.
export const oauthClientRequest = z.object({
  provider: z.string(),
  serverUrl: z.string().max(2048).optional(),
  clientId: z.string().min(1).max(500),
  clientSecret: z.string().max(2000).optional(),
  scopes: z.string().max(2000).optional(),
  authorizationUrl: z.url().optional(),
  tokenUrl: z.url().optional(),
  tokenAuthMethod: z.enum(['client_secret_basic', 'client_secret_post', 'none']).optional(),
});
export const removeOAuthClientRequest = z.object({
  provider: z.string(),
  serverUrl: z.string().max(2048).optional(),
});
export const inboxSecretRequest = z.object({
  provider: z.string(),
  inboxSecret: z.string().min(1).max(2000),
});
export const clearInboxSecretRequest = z.object({ provider: z.string() });
export const savedResponse = z.object({ saved: z.literal(true) });
export const removedResponse = z.object({ removed: z.literal(true) });

export type ErrorResponse = z.infer<typeof errorResponse>;
export type ConnectRequest = z.infer<typeof connectRequest>;
export type ConnectResponse = z.infer<typeof connectResponse>;
export type RelaySecretResponse = z.infer<typeof relaySecretResponse>;
export type MembersResponse = z.infer<typeof membersResponse>;
export type AuditResponse = z.infer<typeof auditResponse>;
export type OAuthClientRequest = z.infer<typeof oauthClientRequest>;
export type RemoveOAuthClientRequest = z.infer<typeof removeOAuthClientRequest>;
export type InboxSecretRequest = z.infer<typeof inboxSecretRequest>;
export type ClearInboxSecretRequest = z.infer<typeof clearInboxSecretRequest>;
export type SavedResponse = z.infer<typeof savedResponse>;
export type RemovedResponse = z.infer<typeof removedResponse>;
