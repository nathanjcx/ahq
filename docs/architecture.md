# Architecture

This describes the target shape of Astra HQ as of September 12, 2026. It is the contract every service, Convex module, and UI page builds against. Where the code and this document disagree, fix the code or update this document in the same change.

## Runtime parts

| Part    | Owns                                                                                     | Talks to                          |
| ------- | ---------------------------------------------------------------------------------------- | --------------------------------- |
| Convex  | All state, the job queue, the journal, operational configuration, live subscriptions     | Nothing outbound                  |
| web     | Clerk sign-in, OAuth callbacks, audit unsealing, file downloads, webhooks, admin secrets | Convex (service secret), Clerk    |
| worker  | Queue jobs, Agents sessions, session monitoring, artifact archive                        | Convex, OpenAI, S3, provider MCPs |
| gateway | The only MCP server an agent can reach                                                   | Convex, provider MCPs             |

Web, worker, and gateway share `AHQ_SERVICE_SECRET` for Convex service functions and `CREDENTIAL_ENCRYPTION_KEY` to seal and unseal secrets. Convex never holds a plaintext secret and never holds the encryption key.

## Configuration lives in Convex

Operational configuration is data, edited by platform administrators from the Operations page, and read by every service through service queries. Environment variables are reserved for bootstrap trust and tunables.

| Table             | Content                                                                                                                                                                                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `providerConfigs` | Per provider: enabled server URLs, OAuth clients (client id, sealed client secret, scopes, optional fixed endpoints, keyed by server URL or provider default), sealed native webhook secret.                                                                |
| `registryTools`   | Per provider and tool name: description, `mode` (`read`, `write`, `blocked`), optional `resourceArgument`, optional `correction` descriptor, MCP annotations captured at discovery as hints only. This table is both the tool registry and the tool policy. |

Environment variables that remain: Clerk keys and issuer, Convex URLs, `APP_URL`, `AHQ_SERVICE_SECRET`, `CREDENTIAL_ENCRYPTION_KEY`, `OPENAI_API_KEY`, `MCP_GATEWAY_URL`, S3 settings, `PLATFORM_ADMIN_USER_IDS`, `WORKER_CONCURRENCY`, `MAX_TURN_SECONDS`, `WORKER_MONITORS`.

Removed: `MCP_SERVER_URLS_JSON`, `MCP_TOOL_REGISTRY_JSON`, `MCP_TOOL_POLICIES_JSON`, `MCP_OAUTH_CONFIG_JSON`, `NATIVE_INBOX_SECRETS_JSON`, `INBOX_WEBHOOK_SECRETS_JSON`, `TASK_RESERVED_COST_USD*`.

Secrets entered on the Operations page go to a web route, which seals them before calling Convex. The browser never sees a sealed or plaintext secret again; the UI only shows whether one is set and when it changed.

Each connection carries its own sealed relay secret for the normalized inbox relay, generated when the connection is created. The owner can reveal or rotate it from Manage access.

## Convex modules

User-facing modules take Clerk identity. Service modules take the service secret and live under `convex/services/`.

| Module                  | Purpose                                                                          |
| ----------------------- | -------------------------------------------------------------------------------- |
| `workspace`             | Bootstrap, dashboard, usage summary, token cap                                   |
| `marketplace`           | Drafts, immutable versions, hiring                                               |
| `integrations`          | Connection access, sharing, readiness, relay secret                              |
| `tasks`                 | Create, message, cancel, share, audit timeline (sealed)                          |
| `actions`               | Decide, request correction                                                       |
| `projects`              | Floors, staffing, board posts, handoffs                                          |
| `inbox`                 | Read, assign                                                                     |
| `admin`                 | Provider configuration and tool registry, platform admins only                   |
| `registry`              | Pure helpers over `registryTools` and `providerConfigs`                          |
| `shared`                | Identity, roles, visibility, text limits                                         |
| `work`                  | Task creation, employee readiness, token cap, board posts, sealed timeline       |
| `services/config`       | Provider configuration and policies for web, worker, gateway                     |
| `services/queue`        | Worker state, claim, renew, complete, fail                                       |
| `services/sessions`     | Task context, session context, stream leases, session and event recording, usage |
| `services/actions`      | Propose, action context, result recording, tool-call journal                     |
| `services/integrations` | Connect, refresh, error marking, connection context                              |
| `services/inbox`        | Relay and resource-routed ingestion                                              |
| `services/artifacts`    | Record and authorize artifacts                                                   |
| `services/floors`       | Agent-originated posts and handoff requests                                      |

