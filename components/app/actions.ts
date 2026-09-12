'use client';

import { useMutation } from 'convex/react';
import { uiApi } from '@/lib/ui-api';

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

  return {
    bootstrap: (name) => bootstrap({ name }),
    setTokenCap: (monthlyTokenCap) => setTokenCap({ monthlyTokenCap }),
    hire: (versionId) => hire({ versionId }),
    createTask: (employeeId, prompt, title, projectId) =>
      createTask({ employeeId, prompt, title, projectId }),
    createProject: (name, brief, employeeIds) => createProject({ name, brief, employeeIds }),
    updateProject: (projectId, name, brief, employeeIds) =>
      updateProject({ projectId, name, brief, employeeIds }),
    setProjectArchived: (projectId, archived) => setProjectArchived({ projectId, archived }),
    sendMessage: (taskId, text) => sendMessage({ taskId, text }),
    cancelTask: (taskId) => cancelTask({ taskId }),
    decide: (proposalId, approved) => decide({ proposalId, approved }),
    correct: (proposalId) => correct({ proposalId }),
    disconnect: (connectionId) => disconnect({ connectionId }),
    updateConnectionAccess: (connectionId, allowedTools, resourceScope, inboxResources) =>
      updateConnectionAccess({ connectionId, allowedTools, resourceScope, inboxResources }),
    markRead: (itemId) => markRead({ itemId }),
    assign: (itemId, employeeId, projectId) => assign({ itemId, employeeId, projectId }),
    saveDraft: (draft) => saveDraft(draft),
    publish: (draftId) => publish({ draftId }),
    retire: (versionId) => retire({ versionId }),
  };
}
