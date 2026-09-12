'use client';

import { useMutation } from 'convex/react';
import { asId, uiApi } from '@/lib/ui-api';
import type {
  ConnectionVisibility,
  CorrectionDescriptor,
  ProviderId,
  TaskVisibility,
  ToolMode,
} from '@/lib/contracts';

export type CorrectionResult = { kind: 'task'; taskId: string } | { kind: 'proposal'; proposalId: string };

/** Every workspace mutation the UI can perform, in UI terms. */
export type Actions = {
  bootstrap: (name: string) => Promise<unknown>;
  setTokenCap: (monthlyTokenCap: number) => Promise<unknown>;
  hire: (versionId: string) => Promise<unknown>;
  createTask: (employeeId: string, prompt: string, title: string, projectId?: string) => Promise<unknown>;
  createProject: (name: string, brief: string, employeeIds: string[]) => Promise<unknown>;
  updateProject: (projectId: string, name: string, brief: string, employeeIds: string[]) => Promise<unknown>;
  setProjectArchived: (projectId: string, archived: boolean) => Promise<unknown>;
  sendMessage: (taskId: string, text: string) => Promise<unknown>;
  cancelTask: (taskId: string) => Promise<unknown>;
  decide: (proposalId: string, approved: boolean) => Promise<unknown>;
  correct: (proposalId: string) => Promise<CorrectionResult>;
  disconnect: (connectionId: string) => Promise<unknown>;
  updateConnectionAccess: (
    connectionId: string,
    allowedTools: string[],
    resourceScope: string,
    inboxResources: string,
  ) => Promise<unknown>;
  markRead: (itemId: string) => Promise<unknown>;
  assign: (itemId: string, employeeId: string, projectId?: string) => Promise<unknown>;
  saveDraft: (draft: Record<string, unknown>) => Promise<unknown>;
  publish: (draftId: string) => Promise<unknown>;
  retire: (versionId: string) => Promise<unknown>;
  // Sharing
  setTaskVisibility: (taskId: string, visibility: TaskVisibility) => Promise<unknown>;
  setConnectionSharing: (
    connectionId: string,
    visibility: ConnectionVisibility,
    visibleToSubjects: string[],
  ) => Promise<unknown>;
  // Floors
  postToBoard: (projectId: string, text: string) => Promise<unknown>;
  requestHandoff: (
    projectId: string,
    toEmployeeId: string,
    brief: string,
    sourceTaskId?: string,
  ) => Promise<unknown>;
  decideHandoff: (postId: string, accepted: boolean) => Promise<{ taskId?: string } | undefined>;
  // Operations (platform administrators)
  setEnabledUrls: (provider: ProviderId, enabledUrls: string[]) => Promise<unknown>;
  saveRegistryTool: (tool: {
    provider: ProviderId;
    name: string;
    description: string;
    mode: ToolMode;
    resourceArgument?: string;
    correction?: CorrectionDescriptor;
  }) => Promise<unknown>;
  deleteRegistryTool: (provider: ProviderId, name: string) => Promise<unknown>;
  importDiscoveredTools: (connectionId: string) => Promise<{ imported: number } | undefined>;
};

const unavailable = async () => undefined;
const unavailableCorrection = async (): Promise<CorrectionResult> => {
  throw new Error('Connect the backend before requesting a correction.');
};

/** Preview mode: every mutation is a no-op so the interface stays explorable. */
export const offlineActions: Actions = {
  bootstrap: unavailable,
  setTokenCap: unavailable,
  hire: unavailable,
  createTask: unavailable,
  createProject: unavailable,
  updateProject: unavailable,
  setProjectArchived: unavailable,
  sendMessage: unavailable,
  cancelTask: unavailable,
  decide: unavailable,
  correct: unavailableCorrection,
  disconnect: unavailable,
  updateConnectionAccess: unavailable,
  markRead: unavailable,
  assign: unavailable,
  saveDraft: unavailable,
  publish: unavailable,
  retire: unavailable,
  setTaskVisibility: unavailable,
  setConnectionSharing: unavailable,
  postToBoard: unavailable,
  requestHandoff: unavailable,
  decideHandoff: unavailable,
  setEnabledUrls: unavailable,
  saveRegistryTool: unavailable,
  deleteRegistryTool: unavailable,
  importDiscoveredTools: unavailable,
};

