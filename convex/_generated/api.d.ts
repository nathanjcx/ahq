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
import type * as audit from "../audit.js";
import type * as calendar from "../calendar.js";
import type * as channels from "../channels.js";
import type * as crons from "../crons.js";
import type * as floors from "../floors.js";
import type * as inbox from "../inbox.js";
import type * as integrations from "../integrations.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_calendar from "../lib/calendar.js";
import type * as lib_dependencies from "../lib/dependencies.js";
import type * as lib_handoffs from "../lib/handoffs.js";
import type * as lib_inbox from "../lib/inbox.js";
import type * as lib_marketplace from "../lib/marketplace.js";
import type * as lib_meetings from "../lib/meetings.js";
import type * as lib_memory from "../lib/memory.js";
import type * as lib_posts from "../lib/posts.js";
import type * as lib_projects from "../lib/projects.js";
import type * as lib_reserved from "../lib/reserved.js";
import type * as lib_schedule from "../lib/schedule.js";
import type * as lib_tasks from "../lib/tasks.js";
import type * as lib_time from "../lib/time.js";
import type * as lib_triage from "../lib/triage.js";
import type * as maintenance from "../maintenance.js";
import type * as marketplace from "../marketplace.js";
import type * as meetings from "../meetings.js";
import type * as memory from "../memory.js";
import type * as notifications from "../notifications.js";
import type * as plan from "../plan.js";
import type * as projects from "../projects.js";
import type * as registry from "../registry.js";
import type * as schedule from "../schedule.js";
import type * as seed from "../seed.js";
import type * as services_actions from "../services/actions.js";
import type * as services_artifacts from "../services/artifacts.js";
import type * as services_audit from "../services/audit.js";
import type * as services_calendar from "../services/calendar.js";
import type * as services_channels from "../services/channels.js";
import type * as services_config from "../services/config.js";
import type * as services_context from "../services/context.js";
import type * as services_floors from "../services/floors.js";
import type * as services_inbox from "../services/inbox.js";
import type * as services_integrations from "../services/integrations.js";
import type * as services_meetings from "../services/meetings.js";
import type * as services_memory from "../services/memory.js";
import type * as services_notifications from "../services/notifications.js";
import type * as services_projects from "../services/projects.js";
import type * as services_queue from "../services/queue.js";
import type * as services_schedule from "../services/schedule.js";
import type * as services_sessions from "../services/sessions.js";
import type * as services_triage from "../services/triage.js";
import type * as shared from "../shared.js";
import type * as tasks from "../tasks.js";
import type * as triage from "../triage.js";
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
  audit: typeof audit;
  calendar: typeof calendar;
  channels: typeof channels;
  crons: typeof crons;
  floors: typeof floors;
  inbox: typeof inbox;
  integrations: typeof integrations;
  "lib/audit": typeof lib_audit;
  "lib/calendar": typeof lib_calendar;
  "lib/dependencies": typeof lib_dependencies;
  "lib/handoffs": typeof lib_handoffs;
  "lib/inbox": typeof lib_inbox;
  "lib/marketplace": typeof lib_marketplace;
  "lib/meetings": typeof lib_meetings;
  "lib/memory": typeof lib_memory;
  "lib/posts": typeof lib_posts;
  "lib/projects": typeof lib_projects;
  "lib/reserved": typeof lib_reserved;
  "lib/schedule": typeof lib_schedule;
  "lib/tasks": typeof lib_tasks;
  "lib/time": typeof lib_time;
  "lib/triage": typeof lib_triage;
  maintenance: typeof maintenance;
  marketplace: typeof marketplace;
  meetings: typeof meetings;
  memory: typeof memory;
  notifications: typeof notifications;
  plan: typeof plan;
  projects: typeof projects;
  registry: typeof registry;
  schedule: typeof schedule;
  seed: typeof seed;
  "services/actions": typeof services_actions;
  "services/artifacts": typeof services_artifacts;
  "services/audit": typeof services_audit;
  "services/calendar": typeof services_calendar;
  "services/channels": typeof services_channels;
  "services/config": typeof services_config;
  "services/context": typeof services_context;
  "services/floors": typeof services_floors;
  "services/inbox": typeof services_inbox;
  "services/integrations": typeof services_integrations;
  "services/meetings": typeof services_meetings;
  "services/memory": typeof services_memory;
  "services/notifications": typeof services_notifications;
  "services/projects": typeof services_projects;
  "services/queue": typeof services_queue;
  "services/schedule": typeof services_schedule;
  "services/sessions": typeof services_sessions;
  "services/triage": typeof services_triage;
  shared: typeof shared;
  tasks: typeof tasks;
  triage: typeof triage;
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
