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
import type * as crons from "../crons.js";
import type * as inbox from "../inbox.js";
import type * as integrations from "../integrations.js";
import type * as maintenance from "../maintenance.js";
import type * as marketplace from "../marketplace.js";
import type * as projects from "../projects.js";
import type * as registry from "../registry.js";
import type * as services_actions from "../services/actions.js";
import type * as services_artifacts from "../services/artifacts.js";
import type * as services_config from "../services/config.js";
import type * as services_context from "../services/context.js";
import type * as services_floors from "../services/floors.js";
import type * as services_inbox from "../services/inbox.js";
import type * as services_integrations from "../services/integrations.js";
import type * as services_queue from "../services/queue.js";
import type * as services_sessions from "../services/sessions.js";
import type * as shared from "../shared.js";
import type * as tasks from "../tasks.js";
import type * as work from "../work.js";
import type * as workspace from "../workspace.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  actions: typeof actions;
  admin: typeof admin;
  crons: typeof crons;
  inbox: typeof inbox;
  integrations: typeof integrations;
  maintenance: typeof maintenance;
  marketplace: typeof marketplace;
  projects: typeof projects;
  registry: typeof registry;
  "services/actions": typeof services_actions;
  "services/artifacts": typeof services_artifacts;
  "services/config": typeof services_config;
  "services/context": typeof services_context;
  "services/floors": typeof services_floors;
  "services/inbox": typeof services_inbox;
  "services/integrations": typeof services_integrations;
  "services/queue": typeof services_queue;
  "services/sessions": typeof services_sessions;
  shared: typeof shared;
  tasks: typeof tasks;
  work: typeof work;
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
