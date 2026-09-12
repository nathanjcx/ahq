import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export const provider = v.union(
  v.literal('linear'),
  v.literal('slack'),
  v.literal('github'),
  v.literal('google-workspace'),
  v.literal('canva'),
);
export const model = v.union(
  v.literal('gpt-5.6-luna'),
  v.literal('gpt-5.6-terra'),
  v.literal('gpt-5.6-sol'),
  v.literal('gpt-6-astra'),
);
export const taskStatus = v.union(
  v.literal('queued'),
  v.literal('running'),
  v.literal('awaiting_approval'),
  v.literal('completed'),
  v.literal('failed'),
  v.literal('cancelled'),
  v.literal('uncertain'),
);
export const correctionKind = v.union(
  v.literal('supported'),
  v.literal('partial'),
  v.literal('manual'),
  v.literal('irreversible'),
  v.literal('unknown'),
);
export const toolMode = v.union(v.literal('read'), v.literal('write'), v.literal('blocked'));
export const connectionVisibility = v.union(
  v.literal('private'),
  v.literal('members'),
  v.literal('workspace'),
);
export const taskVisibility = v.union(v.literal('private'), v.literal('workspace'));
export const tokenUsage = v.object({ input: v.number(), cached: v.number(), output: v.number() });
export const correctionDescriptor = v.object({
  readTool: v.string(),
  idArgument: v.string(),
  versionField: v.string(),
  expectedVersionArgument: v.string(),
  fields: v.array(v.string()),
});
const capability = v.object({ provider, tools: v.array(v.string()), optional: v.boolean() });
const media = v.object({
  url: v.string(),
  type: v.union(v.literal('image'), v.literal('video')),
  alt: v.string(),
});
const skill = v.object({ name: v.string(), version: v.string(), sha256: v.string(), content: v.string() });