Function references use the file path, for example `services/queue:claimJobs`.

`convex/work.ts` holds no functions of its own. It is the shared writer every caller goes through, so task creation, readiness, the cap check, job insertion, board posts, handoffs, and the sealed timeline have one implementation.

## Service modules

The worker and the gateway are directories, not single files. Both run on the shared helpers in `lib/server/`.

| Module                         | Purpose                                                                            |
| ------------------------------ | ---------------------------------------------------------------------------------- |
| `services/gateway.ts`          | Process entry: checks its secrets, then listens                                    |
| `services/gateway/create.ts`   | Request handling, run token resolution, body limits, health, protocol failures     |
| `services/gateway/tools.ts`    | The per connection MCP server, the floor MCP server, authorization, proposals      |
| `services/gateway/errors.ts`   | The failure taxonomy and its two shapes, protocol error and tool result            |
| `services/worker/main.ts`      | Process entry: subscription, pull timer, health, graceful shutdown                 |
| `services/worker/queue.ts`     | One claim pass for jobs and session monitors, sized by free slots                  |
| `services/worker/jobs.ts`      | Runs one claimed job: session creation, input, cancellation, approved writes       |
| `services/worker/monitor.ts`   | One session's event stream, reconciliation, run time limit, stream lease heartbeat |
| `services/worker/artifacts.ts` | Archives session files and writes journal events                                   |
| `services/worker/state.ts`     | Worker identity, slot pools, bounded tunables                                      |
| `services/worker/health.ts`    | The health JSON                                                                    |
| `services/actions.ts`          | The approved write executor, including the correction precondition read            |

## Visibility and sharing

Every shareable record carries `visibility` and `visibleToSubjects`.

- Connections: `private`, `members` (listed subjects), or `workspace`. A shared connection lets other members' tasks use it. Only the owner edits access or sharing.
- Tasks: `private` or `workspace`. Tasks on a floor default to `workspace` because floors are shared. Messages, events, proposals, artifacts, and the audit timeline follow the task.
- Inbox items follow their connection.
- A pending proposal also appears for the owner of the connection that would execute it, even when the
  task is private, because only that owner or a workspace owner or admin can decide it.

Approving, rejecting, or correcting an external action requires being the owner of the connection that will execute it, or a workspace owner or admin. A task creator using someone else's shared connection cannot approve writes through it.

Names shown in shared views come from Clerk claims captured at write time (`createdByName`, `authorName`). Member lists for sharing come from Clerk organization memberships through the web service.

## Usage, not cost

The app records token usage per task and per workspace period, by model: `input`, `cached`, `output`. Cache hit rate is `cached / input`. No dollar estimate is stored or shown. A workspace may set an optional monthly token cap on `input + output`; when set, task creation, follow-up messages, and inbox assignment are refused once the period's recorded usage reaches it. Accepting a handoff and creating a correction task are not checked. There is no reservation. In-flight tasks can overshoot the cap by their own usage.

## Agents and the gateway

The worker builds a session whose tools are MCP entries pointing at `MCP_GATEWAY_URL/mcp/<connectionId>` with the task run token as bearer. Floor tasks also get an internal `astra_floor` MCP entry for board posts and handoff requests. The hosted environment has network access disabled and subagents disabled.

The gateway is a factory, `createGateway({ backend })`, so it can run in production against Convex and in tests against `convex-test`. For every request it:

1. Resolves the run token to the task, employee version, connections, and policies in one service query.
2. Exposes only tools in the intersection of the connection's allowed tools, the version's capability, and non-blocked policy.
3. Journals every read, write proposal, and denied attempt as a tool call with sealed arguments, a result hash, duration, and a reason code.

