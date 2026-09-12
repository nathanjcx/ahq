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
  v.literal('waiting'),
  v.literal('blocked'),
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
export const employeeKind = v.union(
  v.literal('worker'),
  v.literal('janitor'),
  v.literal('auditor'),
  v.literal('triage'),
);
export const cadence = v.union(v.literal('once'), v.literal('daily'));
export const memoryScope = v.union(
  v.literal('task'),
  v.literal('agent'),
  v.literal('floor'),
  v.literal('project'),
  v.literal('workspace'),
);
export const memoryKind = v.union(
  v.literal('fact'),
  v.literal('decision'),
  v.literal('preference'),
  v.literal('procedure'),
  v.literal('glossary'),
  v.literal('status'),
);
export const memoryStatus = v.union(
  v.literal('proposed'),
  v.literal('active'),
  v.literal('contested'),
  v.literal('archived'),
);
export const memoryAuthor = v.union(v.literal('agent'), v.literal('person'), v.literal('janitor'));
export const channelKind = v.union(
  v.literal('floor'),
  v.literal('project'),
  v.literal('workspace'),
  v.literal('triage'),
  v.literal('audit'),
);
export const postKind = v.union(
  v.literal('note'),
  v.literal('report'),
  v.literal('feedback'),
  v.literal('alert'),
  v.literal('finding'),
  v.literal('decision'),
  v.literal('handoff'),
  v.literal('system'),
);
export const calendarKind = v.union(
  v.literal('deadline'),
  v.literal('meeting'),
  v.literal('audit'),
  v.literal('shift'),
);
export const severity = v.union(
  v.literal('low'),
  v.literal('medium'),
  v.literal('high'),
  v.literal('critical'),
);
export const overnightPolicy = v.union(v.literal('off'), v.literal('audits_only'), v.literal('cheap'));
export const hiringPolicy = v.union(v.literal('anyone'), v.literal('admins'), v.literal('approval'));
export const attendee = v.object({
  kind: v.union(v.literal('employee'), v.literal('person')),
  id: v.string(),
  name: v.string(),
});
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
export const persona = v.object({
  voice: v.string(),
  traits: v.array(v.string()),
  catchphrase: v.optional(v.string()),
});

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
    persona: v.optional(persona),
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
    persona: v.optional(persona),
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
    /** One instance lives on one floor; undefined means the lobby. */
    floorId: v.optional(v.id('floors')),
    /** Instance name; defaults to the version name, made unique per floor when hiring a count. */
    name: v.optional(v.string()),
    kind: v.optional(employeeKind),
    overnightModel: v.optional(model),
    createdAt: v.number(),
  })
    .index('by_workspace', ['workspaceId'])
    .index('by_workspace_version', ['workspaceId', 'versionId'])
    .index('by_floor', ['floorId']),

  floors: defineTable({
    workspaceId: v.id('workspaces'),
    createdBy: v.string(),
    name: v.string(),
    brief: v.string(),
    employeeIds: v.array(v.id('installations')),
    reserved: v.optional(v.union(v.literal('lobby'), v.literal('triage'))),
    archivedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_workspace', ['workspaceId']),
  projects: defineTable({
    workspaceId: v.id('workspaces'),
    createdBy: v.string(),
    createdByName: v.string(),
    name: v.string(),
    brief: v.string(),
    floorIds: v.array(v.id('floors')),
    status: v.union(v.literal('planning'), v.literal('active'), v.literal('done'), v.literal('archived')),
    /** The planner's latest proposal, kept until a person confirms or discards it. */
    proposal: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_workspace', ['workspaceId']),
  milestones: defineTable({
    workspaceId: v.id('workspaces'),
    projectId: v.id('projects'),
    order: v.number(),
    title: v.string(),
    description: v.string(),
    deadlineAt: v.optional(v.number()),
    dependsOn: v.array(v.id('milestones')),
    status: v.union(v.literal('planned'), v.literal('active'), v.literal('done')),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_project', ['projectId', 'order']),
  floorPosts: defineTable({
    workspaceId: v.id('workspaces'),
    floorId: v.id('floors'),
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
    .index('by_floor', ['floorId', 'createdAt'])
    .index('by_floor_kind', ['floorId', 'kind']),

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
    floorId: v.optional(v.id('floors')),
    floorContext: v.optional(v.object({ name: v.string(), brief: v.string() })),
    projectId: v.optional(v.id('projects')),
    milestoneId: v.optional(v.id('milestones')),
    cadence: v.optional(cadence),
    deadlineAt: v.optional(v.number()),
    dependsOn: v.optional(v.array(v.id('tasks'))),
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
    .index('by_floor', ['floorId'])
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
  shifts: defineTable({
    workspaceId: v.id('workspaces'),
    taskId: v.id('tasks'),
    employeeId: v.id('installations'),
    date: v.string(),
    model,
    kind: v.union(v.literal('work'), v.literal('review'), v.literal('prep'), v.literal('wrapup')),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    reportId: v.optional(v.id('reports')),
  })
    .index('by_task_date', ['taskId', 'date'])
    .index('by_workspace_date', ['workspaceId', 'date']),
  reports: defineTable({
    workspaceId: v.id('workspaces'),
    taskId: v.id('tasks'),
    employeeId: v.id('installations'),
    shiftId: v.optional(v.id('shifts')),
    done: v.array(v.string()),
    inProgress: v.array(v.string()),
    blockedOn: v.array(v.string()),
    next: v.array(v.string()),
    risks: v.array(v.string()),
    deadlineConfidence: v.optional(v.number()),
    inferred: v.boolean(),
    createdAt: v.number(),
  })
    .index('by_task', ['taskId', 'createdAt'])
    .index('by_employee', ['employeeId', 'createdAt']),
  taskSummaries: defineTable({
    workspaceId: v.id('workspaces'),
    taskId: v.id('tasks'),
    /** Copied from the task so working memory can read a floor's recent summaries in one query. */
    floorId: v.optional(v.id('floors')),
    outcome: v.string(),
    decisions: v.array(v.string()),
    openQuestions: v.array(v.string()),
    artifactIds: v.array(v.id('artifacts')),
    text: v.string(),
    inferred: v.boolean(),
    createdAt: v.number(),
  })
    .index('by_task', ['taskId'])
    .index('by_floor', ['floorId', 'createdAt']),
  memories: defineTable({
    workspaceId: v.id('workspaces'),
    scope: memoryScope,
    scopeId: v.string(),
    kind: memoryKind,
    text: v.string(),
    tags: v.array(v.string()),
    sourceTaskId: v.optional(v.id('tasks')),
    author: memoryAuthor,
    authorName: v.string(),
    confidence: v.number(),
    status: memoryStatus,
    /** Set on an archived entry: the entry that replaced it, so a chain reads forward in time. */
    supersedesId: v.optional(v.id('memories')),
    /** Set on a promoted workspace copy: the scoped entry it was promoted from. */
    sourceMemoryId: v.optional(v.id('memories')),
    contestReason: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    lastUsedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_scope_status', ['workspaceId', 'scope', 'scopeId', 'status'])
    .index('by_workspace_status', ['workspaceId', 'status']),
  channels: defineTable({
    workspaceId: v.id('workspaces'),
    kind: channelKind,
    /** Floor id, project id, or empty for workspace, triage, and audit channels. */
    scopeId: v.string(),
    name: v.string(),
    createdAt: v.number(),
  }).index('by_workspace_kind_scope', ['workspaceId', 'kind', 'scopeId']),
  posts: defineTable({
    workspaceId: v.id('workspaces'),
    channelId: v.id('channels'),
    kind: postKind,
    authorSubject: v.optional(v.string()),
    authorEmployeeId: v.optional(v.id('installations')),
    authorName: v.string(),
    text: v.string(),
    taskId: v.optional(v.id('tasks')),
    /** Employee a note is addressed to; accepting turns it into a task. */
    toEmployeeId: v.optional(v.id('installations')),
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
    .index('by_channel', ['channelId', 'createdAt'])
    .index('by_employee', ['authorEmployeeId', 'createdAt']),
  calendarEntries: defineTable({
    workspaceId: v.id('workspaces'),
    kind: calendarKind,
    title: v.string(),
    startsAt: v.number(),
    endsAt: v.number(),
    projectId: v.optional(v.id('projects')),
    floorId: v.optional(v.id('floors')),
    taskId: v.optional(v.id('tasks')),
    attendees: v.array(attendee),
    agenda: v.array(v.string()),
    purpose: v.optional(v.string()),
    status: v.union(v.literal('scheduled'), v.literal('live'), v.literal('done'), v.literal('cancelled')),
    createdBy: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_workspace_start', ['workspaceId', 'startsAt'])
    .index('by_task', ['taskId']),
  meetings: defineTable({
    workspaceId: v.id('workspaces'),
    calendarEntryId: v.id('calendarEntries'),
    status: v.union(
      v.literal('preparing'),
      v.literal('ready'),
      v.literal('live'),
      v.literal('closing'),
      v.literal('closed'),
    ),
    openedBy: v.optional(v.string()),
    openedAt: v.optional(v.number()),
    closedAt: v.optional(v.number()),
    usage: v.optional(tokenUsage),
    createdAt: v.number(),
  }).index('by_entry', ['calendarEntryId']),
  meetingTurns: defineTable({
    workspaceId: v.id('workspaces'),
    meetingId: v.id('meetings'),
    kind: v.union(v.literal('report'), v.literal('question'), v.literal('answer'), v.literal('outcome')),
    authorSubject: v.optional(v.string()),
    employeeId: v.optional(v.id('installations')),
    authorName: v.string(),
    /** For questions: the employees addressed; empty means everyone. */
    addressedTo: v.optional(v.array(v.id('installations'))),
    inReplyTo: v.optional(v.id('meetingTurns')),
    text: v.string(),
    /** For outcomes: the proposed follow-up, confirmed by a person. */
    outcome: v.optional(
      v.object({
        kind: v.union(v.literal('task'), v.literal('deadline'), v.literal('meeting'), v.literal('note')),
        payload: v.string(),
        status: v.union(v.literal('proposed'), v.literal('confirmed'), v.literal('dismissed')),
      }),
    ),
    createdAt: v.number(),
  }).index('by_meeting', ['meetingId', 'createdAt']),
  auditFindings: defineTable({
    workspaceId: v.id('workspaces'),
    employeeId: v.id('installations'),
    taskId: v.optional(v.id('tasks')),
    auditDate: v.string(),
    severity,
    claim: v.string(),
    evidence: v.string(),
    requiredAction: v.string(),
    status: v.union(v.literal('open'), v.literal('addressed'), v.literal('verified'), v.literal('escalated')),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_employee_status', ['employeeId', 'status'])
    .index('by_workspace_date', ['workspaceId', 'auditDate']),
  alerts: defineTable({
    workspaceId: v.id('workspaces'),
    source: v.union(v.literal('github'), v.literal('webhook'), v.literal('email'), v.literal('manual')),
    fingerprint: v.string(),
    severity,
    title: v.string(),
    detail: v.string(),
    url: v.optional(v.string()),
    status: v.union(
      v.literal('open'),
      v.literal('triaging'),
      v.literal('fixed'),
      v.literal('closed'),
      v.literal('dismissed'),
    ),
    triageTaskId: v.optional(v.id('tasks')),
    affectedFloorIds: v.array(v.id('floors')),
    occurrences: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_workspace_fingerprint', ['workspaceId', 'fingerprint'])
    .index('by_workspace_status', ['workspaceId', 'status']),
  notifications: defineTable({
    workspaceId: v.id('workspaces'),
    subject: v.string(),
    kind: v.union(v.literal('triage'), v.literal('meeting'), v.literal('finding'), v.literal('general')),
    title: v.string(),
    text: v.string(),
    alertId: v.optional(v.id('alerts')),
    channels: v.array(v.string()),
    attempt: v.number(),
    sentAt: v.number(),
    deliveredAt: v.optional(v.number()),
    acknowledgedAt: v.optional(v.number()),
  })
    .index('by_subject', ['subject', 'sentAt'])
    .index('by_alert', ['alertId']),
  pushSubscriptions: defineTable({
    workspaceId: v.id('workspaces'),
    subject: v.string(),
    endpoint: v.string(),
    keysCiphertext: v.string(),
    createdAt: v.number(),
  }).index('by_subject', ['subject']),
  workspaceSettings: defineTable({
    workspaceId: v.id('workspaces'),
    timezone: v.string(),
    workingDays: v.array(v.number()),
    startHour: v.number(),
    endHour: v.number(),
    attendedStartHour: v.number(),
    attendedEndHour: v.number(),
    overnightPolicy,
    dailyTokenCap: v.number(),
    triageAllowance: v.number(),
    memoryBudgets: v.object({
      workspace: v.number(),
      project: v.number(),
      floor: v.number(),
      agent: v.number(),
      summaries: v.number(),
    }),
    hiringPolicy,
    auditPolicy: v.union(v.literal('soft'), v.literal('hard')),
    triageAllowList: v.array(v.string()),
    emergencyAllowList: v.array(v.string()),
    notificationChannels: v.array(v.string()),
    plan: v.union(v.literal('subscription'), v.literal('byok')),
    monthlyAllowance: v.number(),
    maxConcurrentInstances: v.number(),
    rates: v.array(v.object({ model, input: v.number(), cached: v.number(), output: v.number() })),
    standards: v.string(),
    updatedAt: v.number(),
  }).index('by_workspace', ['workspaceId']),
  workerSignals: defineTable({ name: v.string(), revision: v.number(), updatedAt: v.number() }).index(
    'by_name',
    ['name'],
  ),
});
