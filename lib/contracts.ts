export type ModelId = 'gpt-5.6-luna' | 'gpt-5.6-terra' | 'gpt-5.6-sol' | 'gpt-6-astra';
export type ProviderId = 'linear' | 'slack' | 'github' | 'google-workspace' | 'canva';
export type TaskStatus =
  'queued' | 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'cancelled' | 'uncertain';
export type CorrectionKind = 'supported' | 'partial' | 'manual' | 'irreversible' | 'unknown';
export type ToolMode = 'read' | 'write' | 'blocked';
export type ConnectionVisibility = 'private' | 'members' | 'workspace';
export type TaskVisibility = 'private' | 'workspace';

export interface Capability {
  provider: ProviderId;
  tools: string[];
  optional: boolean;
}
export interface Listing {
  id: string;
  versionId: string;
  name: string;
  role: string;
  description: string;
  category: string;
  strengths: string[];
  limitations: string[];
  capabilities: Capability[];
  model: ModelId;
  color: string;
  media: { url: string; type: 'image' | 'video'; alt: string }[];
  publishedAt: number;
}
export interface Employee {
  id: string;
  versionId: string;
  name: string;
  role: string;
  color: string;
  model: ModelId;
  status: string;
  missingCapabilities: string[];
}
export interface Member {
  subject: string;
  name: string;
  email?: string;
  imageUrl?: string;
  role: 'owner' | 'admin' | 'member';
}
export interface Connection {
  id: string;
  provider: ProviderId;
  name: string;
  account: string;
  serverUrl: string;
  status: 'connected' | 'disconnected' | 'degraded' | 'revoked';
  ownerSubject: string;
  ownerName: string;
  isOwner: boolean;
  visibility: ConnectionVisibility;
  visibleToSubjects: string[];
  /** Reviewed tools available on this connection. */
  tools: string[];
  allowedTools: string[];
  resourceScope: string;
  inboxResources: string[];
  lastCheckedAt?: number;
  inboxMode: 'push' | 'on-demand' | 'unsupported';
  error?: string;
}
export interface TokenUsage {
  input: number;
  cached: number;
  output: number;
}
export interface ModelUsage extends TokenUsage {
  model: ModelId;
  tasks: number;
}
export interface Project {
  id: string;
  name: string;
  brief: string;
  employeeIds: string[];
  archivedAt?: number;
  createdAt: number;
  updatedAt: number;
  openHandoffs: number;
}
export interface ProjectPost {
  id: string;
  projectId: string;
  kind: 'note' | 'system' | 'handoff';
  authorSubject?: string;
  authorName: string;
  text: string;
  taskId?: string;
  createdAt: number;
  handoff?: {
    toEmployeeId: string;
    toEmployeeName: string;
    brief: string;
    status: 'pending' | 'accepted' | 'declined';
    taskId?: string;
    decidedBy?: string;
    decidedAt?: number;
  };
}
export interface Task {
  id: string;
  projectId?: string;
  projectContext?: { name: string; brief: string };
  sourceTaskId?: string;
  employeeId: string;
  employeeName: string;
  createdBy: string;
  createdByName: string;
  isOwner: boolean;
  visibility: TaskVisibility;
  title: string;
  prompt: string;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  sessionId?: string;
  error?: string;
  model: ModelId;
  usage?: TokenUsage;
}
export interface ActivityEvent {
  id: string;
  sequence: number;
  taskId?: string;
  type: string;
  text: string;
  createdAt: number;
  employeeName?: string;
  gap?: boolean;
}
export interface Message {
  id: string;
  taskId: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  createdAt: number;
  phase?: string;
}
export interface ActionProposal {
  id: string;
  taskId: string;
  connectionId: string;
  employeeName: string;
  provider: ProviderId;
  tool: string;
  arguments: string;
  summary: string;
  status:
    'pending' | 'approved' | 'rejected' | 'executing' | 'succeeded' | 'failed' | 'uncertain' | 'corrected';
  correction: CorrectionKind;
  correctionReason: string;
  beforeState?: string;
  afterState?: string;
  createdAt: number;
  approvedBy?: string;
  approvedByName?: string;
  approvedAt?: number;
  result?: string;
  originalActionId?: string;
  /** Whether the current viewer may approve, reject, or correct this proposal. */
  canDecide: boolean;
}
export interface InboxItem {
  id: string;
  provider: ProviderId;
  title: string;
  preview: string;
  sourceUrl?: string;
  createdAt: number;
  status: 'unread' | 'read' | 'assigned';
  taskId?: string;
}
export interface Artifact {
  id: string;
  taskId: string;
  name: string;
  mediaType: string;
  size: number;
  createdAt: number;
}
export interface Dashboard {
  workspace: {
    id: string;
    name: string;
    role: 'owner' | 'admin' | 'member';
    monthlyTokenCap: number;
    usage: { period: string; byModel: ModelUsage[] };
  } | null;
  viewer: { subject: string; name: string };
  isPlatformAdmin: boolean;
  employees: Employee[];
  connections: Connection[];
  projects: Project[];
  tasks: Task[];
  events: ActivityEvent[];
  proposals: ActionProposal[];
  inbox: InboxItem[];
  artifacts: Artifact[];
}
export const emptyDashboard: Dashboard = {
  workspace: null,
  viewer: { subject: '', name: '' },
  isPlatformAdmin: false,
  employees: [],
  connections: [],
  projects: [],
  tasks: [],
  events: [],
  proposals: [],
  inbox: [],
  artifacts: [],
};

