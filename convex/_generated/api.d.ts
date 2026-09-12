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
import type * as budget from "../budget.js";
import type * as crons from "../crons.js";
import type * as inbox from "../inbox.js";
import type * as integrations from "../integrations.js";
import type * as maintenance from "../maintenance.js";
import type * as marketplace from "../marketplace.js";
import type * as projects from "../projects.js";
import type * as services from "../services.js";
import type * as shared from "../shared.js";
import type * as tasks from "../tasks.js";
import type * as workspace from "../workspace.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  actions: typeof actions;
  budget: typeof budget;
  crons: typeof crons;
  inbox: typeof inbox;
  integrations: typeof integrations;
  maintenance: typeof maintenance;
  marketplace: typeof marketplace;
  projects: typeof projects;
  services: typeof services;
  shared: typeof shared;
  tasks: typeof tasks;
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
