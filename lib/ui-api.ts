import { makeFunctionReference } from 'convex/server';
import type {
  AuditTimeline,
  Dashboard,
  Listing,
  Message,
  ModelId,
  Persona,
  ProjectPost,
  ProviderConfig,
  ProviderId,
  ProviderReadiness,
  RegistryTool,
  ToolMode,
  CorrectionDescriptor,
} from './contracts';

type AdminDraft = {
  draftId: string;
  name: string;
  role: string;
  description: string;
  category: string;
  color: string;
  model: ModelId;
  instructions: string;
  strengths: string[];
  limitations: string[];
  capabilities: { provider: ProviderId; tools: string[]; optional: boolean }[];
  media: { url: string; type: 'image' | 'video'; alt: string }[];
  skills: { name: string; version: string; sha256: string; content: string }[];
  persona?: Persona;
  updatedAt: number;
};

const query = <Args extends Record<string, unknown>, Result>(name: string) =>
  makeFunctionReference<'query', Args, Result>(name);
const mutation = <Args extends Record<string, unknown>, Result = null>(name: string) =>
  makeFunctionReference<'mutation', Args, Result>(name);

export const uiApi = {
  // Workspace
  dashboard: query<Record<string, never>, Dashboard>('workspace:dashboard'),
  bootstrapWorkspace: mutation<{ name: string }, { workspaceId: string }>('workspace:bootstrap'),
  setTokenCap: mutation<{ monthlyTokenCap: number }>('workspace:setTokenCap'),

  // Marketplace
  listings: query<Record<string, never>, Listing[]>('marketplace:list'),
  hire: mutation<{ versionId: string }, { employeeId: string }>('marketplace:hire'),

  // Floors
  createProject: mutation<{ name: string; brief: string; employeeIds: string[] }, { projectId: string }>(
    'projects:create',
  ),
  updateProject: mutation<{ projectId: string; name: string; brief: string; employeeIds: string[] }>(
    'projects:update',
  ),
  setProjectArchived: mutation<{ projectId: string; archived: boolean }>('projects:setArchived'),
  projectBoard: query<{ projectId: string }, ProjectPost[]>('projects:board'),
  postToBoard: mutation<{ projectId: string; text: string }>('projects:post'),
  requestHandoff: mutation<
    { projectId: string; toEmployeeId: string; brief: string; sourceTaskId?: string },
    { postId: string }
  >('projects:requestHandoff'),
  decideHandoff: mutation<{ postId: string; accepted: boolean }, { taskId?: string }>(
    'projects:decideHandoff',
  ),

  // Tasks
  createTask: mutation<
    { employeeId: string; prompt: string; title: string; projectId?: string },
    { taskId: string }
  >('tasks:create'),
  messages: query<{ taskId: string }, Message[]>('tasks:messages'),
  sendMessage: mutation<{ taskId: string; text: string }>('tasks:send'),
  cancelTask: mutation<{ taskId: string }>('tasks:cancel'),
  setTaskVisibility: mutation<{ taskId: string; visibility: 'private' | 'workspace' }>('tasks:setVisibility'),

  // Actions
  decideAction: mutation<{ proposalId: string; approved: boolean }>('actions:decide'),
  requestCorrection: mutation<
    { proposalId: string },
    { kind: 'task'; taskId: string } | { kind: 'proposal'; proposalId: string }
  >('actions:requestCorrection'),

  // Integrations
  disconnect: mutation<{ connectionId: string }>('integrations:disconnect'),
  updateConnectionAccess: mutation<{
    connectionId: string;
    allowedTools: string[];
    resourceScope: string;
    inboxResources: string;
  }>('integrations:updateAccess'),
  setConnectionSharing: mutation<{
    connectionId: string;
    visibility: 'private' | 'members' | 'workspace';
    visibleToSubjects: string[];
  }>('integrations:setSharing'),
  readiness: query<Record<string, never>, ProviderReadiness[]>('integrations:readiness'),

  // Inbox
  markInboxRead: mutation<{ itemId: string }>('inbox:markRead'),
  assignInbox: mutation<{ itemId: string; employeeId: string; projectId?: string }, { taskId: string }>(
    'inbox:assign',
  ),

  // Marketplace studio, platform administrators
  adminDrafts: query<Record<string, never>, AdminDraft[]>('marketplace:adminList'),
  saveDraft: mutation<Record<string, unknown>, { draftId: string }>('marketplace:saveDraft'),
  publishDraft: mutation<{ draftId: string }, { versionId: string }>('marketplace:publish'),
  retireVersion: mutation<{ versionId: string }>('marketplace:retire'),

  // Operations, platform administrators. Secrets go through /api/admin/* so the web service seals them.
  providerConfigs: query<Record<string, never>, ProviderConfig[]>('admin:providerConfigs'),
  setEnabledUrls: mutation<{ provider: ProviderId; enabledUrls: string[] }>('admin:setEnabledUrls'),
  registryTools: query<Record<string, never>, RegistryTool[]>('admin:registryTools'),
  saveRegistryTool: mutation<{
    provider: ProviderId;
    name: string;
    description: string;
    mode: ToolMode;
    resourceArgument?: string;
    correction?: CorrectionDescriptor;
  }>('admin:saveRegistryTool'),
  deleteRegistryTool: mutation<{ provider: ProviderId; name: string }>('admin:deleteRegistryTool'),
  /** Copies tool names and annotations discovered on one of the caller's own connections into the registry as blocked entries for review. */
  importDiscoveredTools: mutation<{ connectionId: string }, { imported: number }>(
    'admin:importDiscoveredTools',
  ),
};

/** Web routes that need the encryption key or Clerk's backend API. */
export const webApi = {
  members: '/api/workspace/members',
  audit: (taskId: string) => `/api/audit/${encodeURIComponent(taskId)}`,
  connect: '/api/integrations/connect',
  relaySecret: (connectionId: string) => `/api/integrations/relay-secret/${encodeURIComponent(connectionId)}`,
  adminOAuthClient: '/api/admin/oauth-client',
  adminInboxSecret: '/api/admin/inbox-secret',
};

export type { AdminDraft, AuditTimeline };
