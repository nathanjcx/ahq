import { makeFunctionReference } from 'convex/server';
import type { Dashboard, Listing, Message, ModelId, ProviderId, ProviderReadiness } from './contracts';

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
  updatedAt: number;
};

type AdminToolRegistry = {
  provider: ProviderId;
  configured: boolean;
  tools: { name: string; description: string; mode: 'read' | 'write' | 'blocked' }[];
}[];

const query = <Args extends Record<string, unknown>, Result>(name: string) =>
  makeFunctionReference<'query', Args, Result>(name);
const mutation = <Args extends Record<string, unknown>, Result = null>(name: string) =>
  makeFunctionReference<'mutation', Args, Result>(name);

export const uiApi = {
  dashboard: query<Record<string, never>, Dashboard>('workspace:dashboard'),
  bootstrapWorkspace: mutation<{ name: string }, { workspaceId: string }>('workspace:bootstrap'),
  setBudget: mutation<{ monthlyBudget: number }>('workspace:setBudget'),
  listings: query<Record<string, never>, Listing[]>('marketplace:list'),
  hire: mutation<{ versionId: string }, { employeeId: string }>('marketplace:hire'),
  createProject: mutation<{ name: string; brief: string; employeeIds: string[] }, { projectId: string }>(
    'projects:create',
  ),
  updateProject: mutation<{ projectId: string; name: string; brief: string; employeeIds: string[] }>(
    'projects:update',
  ),
  setProjectArchived: mutation<{ projectId: string; archived: boolean }>('projects:setArchived'),
  createTask: mutation<
    { employeeId: string; prompt: string; title: string; projectId?: string },
    { taskId: string }
  >('tasks:create'),
  messages: query<{ taskId: string }, Message[]>('tasks:messages'),
  sendMessage: mutation<{ taskId: string; text: string }>('tasks:send'),
  cancelTask: mutation<{ taskId: string }>('tasks:cancel'),
  decideAction: mutation<{ proposalId: string; approved: boolean }>('actions:decide'),
  requestCorrection: mutation<
    { proposalId: string },
    { kind: 'task'; taskId: string } | { kind: 'proposal'; proposalId: string }
  >('actions:requestCorrection'),
  disconnect: mutation<{ connectionId: string }>('integrations:disconnect'),
  updateConnectionAccess: mutation<{
    connectionId: string;
    allowedTools: string[];
    resourceScope: string;
    inboxResources: string[];
  }>('integrations:updateAccess'),
  readiness: query<Record<string, never>, ProviderReadiness[]>('integrations:readiness'),
  markInboxRead: mutation<{ itemId: string }>('inbox:markRead'),
  assignInbox: mutation<{ itemId: string; employeeId: string; projectId?: string }, { taskId: string }>(
    'inbox:assign',
  ),
  adminDrafts: query<Record<string, never>, AdminDraft[]>('marketplace:adminList'),
  adminToolRegistry: query<Record<string, never>, AdminToolRegistry>('marketplace:adminToolRegistry'),
  saveDraft: mutation<Record<string, unknown>, { draftId: string }>('marketplace:saveDraft'),
  publishDraft: mutation<{ draftId: string }, { versionId: string }>('marketplace:publish'),
  retireVersion: mutation<{ versionId: string }>('marketplace:retire'),
};

export type { AdminDraft, AdminToolRegistry };
