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

`app/` holds the routes: the shell at `/`, the web routes under `app/api/`, `/health`, and the development-only fixture route `/qa`. `components/` is organized by page with shared primitives:

```
components/
  app/          shell, sidebar, topbar, page content, new task panel, notices, settings, review bar, actions
  office/       the 3D office: scene, stage, room, furniture, people, signals, overlay, pan,
                and the pure modules activity.ts, office-stations.ts, office-labels.ts, daylight.ts, sound.ts
  floors/       floor page, view, board, work, team, directory, switcher, lobby, scene, replay, stats
  tasks/        list, detail, conversation, message bubble, proposal card, audit tab, visibility menu, handoff sheet
  integrations/ cards, connect, product picker, manage access, sharing, relay secret
  admin/        marketplace studio, employee editor, operations (providers, OAuth client form, tool registry)
  marketplace/  listing, detail, capabilities
  inbox/ employees/ files/ activity/   one page each
  shared/       MasterDetail, Sheet, SkeletonList, OverflowMenu, useIsNarrow, marks, page intro,
                empty states, JSON view, state diff, tool checklist, formatting, members
```

Pages receive data through props from the shell and call actions through one typed actions object. No page imports another page.

## The typed layer

The interface never writes a Convex function name as a string and never posts an unchecked body to its own routes.

`lib/ui-api.ts` exports `uiApi`, every Convex function the interface calls under the name the UI uses, holding the generated `api.*` references. Arguments and results are typed by the Convex functions themselves, so a renamed or re-shaped function fails the build there rather than in the browser. The interface carries Convex ids as opaque strings; `asId<Table>(value)` is the single cast back, and Convex rejects an id from the wrong table.

`lib/contracts.ts` is the shape the interface renders. `web-tests/contracts.types.test.ts` asserts at compile time that each Convex query extends its contract (`dashboard`, `marketplace.list`, `projects.board`, `integrations.readiness`, `admin.providerConfigs`, `admin.registryTools`, `tasks.messages`) and that the audit route's response, minus its truncation flag, satisfies `AuditTimeline`. Convex returns branded `Id` values where the contracts say `string`; an `Id` is a string subtype, so the assertion holds.

`lib/api/schemas.ts` holds a zod schema for the request and response of every web route. Routes parse requests with them and declare their responses `satisfies` the inferred type. `lib/api/client.ts` exports `webClient`, the only browser path to those routes: same-origin, JSON in and out, every response parsed against its schema, and the shared error envelope `{ error, code? }` turned into a `WebApiError` carrying the HTTP status and the route's stable code. Every call sends `x-requested-with: astra-hq` from `lib/api/routes.ts`, which `actor()` requires on any non-GET alongside a matching `Origin`; a cross-site form can set neither. The routes are the six that need the encryption key or Clerk's backend API: workspace members, the audit timeline, starting a connection, the relay secret, and the two administrator secret routes. Convex handles everything else.

## The office

The office is a react-three-fiber scene dressed by the journal. Its rules live in pure modules so they can be tested without a renderer.

**Activity.** `deriveActivities` in `components/office/activity.ts` gives every employee one activity. Precedence is highest first:

| Activity      | Chosen when                                                                                           | Holds for                    |
| ------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------- |
| `reviewing`   | The newest active task is `awaiting_approval`, or its latest event is `agent.session.requires_action` | While that stays true        |
| `failed`      | The newest settled task is `failed` or `uncertain`                                                    | 5 minutes                    |
| `celebrating` | The newest settled task is `completed`                                                                | 90 seconds                   |
| `writing`     | The active task's last assistant message is fresh                                                     | 20 seconds                   |
| `calling`     | The active task's latest event is `<tool>: started`                                                   | Until the next event         |
| `reading`     | The active task's latest event is `<tool>: succeeded`                                                 | 20 seconds                   |
| `thinking`    | An active task with none of the above; timed from the newest `agent.session.turn.created`             | While the task is active     |
| `talking`     | A pending handoff names this employee, or this employee wrote it                                      | Until the handoff is decided |
| `idle`        | Nothing else                                                                                          |                              |

Active means `queued`, `running`, or `awaiting_approval`. `providerForTool` reads the provider out of the tool name by prefix, so `linear_create_issue` sends the figure to the Linear console. A bubble is the first sentence of the explaining task's last message, up to 90 characters, while that message is under a minute old; a talking figure speaks the handoff brief instead. Attention is separate from activity: `stuck` when one of the employee's tasks has waited on approval for more than 30 minutes, otherwise `approval` when a pending proposal on one of its tasks is one this viewer can decide.

**Stations.** `office-stations.ts` places everyone somewhere the room explains. Homes are sticky, drawn from the desk grid the room itself draws, then the lounge and meeting seats, then the near edge, so nobody swaps chairs between renders. No two stations are closer than `MIN_GAP` (0.9). A reviewing figure joins the review lectern queue, up to three deep. A calling figure takes a provider console on the window wall, its own provider's when that one is free, else the next; there are five console slots. A handoff pair takes one of three huddle spots and stands `TALK_GAP` (0.8) apart facing each other, and only when both figures name each other as partner.