Failures use a fixed taxonomy. Protocol failures return JSON-RPC errors with a code, a stable `reason`, and a request id. Tool failures return an MCP result with `isError` and structured content `{ code, reason, message, retryable }` so the model can act on them. Codes:

| Code   | Reason              | Meaning                                                        |
| ------ | ------------------- | -------------------------------------------------------------- |
| -32001 | `unauthorized`      | Missing or unknown run token                                   |
| -32002 | `revoked`           | Grant or connection no longer available                        |
| -32003 | `policy_denied`     | Tool blocked, outside resource scope, or not in the capability |
| -32004 | `provider_error`    | Upstream MCP failed                                            |
| -32005 | `approval_required` | Write became a proposal (informational, not an error)          |
| -32006 | `provider_timeout`  | Upstream did not answer in time                                |
| -32700 | `malformed_request` | Body is not valid JSON, or the endpoint is unknown             |
| -32600 | `request_too_large` | Request body is larger than 1 MB                               |
| -32602 | `invalid_arguments` | A required tool argument is missing or not a string            |

The last three are request rejections the gateway makes before any policy or provider is involved.

## Tool policy

A tool exists for agents only if a `registryTools` row exists for its provider and name. `mode` decides read, write, or blocked. Names matching destructive verbs cannot be saved as `read`. `resourceArgument` names the argument checked against a connection's resource restriction; without it, a restricted connection blocks the tool. `correction` names the read tool, id argument, version field, expected-version argument, and fields for a compensating update. Annotations reported by the MCP server are stored as hints for the administrator and never grant anything.

## Proposals, corrections, audit

A write becomes a proposal with the arguments hash, the policy's correction level, and, when a correction descriptor exists, a `beforeState` read through the audited read tool. Approval enqueues one execute job. The executor rechecks the lease, grant, and scope, records the call as started, dispatches once, and records `afterState` when the result carries the version field. A correction is a new proposal that restores the configured fields with the captured previous values, conditioned on the current version. Manual and partial corrections become tasks. Irreversible and unknown corrections show the reason and no button.

The audit timeline for a task merges events, messages, tool calls, proposals, and transitions in order. The web service unseals arguments and results for viewers who can see the task. It is exportable as JSON.

## Worker

The worker is replica-safe by construction. All coordination is through Convex leases:

- Jobs are claimed with `claimJobs(workerId, limit)` where the limit is the worker's free job slots. A job lease lasts 60 seconds and `renewLease` extends it every 20 seconds. At most one job per task is leased.
- Session monitors are claimed with `claimStreams(workerId, limit)`, sized by free monitor slots. A task is claimable when its stream lease is empty, expired, or already this worker's, and the 120 second lease is stamped in the same mutation. `renewStream` is the monitor heartbeat, every 40 seconds; a heartbeat that reports another owner aborts the monitor. `releaseStream` returns one session.
- The subscription carries counts and a wake revision only. Workers pull; they do not receive lists.
- Shutdown stops claiming, unsubscribes, waits up to 30 seconds for in-flight jobs, releases every stream lease, then exits.
- Health reports connection state, in-flight jobs, active monitors, free slots, and last claim time.

## Floors

A floor is a project with a brief, a team of employees, a board, and shared tasks. The board holds notes from people, system posts (task started, completed, failed), and handoff requests. A handoff names a target employee and a brief and links the source task. A person accepts a handoff, which creates a floor task carrying the source task's final message as context. Agents can post notes and request handoffs through the internal floor tools; they cannot accept them.

## Frontend

`components/` is organized by page with shared primitives:

```
components/
  app/          shell, navigation, providers, actions hook
  office/       3D office and floor overview
  floors/       floor page, board, staffing, handoffs
  inbox/
  employees/
  tasks/        list, detail, conversation, proposal card, audit tab, visibility menu, handoff sheet
  files/
  activity/
  marketplace/  listing, detail, hire
  integrations/ cards, product picker, manage access, sharing, relay secret
  admin/        marketplace studio, operations (providers, registry, usage)
  shared/       Sheet, PageIntro, Avatar, marks, empty states, formatting
```

Pages receive data through props from the shell and call actions through one typed actions object. No page imports another page.