export default defineSchema({
  // Operational configuration. Edited by platform administrators, read by every service.
  providerConfigs: defineTable({
    provider,
    enabledUrls: v.array(v.string()),
    oauthClients: v.array(
      v.object({
        serverUrl: v.optional(v.string()),
        clientId: v.string(),
        clientSecretCiphertext: v.optional(v.string()),
        scopes: v.optional(v.string()),
        authorizationUrl: v.optional(v.string()),
        tokenUrl: v.optional(v.string()),
        tokenAuthMethod: v.optional(
          v.union(v.literal('client_secret_basic'), v.literal('client_secret_post'), v.literal('none')),
        ),
      }),
    ),
    inboxSecretCiphertext: v.optional(v.string()),
    updatedBy: v.string(),
    updatedAt: v.number(),
  }).index('by_provider', ['provider']),
  registryTools: defineTable({
    provider,
    name: v.string(),
    description: v.string(),
    mode: toolMode,
    resourceArgument: v.optional(v.string()),
    correction: v.optional(correctionDescriptor),
    annotations: v.optional(
      v.object({
        readOnlyHint: v.optional(v.boolean()),
        destructiveHint: v.optional(v.boolean()),
        idempotentHint: v.optional(v.boolean()),
      }),
    ),
    updatedBy: v.string(),
    updatedAt: v.number(),
  })
    .index('by_provider', ['provider'])
    .index('by_provider_name', ['provider', 'name']),

  workspaces: defineTable({
    authKey: v.string(),
    name: v.string(),
    monthlyTokenCap: v.number(),
    nextSequence: v.number(),
    createdAt: v.number(),
  }).index('by_auth_key', ['authKey']),
  usage: defineTable({
    workspaceId: v.id('workspaces'),
    period: v.string(),
    model,
    input: v.number(),
    cached: v.number(),
    output: v.number(),
    tasks: v.number(),
    updatedAt: v.number(),
  }).index('by_workspace_period_model', ['workspaceId', 'period', 'model']),
  usageReports: defineTable({
    workspaceId: v.id('workspaces'),
    taskId: v.id('tasks'),
    externalId: v.string(),
    model,
    input: v.number(),
    cached: v.number(),
    output: v.number(),
    period: v.string(),
    createdAt: v.number(),
  }).index('by_task_external', ['taskId', 'externalId']),

  employeeDrafts: defineTable({
    createdBy: v.string(),
    name: v.string(),
    role: v.string(),
    description: v.string(),
    category: v.string(),
    strengths: v.array(v.string()),
    limitations: v.array(v.string()),
    capabilities: v.array(capability),
    model,
    color: v.string(),
    media: v.array(media),
    instructions: v.string(),
    skills: v.array(skill),
    updatedAt: v.number(),
  }).index('by_updated', ['updatedAt']),
  employeeVersions: defineTable({
    draftId: v.id('employeeDrafts'),
    version: v.number(),
    name: v.string(),
    role: v.string(),
    description: v.string(),
    category: v.string(),
    strengths: v.array(v.string()),
    limitations: v.array(v.string()),
    capabilities: v.array(capability),
    model,
    color: v.string(),
    media: v.array(media),
    instructions: v.string(),
    skills: v.array(skill),
    publishedBy: v.string(),
    publishedAt: v.number(),
    retiredAt: v.optional(v.number()),
  })
    .index('by_published', ['publishedAt'])
    .index('by_draft', ['draftId']),
  installations: defineTable({
    workspaceId: v.id('workspaces'),
    versionId: v.id('employeeVersions'),
    hiredBy: v.string(),
    status: v.union(v.literal('ready'), v.literal('blocked'), v.literal('retired')),
    createdAt: v.number(),
  })
    .index('by_workspace', ['workspaceId'])
    .index('by_workspace_version', ['workspaceId', 'versionId']),

  projects: defineTable({
    workspaceId: v.id('workspaces'),
    createdBy: v.string(),
    name: v.string(),
    brief: v.string(),
    employeeIds: v.array(v.id('installations')),
    archivedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_workspace', ['workspaceId']),
  projectPosts: defineTable({
    workspaceId: v.id('workspaces'),
    projectId: v.id('projects'),
    kind: v.union(v.literal('note'), v.literal('system'), v.literal('handoff')),
    authorSubject: v.optional(v.string()),
    authorName: v.string(),
    text: v.string(),
    taskId: v.optional(v.id('tasks')),
    handoff: v.optional(
      v.object({
        toEmployeeId: v.id('installations'),
        toEmployeeName: v.string(),
        brief: v.string(),
        status: v.union(v.literal('pending'), v.literal('accepted'), v.literal('declined')),
        taskId: v.optional(v.id('tasks')),
        decidedBy: v.optional(v.string()),
        decidedAt: v.optional(v.number()),
      }),
    ),
    createdAt: v.number(),
  })
    .index('by_project', ['projectId', 'createdAt'])
    .index('by_project_kind', ['projectId', 'kind']),

  connections: defineTable({
    workspaceId: v.id('workspaces'),
    ownerSubject: v.string(),
    ownerName: v.string(),
    visibility: connectionVisibility,
    visibleToSubjects: v.array(v.string()),
    provider,
    name: v.string(),
    account: v.string(),
    status: v.union(
      v.literal('connected'),
      v.literal('disconnected'),
      v.literal('degraded'),
      v.literal('revoked'),
    ),
    tools: v.array(v.string()),
    /** MCP annotations reported at discovery, kept as administrator hints only. */
    toolAnnotations: v.optional(
      v.array(
        v.object({
          name: v.string(),
          readOnlyHint: v.optional(v.boolean()),
          destructiveHint: v.optional(v.boolean()),
          idempotentHint: v.optional(v.boolean()),
        }),
      ),
    ),
    allowedTools: v.array(v.string()),
    resourceScope: v.string(),
    inboxResources: v.array(v.string()),
    inboxMode: v.union(v.literal('push'), v.literal('on-demand'), v.literal('unsupported')),
    inboxRelaySecretCiphertext: v.optional(v.string()),
    serverUrl: v.string(),
    credentialCiphertext: v.string(),
    credentialKeyVersion: v.string(),
    lastCheckedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    cursor: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_workspace', ['workspaceId'])
    .index('by_owner', ['ownerSubject'])
    .index('by_provider_status', ['provider', 'status']),

  tasks: defineTable({
    workspaceId: v.id('workspaces'),
    projectId: v.optional(v.id('projects')),
    projectContext: v.optional(v.object({ name: v.string(), brief: v.string() })),
    sourceTaskId: v.optional(v.id('tasks')),
    createdBy: v.string(),
    createdByName: v.string(),
    visibility: taskVisibility,
    employeeId: v.id('installations'),
    versionId: v.id('employeeVersions'),
    employeeName: v.string(),
    title: v.string(),
    prompt: v.string(),
    status: taskStatus,
    model,
    createdAt: v.number(),
    updatedAt: v.number(),
    sessionId: v.optional(v.string()),
    error: v.optional(v.string()),
    runToken: v.string(),
    streamOwner: v.optional(v.string()),
    streamLeaseExpiresAt: v.optional(v.number()),
    sourceProposalId: v.optional(v.id('proposals')),
    usage: v.optional(tokenUsage),
  })
    .index('by_workspace', ['workspaceId'])
    .index('by_project', ['projectId'])
    .index('by_run_token', ['runToken'])
    .index('by_status', ['status'])
    .index('by_source_proposal', ['sourceProposalId']),
  messages: defineTable({
    workspaceId: v.id('workspaces'),
    taskId: v.id('tasks'),
    externalId: v.string(),
    role: v.union(v.literal('user'), v.literal('assistant'), v.literal('system')),
    text: v.string(),
    createdAt: v.number(),
    phase: v.optional(v.string()),
    completed: v.optional(v.boolean()),
  })
    .index('by_task', ['taskId'])
    .index('by_task_external', ['taskId', 'externalId']),
  events: defineTable({
    workspaceId: v.id('workspaces'),
    taskId: v.id('tasks'),
    externalId: v.string(),
    sequence: v.number(),
    type: v.string(),
    text: v.string(),
    createdAt: v.number(),
    employeeName: v.optional(v.string()),
    gap: v.optional(v.boolean()),
  })
    .index('by_workspace_sequence', ['workspaceId', 'sequence'])
    .index('by_task', ['taskId'])
    .index('by_task_external', ['taskId', 'externalId']),
  proposals: defineTable({
    workspaceId: v.id('workspaces'),
    taskId: v.id('tasks'),
    connectionId: v.id('connections'),
    employeeName: v.string(),
    provider,
    tool: v.string(),
    arguments: v.string(),
    argumentsHash: v.string(),
    dedupeKey: v.string(),
    summary: v.string(),
    status: v.union(
      v.literal('pending'),
      v.literal('approved'),
      v.literal('rejected'),
      v.literal('executing'),
      v.literal('succeeded'),
      v.literal('failed'),
      v.literal('uncertain'),
      v.literal('corrected'),
    ),
    correction: correctionKind,
    correctionReason: v.string(),
    beforeState: v.optional(v.string()),
    afterState: v.optional(v.string()),
    result: v.optional(v.string()),
    originalActionId: v.optional(v.id('proposals')),
    proposedBy: v.string(),
    approvedBy: v.optional(v.string()),
    approvedByName: v.optional(v.string()),
    approvedAt: v.optional(v.number()),
    providerRequestId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_workspace', ['workspaceId'])
    .index('by_dedupe', ['dedupeKey'])
    .index('by_original', ['originalActionId'])
    .index('by_task_status', ['taskId', 'status']),
  actionTransitions: defineTable({
    workspaceId: v.id('workspaces'),
    proposalId: v.id('proposals'),
    from: v.optional(v.string()),
    to: v.string(),
    actor: v.string(),
    at: v.number(),
    detail: v.optional(v.string()),
  }).index('by_proposal', ['proposalId']),
  jobs: defineTable({
    workspaceId: v.id('workspaces'),
    taskId: v.id('tasks'),
    proposalId: v.optional(v.id('proposals')),
    uniqueKey: v.string(),
    kind: v.string(),
    payload: v.string(),
    state: v.union(v.literal('queued'), v.literal('leased'), v.literal('completed'), v.literal('failed')),
    attempts: v.number(),
    availableAt: v.number(),
    leaseOwner: v.optional(v.string()),
    leaseToken: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    result: v.optional(v.string()),
    error: v.optional(v.string()),
    completionTokenHash: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_unique_key', ['uniqueKey'])
    .index('by_state_available', ['state', 'availableAt'])
    .index('by_state_kind_available', ['state', 'kind', 'availableAt'])
    .index('by_state_lease_expiration', ['state', 'leaseExpiresAt'])
    .index('by_task_state', ['taskId', 'state'])
    .index('by_task_kind_created', ['taskId', 'kind', 'createdAt']),
  inbox: defineTable({
    workspaceId: v.id('workspaces'),
    connectionId: v.id('connections'),
    externalId: v.string(),
    provider,
    title: v.string(),
    preview: v.string(),
    sourceUrl: v.optional(v.string()),
    createdAt: v.number(),
    status: v.union(v.literal('unread'), v.literal('read'), v.literal('assigned')),
    taskId: v.optional(v.id('tasks')),
  })
    .index('by_connection_external', ['connectionId', 'externalId'])
    .index('by_workspace', ['workspaceId']),
  artifacts: defineTable({
    workspaceId: v.id('workspaces'),
    taskId: v.id('tasks'),
    name: v.string(),
    mediaType: v.string(),
    size: v.number(),
    storageKey: v.string(),
    sha256: v.string(),
    createdAt: v.number(),
  })
    .index('by_task', ['taskId'])
    .index('by_workspace', ['workspaceId']),
  toolCalls: defineTable({
    workspaceId: v.id('workspaces'),
    taskId: v.id('tasks'),
    connectionId: v.id('connections'),
    operationId: v.string(),
    proposalId: v.optional(v.id('proposals')),
    leaseTokenHash: v.optional(v.string()),
    outcome: v.union(v.literal('started'), v.literal('succeeded'), v.literal('failed'), v.literal('denied')),
    reason: v.optional(v.string()),
    durationMs: v.optional(v.number()),
    tool: v.string(),
    argumentsCiphertext: v.string(),
    resultCiphertext: v.optional(v.string()),
    sha256: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_task_operation_outcome', ['taskId', 'operationId', 'outcome'])
    .index('by_task', ['taskId']),
  workerSignals: defineTable({ name: v.string(), revision: v.number(), updatedAt: v.number() }).index(
    'by_name',
    ['name'],
  ),
});
