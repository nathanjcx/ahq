/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as actions from "../actions.js";
import type * as admin from "../admin.js";
import type * as channels from "../channels.js";
import type * as crons from "../crons.js";
import type * as inbox from "../inbox.js";
import type * as integrations from "../integrations.js";
import type * as maintenance from "../maintenance.js";
import type * as marketplace from "../marketplace.js";
import type * as floors from "../floors.js";
import type * as notifications from "../notifications.js";
import type * as registry from "../registry.js";
import type * as services_actions from "../services/actions.js";
import type * as services_artifacts from "../services/artifacts.js";
import type * as services_channels from "../services/channels.js";
import type * as services_config from "../services/config.js";
import type * as services_context from "../services/context.js";
import type * as services_floors from "../services/floors.js";
import type * as services_inbox from "../services/inbox.js";
import type * as services_notifications from "../services/notifications.js";
import type * as services_integrations from "../services/integrations.js";
import type * as services_queue from "../services/queue.js";
import type * as services_sessions from "../services/sessions.js";
import type * as services_triage from "../services/triage.js";
import type * as shared from "../shared.js";
import type * as tasks from "../tasks.js";
import type * as triage from "../triage.js";
import type * as lib_posts from "../lib/posts.js";
import type * as lib_triage from "../lib/triage.js";
import type * as lib_tasks from "../lib/tasks.js";
import type * as workspace from "../workspace.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  actions: typeof actions;
  admin: typeof admin;
  channels: typeof channels;
  crons: typeof crons;
  inbox: typeof inbox;
  integrations: typeof integrations;
  maintenance: typeof maintenance;
  marketplace: typeof marketplace;
  floors: typeof floors;
  notifications: typeof notifications;
  registry: typeof registry;
  "services/actions": typeof services_actions;
  "services/artifacts": typeof services_artifacts;
  "services/channels": typeof services_channels;
  "services/config": typeof services_config;
  "services/context": typeof services_context;
  "services/floors": typeof services_floors;
  "services/inbox": typeof services_inbox;
  "services/notifications": typeof services_notifications;
  "services/integrations": typeof services_integrations;
  "services/queue": typeof services_queue;
  "services/sessions": typeof services_sessions;
  "services/triage": typeof services_triage;
  shared: typeof shared;
  tasks: typeof tasks;
  triage: typeof triage;
  "lib/posts": typeof lib_posts;
  "lib/triage": typeof lib_triage;
  "lib/tasks": typeof lib_tasks;
  workspace: typeof workspace;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