export function useWorkspaceActions(): Actions {
  const bootstrap = useMutation(uiApi.bootstrapWorkspace);
  const setTokenCap = useMutation(uiApi.setTokenCap);
  const hire = useMutation(uiApi.hire);
  const createTask = useMutation(uiApi.createTask);
  const createProject = useMutation(uiApi.createProject);
  const updateProject = useMutation(uiApi.updateProject);
  const setProjectArchived = useMutation(uiApi.setProjectArchived);
  const sendMessage = useMutation(uiApi.sendMessage);
  const cancelTask = useMutation(uiApi.cancelTask);
  const decide = useMutation(uiApi.decideAction);
  const correct = useMutation(uiApi.requestCorrection);
  const disconnect = useMutation(uiApi.disconnect);
  const updateConnectionAccess = useMutation(uiApi.updateConnectionAccess);
  const markRead = useMutation(uiApi.markInboxRead);
  const assign = useMutation(uiApi.assignInbox);
  const saveDraft = useMutation(uiApi.saveDraft);
  const publish = useMutation(uiApi.publishDraft);
  const retire = useMutation(uiApi.retireVersion);
  const setTaskVisibility = useMutation(uiApi.setTaskVisibility);
  const setConnectionSharing = useMutation(uiApi.setConnectionSharing);
  const postToBoard = useMutation(uiApi.postToBoard);
  const requestHandoff = useMutation(uiApi.requestHandoff);
  const decideHandoff = useMutation(uiApi.decideHandoff);
  const setEnabledUrls = useMutation(uiApi.setEnabledUrls);
  const saveRegistryTool = useMutation(uiApi.saveRegistryTool);
  const deleteRegistryTool = useMutation(uiApi.deleteRegistryTool);
  const importDiscoveredTools = useMutation(uiApi.importDiscoveredTools);

  return {
    bootstrap: (name) => bootstrap({ name }),
    setTokenCap: (monthlyTokenCap) => setTokenCap({ monthlyTokenCap }),
    hire: (versionId) => hire({ versionId: asId(versionId) }),
    createTask: (employeeId, prompt, title, projectId) =>
      createTask({
        employeeId: asId(employeeId),
        prompt,
        title,
        projectId: projectId ? asId<'projects'>(projectId) : undefined,
      }),
    createProject: (name, brief, employeeIds) =>
      createProject({ name, brief, employeeIds: employeeIds.map((id) => asId<'installations'>(id)) }),
    updateProject: (projectId, name, brief, employeeIds) =>
      updateProject({
        projectId: asId(projectId),
        name,
        brief,
        employeeIds: employeeIds.map((id) => asId<'installations'>(id)),
      }),
    setProjectArchived: (projectId, archived) => setProjectArchived({ projectId: asId(projectId), archived }),
    sendMessage: (taskId, text) => sendMessage({ taskId: asId(taskId), text }),
    cancelTask: (taskId) => cancelTask({ taskId: asId(taskId) }),
    decide: (proposalId, approved) => decide({ proposalId: asId(proposalId), approved }),
    correct: (proposalId) => correct({ proposalId: asId(proposalId) }),
    disconnect: (connectionId) => disconnect({ connectionId: asId(connectionId) }),
    updateConnectionAccess: (connectionId, allowedTools, resourceScope, inboxResources) =>
      updateConnectionAccess({
        connectionId: asId(connectionId),
        allowedTools,
        resourceScope,
        inboxResources,
      }),
    markRead: (itemId) => markRead({ itemId: asId(itemId) }),
    assign: (itemId, employeeId, projectId) =>
      assign({
        itemId: asId(itemId),
        employeeId: asId(employeeId),
        projectId: projectId ? asId<'projects'>(projectId) : undefined,
      }),
    // The employee editor still builds an untyped record; Convex validates every field on arrival.
    saveDraft: (draft) => saveDraft(draft as Parameters<typeof saveDraft>[0]),
    publish: (draftId) => publish({ draftId: asId(draftId) }),
    retire: (versionId) => retire({ versionId: asId(versionId) }),
    setTaskVisibility: (taskId, visibility) => setTaskVisibility({ taskId: asId(taskId), visibility }),
    setConnectionSharing: (connectionId, visibility, visibleToSubjects) =>
      setConnectionSharing({ connectionId: asId(connectionId), visibility, visibleToSubjects }),
    postToBoard: (projectId, text) => postToBoard({ projectId: asId(projectId), text }),
    requestHandoff: (projectId, toEmployeeId, brief, sourceTaskId) =>
      requestHandoff({
        projectId: asId(projectId),
        toEmployeeId: asId(toEmployeeId),
        brief,
        sourceTaskId: sourceTaskId ? asId<'tasks'>(sourceTaskId) : undefined,
      }),
    decideHandoff: (postId, accepted) => decideHandoff({ postId: asId(postId), accepted }),
    setEnabledUrls: (provider, enabledUrls) => setEnabledUrls({ provider, enabledUrls }),
    saveRegistryTool: (tool) => saveRegistryTool(tool),
    deleteRegistryTool: (provider, name) => deleteRegistryTool({ provider, name }),
    importDiscoveredTools: (connectionId) => importDiscoveredTools({ connectionId: asId(connectionId) }),
  };
}