/** Audit timeline entry, unsealed by the web service for authorized viewers. */
export type AuditEntry =
  | { kind: 'event'; id: string; at: number; type: string; text: string; gap?: boolean }
  | { kind: 'message'; id: string; at: number; role: Message['role']; text: string; phase?: string }
  | {
      kind: 'tool_call';
      id: string;
      at: number;
      operationId: string;
      connectionId: string;
      provider: ProviderId;
      tool: string;
      outcome: 'started' | 'succeeded' | 'failed' | 'denied';
      reason?: string;
      durationMs?: number;
      arguments?: unknown;
      result?: unknown;
      resultSha256?: string;
      proposalId?: string;
    }
  | {
      kind: 'proposal';
      id: string;
      at: number;
      tool: string;
      provider: ProviderId;
      summary: string;
      status: ActionProposal['status'];
      correction: CorrectionKind;
      arguments: unknown;
      beforeState?: unknown;
      afterState?: unknown;
      transitions: { from?: string; to: string; actor: string; at: number; detail?: string }[];
    };
export interface AuditTimeline {
  task: Pick<Task, 'id' | 'title' | 'employeeName' | 'status' | 'createdAt' | 'createdByName'>;
  entries: AuditEntry[];
}

/** Operational configuration, platform administrators only. Secrets are never returned. */
export interface OAuthClientConfig {
  serverUrl?: string;
  clientId: string;
  hasClientSecret: boolean;
  scopes?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  tokenAuthMethod?: 'client_secret_basic' | 'client_secret_post' | 'none';
}
export interface ProviderConfig {
  provider: ProviderId;
  enabledUrls: string[];
  oauthClients: OAuthClientConfig[];
  hasInboxSecret: boolean;
  updatedAt?: number;
  updatedBy?: string;
}
export interface CorrectionDescriptor {
  readTool: string;
  idArgument: string;
  versionField: string;
  expectedVersionArgument: string;
  fields: string[];
}
export interface RegistryTool {
  provider: ProviderId;
  name: string;
  description: string;
  mode: ToolMode;
  resourceArgument?: string;
  correction?: CorrectionDescriptor;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
  updatedAt: number;
  updatedBy: string;
}
/** What the Integrations page needs to explain readiness per provider. */
export interface ProviderReadiness {
  provider: ProviderId;
  enabledUrls: string[];
  /** Enabled URLs that also have an OAuth client. */
  oauthUrls: string[];
  reviewedTools: number;
  inboxConfigured: boolean;
}