**Labels and bubbles.** `office-labels.ts` ranks pills: selected, then attention, then talking, then working or failed, then everybody else. The overlay lifts that further for a hovered, focused or selected pill and for the pinned board note. The collision pass runs highest priority first, lifts a covered pill 20 px at a time up to four steps, and hides whatever is still covered. Bubbles are ranked talking, then attention, then newest, and `placeBubble` opens each one on the side of its figure with room, shifting it 26 px at a time to clear the pills and the other bubble; a pill a bubble covers gives way. `OfficeOverlay` runs this pass at 20 fps, projecting each figure's head to screen space and writing the result straight to the DOM, so a crowded room never re-renders React at frame rate. The Labels control cycles names, dots and off, persisted in `ahq.labels`; phones open on dots.

**Room signals.** The review lectern's tray glows and carries a count when work waits on a person. A figure the floor is waiting on gets a breathing ring at its feet, faster and redder when the wait is stuck. Each connected provider has a console whose bars breathe, and sputter when any connection for that provider is degraded or revoked; the status device does the same with one amber eye. The room dims by up to 35 percent as the workspace approaches its monthly token cap. Every one of these reads a value already in the journal.

**Daylight.** `daylight.ts` interpolates five keyframes (02:00, 08:00, 13:00, 20:00, 21:00) around the clock for the viewer's local hour, producing background, ground, sun, fill and disc colours, a sky height, an interior lamp weight, and a night flag. Hours wrap, so 23:00 blends into the small hours.

**Sound.** `sound.ts` is off until somebody turns it on, because the audio graph can only be created from a user gesture; the preference lives in `ahq.sound`. Sound on adds a quiet pad and three cues, played on activity transitions: a rising pair for a new approval to decide, a settled third for a completed task, one falling tone for a failure.

**Replay.** `components/floors/floor-replay.tsx` rebuilds a finished task from its audit timeline, fetched through `webClient.audit`. `sceneAt` replays the entries up to the scrubber's position through the same `deriveActivities` the live floor uses, so replay shows the recorded work rather than a second animation model. It runs at ten times the recorded pace, and it overrides the scene rather than feeding the subscription, so live work is untouched.

## Personas

A persona is the public character of an employee version: `voice`, up to five `traits` from a fixed ten-word vocabulary in `lib/personas.ts`, and an optional `catchphrase`. Convex normalizes and enforces the limits when a draft is saved (400 characters of voice, 5 traits, 80 characters of catchphrase) and refuses an unknown or duplicate trait, so a persona is never a place to smuggle instructions.

`personaInstructions` turns the persona into one paragraph appended to the session instructions after the operating rules, the floor rules, and the employee version's own instructions. It states the voice, the manner, a catchphrase allowance of at most once per task and never inside tool arguments, and the closing rule that voice never changes what the employee does, what it claims, or which tools it uses. Traits also tune the figure's idle animation in the office. Nothing in a persona widens a capability.

## The mobile design system

One interface serves both viewports; the phone is not a reduced build.

- **Type.** Every size in the stylesheets comes from the `--text-*` tokens. Under 640 px each token below 12 px is lifted to 12 px in one place, so no text on a phone is smaller than that.
- **Targets.** `--tap` is 44 px. Under 640 px it sizes the controls a finger has to hit: icon buttons, primary, secondary and text buttons, navigation items, inputs and selects, list rows and choice labels, overflow menu items, the detail back header, and the floor switcher. Segmented switches and tab strips sit at 38 px.
- **Master and detail.** `MasterDetail` shows both panes on a desktop and one at a time on a phone. `useMasterDetail` pushes a history entry when the detail opens on a phone, so the browser back button returns to the list, and the back header does the same thing.
- **Sheets.** `Sheet` is a bottom sheet on a phone and a side panel on a desktop: focus moves into it, Tab wraps, Escape closes, focus returns to what opened it, the body stops scrolling, a drag past 90 px dismisses it, and the primary action is pinned to its footer.
- **Loading.** `SkeletonList` renders rows shaped like the content that is loading, instead of a spinner in an empty box.
- **Crowded rows.** `OverflowMenu` folds a row's actions into one touchable control where a row of text buttons will not fit.
- **Review.** `ReviewBar` keeps the one thing a person has to do in reach: a bar above the bottom of a phone screen, a banner under the top bar on a desktop, opening a sheet that decides each pending action in place.

`useIsNarrow` answers the same 640 px breakpoint the stylesheets use, for the few places the two layouts need different markup.

## Security

[Security](security.md) holds the threat model, the controls, and the known gaps. In short: `proxy.ts` mints a CSP nonce per request from `lib/server/csp.ts`, so `script-src` needs no `'unsafe-inline'`; anything a provider or another agent wrote is wrapped in `untrustedBlock` before it enters a prompt; state-changing routes require a matching `Origin` and `x-requested-with`; in-process fixed-window rate limits guard the unauthenticated webhook routes, the relay-secret reveal, and starting an OAuth flow; and the gateway and worker refuse to start without a valid `CREDENTIAL_ENCRYPTION_KEY` and a service secret of at least 32 characters.
