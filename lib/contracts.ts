export type ModelId = 'gpt-5.6-luna' | 'gpt-5.6-terra' | 'gpt-5.6-sol' | 'gpt-6-astra';
export type ProviderId = 'linear' | 'slack' | 'github' | 'google-workspace' | 'canva';
export type TaskStatus =
  'queued' | 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'cancelled' | 'uncertain';
export type CorrectionKind = 'supported' | 'partial' | 'manual' | 'irreversible' | 'unknown';
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
export interface Project {
  id: string;
  name: string;
  brief: string;
  employeeIds: string[];
  archivedAt?: number;
  createdAt: number;
  updatedAt: number;
}
export interface Connection {
  id: string;
  provider: ProviderId;
  name: string;
  account: string;
  serverUrl: string;
  status: 'connected' | 'disconnected' | 'degraded' | 'revoked';
  tools: string[];
  allowedTools: string[];
  resourceScope: string;
  inboxResources: string[];
  lastCheckedAt?: number;
  inboxMode: 'push' | 'on-demand' | 'unsupported';
  error?: string;
}
export interface Task {
  id: string;
  projectId?: string;
  projectContext?: { name: string; brief: string };
  employeeId: string;
  employeeName: string;
  title: string;
  prompt: string;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  sessionId?: string;
  error?: string;
  model: ModelId;
  usage?: { input: number; output: number; cached: number; estimatedCost: number };
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
  employeeName: string;
  provider: ProviderId;
  tool: string;
  arguments: string;
  summary: string;
  status:
    'pending' | 'approved' | 'rejected' | 'executing' | 'succeeded' | 'failed' | 'uncertain' | 'corrected';
  correction: CorrectionKind;
  correctionReason: string;
  createdAt: number;
  result?: string;
  originalActionId?: string;
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
export interface WebSetup {
  oauthServers: string[];
  inboxProviders: string[];
}
export interface ProviderReadiness {
  provider: ProviderId;
  enabledUrls: string[];
  reviewedTools: number;
}
export interface Dashboard {
  workspace: { id: string; name: string; role: string; monthlyBudget: number; spent: number } | null;
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
