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
  'needs_input',
  'completed',
  'failed',
  'cancelled',
  'uncertain',
  'waiting',
  'blocked',
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

/** `z.url()` accepts any scheme, including `javascript:`. Endpoints we redirect to or call do not. */
const httpsUrl = z
  .url()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password;
    } catch {
      return false;
    }
  }, 'Must be an HTTPS URL without embedded credentials');

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

// Workspace organizations, for the switcher and the create-workspace action.
export const organizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.enum(['admin', 'member']),
});
export const organizationsResponse = z.array(organizationSchema);
export const createOrganizationRequest = z.object({ name: z.string().trim().min(1).max(80) });

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
  authorizationUrl: httpsUrl.optional(),
  tokenUrl: httpsUrl.optional(),
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
// Triage. The generic alert endpoint is signed, not signed in: the body is the whole request.
export const alertRequest = z.object({
  source: z.enum(['github', 'webhook', 'email', 'manual']),
  fingerprint: z.string().min(1).max(300),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  title: z.string().min(1).max(300),
  detail: z.string().min(1).max(10_000),
  url: httpsUrl.optional(),
  floorIds: z.array(z.string().min(1).max(100)).max(20).optional(),
});
export const alertResponse = z.object({
  accepted: z.literal(true),
  alertId: z.string(),
  /** True when the fingerprint matched an alert that is already open. */
  duplicate: z.boolean(),
});
export const alertSecretRequest = z.object({ alertSecret: z.string().min(32).max(2000) });

// Notifications and browser push.
export const notificationSchema = z.object({
  id: z.string(),
  kind: z.enum(['triage', 'meeting', 'finding', 'general']),
  title: z.string(),
  text: z.string(),
  alertId: z.string().optional(),
  attempt: z.number(),
  sentAt: z.number(),
  acknowledgedAt: z.number().optional(),
});
export const notificationsResponse = z.array(notificationSchema);
export const acknowledgedResponse = z.object({ acknowledged: z.literal(true) });
export const pushSubscribeRequest = z.object({
  endpoint: httpsUrl,
  keys: z.object({ p256dh: z.string().min(1).max(300), auth: z.string().min(1).max(300) }),
});
export const pushUnsubscribeRequest = z.object({ endpoint: httpsUrl });
export const subscribedResponse = z.object({ subscribed: z.literal(true) });

export const savedResponse = z.object({ saved: z.literal(true) });
export const removedResponse = z.object({ removed: z.literal(true) });

export type ErrorResponse = z.infer<typeof errorResponse>;
export type ConnectRequest = z.infer<typeof connectRequest>;
export type ConnectResponse = z.infer<typeof connectResponse>;
export type RelaySecretResponse = z.infer<typeof relaySecretResponse>;
export type MembersResponse = z.infer<typeof membersResponse>;
export type OrganizationsResponse = z.infer<typeof organizationsResponse>;
export type CreateOrganizationRequest = z.infer<typeof createOrganizationRequest>;
export type AuditResponse = z.infer<typeof auditResponse>;
export type OAuthClientRequest = z.infer<typeof oauthClientRequest>;
export type RemoveOAuthClientRequest = z.infer<typeof removeOAuthClientRequest>;
export type InboxSecretRequest = z.infer<typeof inboxSecretRequest>;
export type ClearInboxSecretRequest = z.infer<typeof clearInboxSecretRequest>;
export type SavedResponse = z.infer<typeof savedResponse>;
export type RemovedResponse = z.infer<typeof removedResponse>;
export type AlertRequest = z.infer<typeof alertRequest>;
export type AlertResponse = z.infer<typeof alertResponse>;
export type AlertSecretRequest = z.infer<typeof alertSecretRequest>;
export type Notification = z.infer<typeof notificationSchema>;
export type NotificationsResponse = z.infer<typeof notificationsResponse>;
export type AcknowledgedResponse = z.infer<typeof acknowledgedResponse>;
export type PushSubscribeRequest = z.infer<typeof pushSubscribeRequest>;
export type PushUnsubscribeRequest = z.infer<typeof pushUnsubscribeRequest>;
export type SubscribedResponse = z.infer<typeof subscribedResponse>;
