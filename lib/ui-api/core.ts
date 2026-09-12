import type { FunctionReturnType } from 'convex/server';
import { api } from '@/convex/_generated/api';
import type { Id, TableNames } from '@/convex/_generated/dataModel';

/**
 * Every Convex function the interface calls, under the names the UI uses. The references are the
 * generated ones, so arguments and results are typed by the Convex functions themselves and a
 * renamed or re-shaped function fails the build here rather than at runtime.
 */
export const coreApi = {
  // Workspace
  dashboard: api.workspace.dashboard,
  bootstrapWorkspace: api.workspace.bootstrap,
  setTokenCap: api.workspace.setTokenCap,

  // Marketplace and instances
  listings: api.marketplace.list,
  hire: api.marketplace.hire,
  hireRequests: api.marketplace.hireRequests,
  decideHire: api.marketplace.decideHire,
  renameEmployee: api.marketplace.rename,
  moveEmployee: api.marketplace.move,
  retireEmployee: api.marketplace.retireInstance,
  upgradeEmployee: api.marketplace.upgrade,
  instanceStatus: api.marketplace.instanceStatus,
  instanceUpgrade: api.marketplace.instanceUpgrade,
  listingVersions: api.marketplace.listingVersions,
  setOvernightModel: api.marketplace.setOvernightModel,

  // Floors
  createFloor: api.floors.create,
  updateFloor: api.floors.update,
  setFloorArchived: api.floors.setArchived,
  floorBoard: api.floors.board,
  postToBoard: api.floors.post,
  requestHandoff: api.floors.requestHandoff,
  decideHandoff: api.floors.decideHandoff,

  // Tasks
  createTask: api.tasks.create,
  messages: api.tasks.messages,
  sendMessage: api.tasks.send,
  cancelTask: api.tasks.cancel,
  setTaskVisibility: api.tasks.setVisibility,

  // Actions
  decideAction: api.actions.decide,
  requestCorrection: api.actions.requestCorrection,

  // Integrations
  disconnect: api.integrations.disconnect,
  updateConnectionAccess: api.integrations.updateAccess,
  setConnectionSharing: api.integrations.setSharing,
  readiness: api.integrations.readiness,

  // Inbox
  markInboxRead: api.inbox.markRead,
  assignInbox: api.inbox.assign,

  // Marketplace studio, platform administrators
  adminDrafts: api.marketplace.adminList,
  saveDraft: api.marketplace.saveDraft,
  publishDraft: api.marketplace.publish,
  retireVersion: api.marketplace.retire,
  setListingVisibility: api.marketplace.setVisibility,
  setListingEvidence: api.marketplace.setEvidence,
  previewInstructions: api.marketplace.previewInstructions,
  versionDiff: api.marketplace.versionDiff,

  // Operations, platform administrators. Secrets go through /api/admin/* so the web service seals them.
  providerConfigs: api.admin.providerConfigs,
  setEnabledUrls: api.admin.setEnabledUrls,
  registryTools: api.admin.registryTools,
  saveRegistryTool: api.admin.saveRegistryTool,
  deleteRegistryTool: api.admin.deleteRegistryTool,
  /** Copies tool names and annotations discovered on one of the caller's own connections into the registry as blocked entries for review. */
  importDiscoveredTools: api.admin.importDiscoveredTools,
} as const;

/**
 * The interface carries Convex ids as opaque strings, so the one place that hands a string back to a
 * generated reference says which table it came from. Convex rejects an id from the wrong table.
 */
export function asId<Table extends TableNames>(value: string): Id<Table> {
  return value as Id<Table>;
}

/** A marketplace draft exactly as Convex returns it. */
export type AdminDraft = FunctionReturnType<typeof api.marketplace.adminList>[number];
