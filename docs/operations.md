# Operations

A runbook for a deployment configured with [the deployment guide](deployment.md). It does not replace
provider incident procedures, and no restart reverses an external action. The shape of the system is
in [architecture](architecture.md).

## Service map

| Component            | Role                                                                                        | Check                                          |
| -------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Convex               | Every table, the job queue, the journal, the schedule, the crons, subscriptions             | Convex dashboard deployment and function logs  |
| web                  | Clerk sessions, the UI, API routes, OAuth callback, webhooks, alert intake, sealing secrets | Railway web deployment and `/health`           |
| worker               | Queue jobs and turns, Agents sessions, session monitoring, artifact archive                 | Railway worker `/health`                       |
| gateway              | The only MCP server an agent can reach                                                      | Railway gateway `/health`                      |
| S3-compatible bucket | Private artifact archive                                                                    | Bucket metrics and an authorized file download |

Sessions run in an OpenAI hosted environment with network access disabled,
`connection_origin: "service"` MCP transports, and `multi_agent.enabled: false`.

## Configuration

Operational configuration is data in Convex, edited on the Operations page by platform
administrators. Environment variables are for bootstrap trust and tunables.

| Variable                                                     | Where                        | Notes                             |
| ------------------------------------------------------------ | ---------------------------- | --------------------------------- |
| `AHQ_SERVICE_SECRET`                                         | Convex, web, worker, gateway | At least 32 characters            |
| `CREDENTIAL_ENCRYPTION_KEY`                                  | web, worker, gateway         | 32 bytes, base64; never in Convex |
| `OPENAI_API_KEY`                                             | worker                       |                                   |
| `MCP_GATEWAY_URL`                                            | worker                       | Base URL the sessions call        |
| `APP_URL`, Clerk keys, `CLERK_JWT_ISSUER_DOMAIN`             | web, Convex                  |                                   |
| `NEXT_PUBLIC_CONVEX_URL`, `CONVEX_URL`                       | browser, services            |                                   |
| `PLATFORM_ADMIN_USER_IDS`                                    | web and Convex               | Must match in both                |
| `WORKER_CONCURRENCY` (4, 1–16), `WORKER_MONITORS` (16, 1–64) | worker                       | Slot pools                        |
| `MAX_TURN_SECONDS`                                           | worker                       | Wall-clock bound on one turn      |
| S3 endpoint, region, bucket, keys                            | web, worker                  |                                   |
| `QA_FIXTURE`                                                 | never on a deployment        | Builds `/qa` and `/office-lab`    |

Per-provider configuration — enabled server URLs, OAuth clients, the native inbox secret — lives in
`providerConfigs`; the reviewed tool registry and its policy live in `registryTools`. Each connection
carries its own sealed relay secret. Each workspace carries its own sealed alert-intake secret.
Secrets entered in the browser go to a web route that seals them before Convex sees them; afterwards
the page shows only whether one is set.

## Workspace settings

One row per workspace (`workspaceSettings`), read through `settingsFor`. Until an administrator saves
it, a workspace answers with these defaults (`defaultWorkspaceSettings` in `lib/contracts/plan.ts`,
timezone `UTC`). `schedule:updateSettings` writes every field at once, so a partial write can never
leave the hours inconsistent, and only a workspace owner or admin may call it.

| Field                                   | Default                                                                   | Meaning                                                     |
| --------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `timezone`                              | `UTC`                                                                     | Must be a zone this runtime knows                           |
| `workingDays`                           | `[1,2,3,4,5]` (Monday–Friday, 0 is Sunday)                                | At least one day                                            |
| `startHour` / `endHour`                 | 9 / 18                                                                    | Whole local hours; the end must be after the start          |
| `attendedStartHour` / `attendedEndHour` | 9 / 18                                                                    | Must sit inside working hours                               |
| `overnightPolicy`                       | `audits_only`                                                             | `off`, `audits_only`, or `cheap`                            |
| `dailyTokenCap`                         | 0 (no cap)                                                                | Input plus output recorded today; stops the planner         |
| `triageAllowance`                       | 500,000                                                                   | Today's triage tokens; triage stops here and nowhere else   |
| `memoryBudgets`                         | workspace 2,000, project 3,000, floor 4,000, agent 1,500, summaries 1,500 | Estimated tokens per section                                |
| `hiringPolicy`                          | `anyone`                                                                  | `anyone`, `admins`, or `approval`                           |
| `auditPolicy`                           | `soft`                                                                    | `soft` leads the day with findings; `hard` holds other work  |
| `triageRules`                           | empty                                                                     | GitHub labels or keywords that make a delivery an alert     |
| `triageAllowList`                       | empty                                                                     | Tools a triage run executes without a proposal              |
| `emergencyAllowList`                    | empty                                                                     | Tools the emergency rule admits                             |
| `notificationChannels`                  | `['in_app']`                                                              | `in_app`, `push`, `slack`, `email`                          |
| `plan`                                  | `subscription`                                                            | `subscription` or `byok`                                    |
| `monthlyAllowance`                      | 0                                                                         | Tokens per period on a subscription                         |
| `maxConcurrentInstances`                | 4                                                                         | Worker instances, and the planner's free slots              |
| `rates`                                 | empty                                                                     | Per-model input, cached, output rates for a BYOK estimate   |
| `standards`                             | empty                                                                     | The copy and code standard the auditor reads as instruction |

**Hours.** `isWorkingTime` decides whether the planner runs ordinary work. `isAttendedTime` decides
whether a person is expected to be reachable, which is the gate on the emergency allow-list. Both are
pure and take the zone explicitly (`lib/time.ts`), so the planner, Convex, and the browser answer the
same question the same way; DST is resolved in two passes so an hour lands on the real instant.

**Overnight.** Outside working hours the policy decides what runs at all. `off` runs nothing: no
shifts, no nightly audit, no curation. `audits_only` runs the reserved nights — the audit pass and the
janitor's curation — and no work. `cheap` adds work shifts on each instance's `overnightModel`. An
incident is exempt from all three: triage and its pages run whatever the hour, because that is what a
night is for.

**Findings.** Under `soft`, an instance with open findings takes them first that day and its other
work follows. Under `hard` it runs only the shift that clears them: no second task, no review shift,
no preparation turn, and `tasks:create` refuses it new work until the findings are addressed, with
"audit policy holds its other work". Reserved staff are exempt, or the audit and triage runs that
clear a finding could never run.

**Caps.** `dailyTokenCap` stops everything except triage on the next tick. `triageAllowance` stops
triage. The workspace's older `monthlyTokenCap` still refuses new task creation, follow-up messages,
and inbox assignment for the calendar month. Nothing is reserved, so in-flight work overshoots by its
own usage.

**Plan and cost.** Usage stays token-based. `plan.projection` reports tokens used this period, the
share of `monthlyAllowance` a projection would consume, and — on `byok`, once rates exist — an
estimate. Projected tokens carry no model, so they are priced at the dearest configured rate and the
estimate never reads lower than the work will be. Models with recorded usage and no rate come back in
`unpricedModels` so the interface can say the estimate is incomplete.

**Hiring.** `anyone` lets any member hire. `admins` refuses a member outright. `approval` files a
`hireRequests` row an owner or admin decides. Hiring takes a count of 1 to 20 and refuses to push the
worker-instance total past `maxConcurrentInstances`.

**Allow-lists.** Both triage lists are checked against the reviewed registry when they are saved: a
name that is not a non-blocked `registryTools` row is refused, so a typo cannot silently widen or
narrow what triage may do. Lists hold at most 50 entries.

## Alert intake

Three ways an alert reaches a workspace. All three go through `ingestAlert`, which deduplicates on
fingerprint: a repeat bumps `occurrences` on the open alert and changes nothing else.

**Signed webhook.** A workspace owner or administrator sets the workspace's alert secret. The web
route seals the plaintext and calls `services/triage:setAlertSecretForActor`, which decides the role
from the caller's own Clerk claims; passing no ciphertext clears the secret and closes the endpoint.
`triage:intake` reports whether a secret is set and when it last changed, and never the secret itself.
Senders post to `/api/alerts` with:

```text
POST https://your-web-origin.example.com/api/alerts
x-astra-workspace: <workspaceId>
x-astra-timestamp: <unix-milliseconds>
x-astra-signature: hex(HMAC_SHA256(secret, timestamp + "." + rawBody))
```

The body is `{ source, fingerprint, severity, title, detail, url?, floorIds? }`; `severity` is `low`,
`medium`, `high`, or `critical`, `url` must be HTTPS, and `detail` is capped at 10,000 characters.
The timestamp must be within five minutes and the body at most 100 KB. Unsigned traffic is metered by
sender address; the workspace's own limit of 120 per window is charged only once the signature
verifies, so nobody can spend a workspace's allowance from outside. An exact replay inside the window
is answered from the first result rather than opening a second incident. A new `high` or `critical`
alert records and delivers one page to every reachable person; outside attended hours the scheduler
keeps paging from there. The response is `{ accepted: true, alertId, duplicate }`.

**GitHub.** The existing native webhook at `/api/webhooks/native/github` also feeds triage: the
delivery is matched against each following workspace's `triageRules`, case-insensitively, against the
issue or pull-request labels, the title, and the body or comment. A match opens a `high` alert
fingerprinted `github:<owner/name>#<number>`. Without rules, nothing is an alert.

**Gmail.** Mail arriving through the relay for a `google-workspace` connection enqueues
`email_classify` at most once an hour. The classifier turn has no tools at all, reads at most twenty
unchecked items, and answers with one JSON object. Items it is not confident about are left unchecked
for the next run rather than silently marked.

## Notifications

`services/notifications:attempt` records one row per reachable subject before anything is sent, then
the caller delivers them. Reachable means the owner of a personal workspace plus everyone who created
a floor or a project here; Convex has no membership list of its own.

One page reaches every subject at once, and the rows of that batch share their `sentAt`. The emergency
rule counts pages, not rows, so a workspace with three people is three people paged once rather than
three attempts on the ledger.

An attempt counts only once a channel reports delivery, and the first channel that lands marks the
row. Channels are tried in the order `push`, `slack`, `email`, `in_app`, whatever order the workspace
listed them, so a real transport is tried before the database row that always lands.

**The in-app row does not count toward the emergency rule.** It always lands, whether or not anybody
looked at it, so it says nothing about whether a person was told. Only `push`, `slack`, or `email`
delivery advances the ledger, and Settings refuses to save a non-empty emergency allow-list unless one
of those three is among the workspace's channels. A workspace whose only channel is `in_app` can still
be paged; its emergency allow-list simply stays shut, which is the safe side.

`push` is Web Push through the `web-push` package. It needs three environment variables on the worker
and the web service — `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` (a `mailto:`
address or your origin, which is how a push service reaches you about your own notifications).
Generate the pair once with `npx web-push generate-vapid-keys` and keep the private key out of the
browser. Without all three, push is off and says so in the log. Subscriptions are stored with their
keys sealed; an endpoint that answers 404 or 410 is deleted rather than retried.

A subject may register at most ten browsers, and an endpoint is resolved through the same
public-address-only rule every other outbound request uses: an endpoint that names a literal address
or resolves inside this network is refused rather than posted to.

`slack` and `email` deliver nothing: they are connector stubs that log that they are not configured
and report no delivery. A workspace that lists only those channels never records a delivered
attempt, which means the emergency rule never opens for it. Listing one of them satisfies the
Settings check above, because the check reads the workspace's intent; the ledger still only counts
what a transport actually delivered.

Acknowledging a notification — `/api/notifications/<id>/ack` or `notifications:acknowledge` — is what
the emergency rule counts as an answer.

## Triage authority

A triage run's provider tools are decided per call by the gateway from `services/triage:authority`:

- The **triage allow-list** is always open to a triage task. Those tools execute without a proposal.
- The **emergency allow-list** opens only when the clock is outside attended hours _and_ three
  delivered, unacknowledged pages for that alert stand _and_ the first of them is at least twenty
  minutes old. A page is one round of paging, however many people it reached, and it counts only if a
  real transport delivered it to at least one of them. Pages count from the first that still stands,
  not over a rolling window, so the count grows while nobody answers and never oscillates.
- Both are recomputed on every call. A person acknowledging a page between discovery and use closes
  the emergency list again mid-incident: every page sent before the answer is spent, the count starts
  again from zero, and the scheduler stops paging that incident.
- Every emergency call is journaled with started and terminal outcomes against the connection it
  used, and the tool result instructs the agent to verify the fix and call `file_incident_report`
  before the run ends.
- A run that used the emergency list and filed no report gets one filed for it: `closeRun` writes a
  placeholder marked `missing` in the instance's name and posts an escalation to the workspace
  channel. Watch the workspace channel for `Escalation:` lines. The report has to be newer than the
  call it answers for, so a second emergency action in a later run needs a report of its own.
- Triage writes only through connections shared with the workspace. A member's `private` connection is
  never used, however the allow-lists are set.

The pages are the scheduler's, not the worker's: outside attended hours each five-minute tick plans a
`page_alert` for every open, unanswered incident, re-paging every seven minutes until three pages have
been sent, delivered or not. A triage run's job key carries the ledger it was briefed with and whether
the emergency gate was open for it, so a page that lands or a gate that opens plans a fresh run with
the tools that go with it, while an incident whose run is still queued is left alone. Merging and
deploying inside attended hours need a person, as ordinary proposals.

## The crons

| Cron                      | Interval  | What it does                                                         |
| ------------------------- | --------- | -------------------------------------------------------------------- |
| `maintenance:wakeWorkers` | 1 minute  | Bumps the wake revision so due jobs and expired leases are picked up |
| `services/schedule:tick`  | 5 minutes | Hands every workspace to a tick of its own                           |

The tick itself reads nothing but the list of workspaces and schedules one
`services/schedule:tickWorkspace` per workspace, because Convex's read limits are per transaction and a
few busy workspaces would otherwise stop the whole deployment from being scheduled. Each workspace's
own tick reads at most 500 tasks, entries, alerts, and proposed claims. It creates the reserved
janitor, auditor, and triage staff on first run, opens the night's audit task after hours, and prepares
meetings at the lead. It enqueues; it never runs a turn. Every job it inserts carries a unique key, so
a repeated tick is a no-op.

## The worker

Replica-safe by construction; all coordination is Convex leases.

- **Jobs.** `services/queue:claimJobs(workerId, limit)`, limit sized by free slots, capped at 50 per
  call. A claim mints a lease token stored on the job; every later mutation for that attempt must
  present it. The lease lasts 60 seconds and is renewed every 20. At most one job per task is leased.
- **Session streams.** `claimStreams` returns tasks whose stream lease is empty, expired, or already
  this replica's, and stamps a 120-second lease in the same mutation. `renewStream` every 40 seconds
  is the heartbeat; a heartbeat reporting another owner aborts the monitor.
- **Slots.** `WORKER_CONCURRENCY` sizes job slots, `WORKER_MONITORS` monitor slots.
- **Wake signal.** The subscription carries counts and a revision only. Workers pull, and also pull
  every 15 seconds.
- **Shutdown.** On `SIGTERM` or `SIGINT` the worker stops claiming, unsubscribes, waits up to 30
  seconds for in-flight jobs, releases every stream lease, and exits.

Health is JSON on `/health`, HTTP 200 while the Convex subscription is live and 503 otherwise, with
`status`, `workerId`, `connected`, `inFlightJobs`, `activeMonitors`, free slots, and last claim time.

## The gateway

One process, `createGateway({ backend })`, so the same code runs against Convex in production and
`convex-test` in the harness. `/health` answers `{"status":"ok","service":"mcp-gateway"}`. Every
other request is `/mcp/<segment>` with the task run token as bearer:

- An internal segment (`floor`, `memory`, `shift`, `audit`, `triage`, `janitor`) is checked against
  the role matrix before anything else, and again on every tool call.
- Any other segment is matched against this task's own connection ids.
- An unknown token and an unreachable authorization query are both `unauthorized`; the gateway fails
  closed.

Failures use a fixed taxonomy. Protocol failures are JSON-RPC errors with a stable `reason` and the
request id. Tool failures come back as an MCP result with `isError` and
`{ code, reason, message, retryable, requestId }`.

| Code   | Reason              | HTTP | Retryable | Raised when                                                                  |
| ------ | ------------------- | ---- | --------- | ---------------------------------------------------------------------------- |
| -32001 | `unauthorized`      | 401  | no        | No bearer token, an unknown run token, or the authorization query failed     |
| -32002 | `revoked`           | 403  | no        | Connection not available, not connected, grant revoked, or no floor          |
| -32003 | `policy_denied`     | 403  | no        | Blocked tool, outside the capability or the role, outside the resource scope |
| -32004 | `provider_error`    | 502  | yes       | The upstream MCP server failed or returned an unusable result                |
| -32005 | `approval_required` | 200  | no        | A write became a proposal; informational                                     |
| -32006 | `provider_timeout`  | 504  | yes       | The upstream did not answer in time                                          |
| -32700 | `malformed_request` | 400  | no        | Body is not valid JSON, or the endpoint is unknown                           |
| -32600 | `request_too_large` | 413  | no        | Body larger than 1 MB                                                        |
| -32602 | `invalid_arguments` | 400  | no        | A required tool argument is missing or the wrong type                        |

`policy_denied` and `revoked` raised while authorizing a call are journaled as denied attempts.
Discovery is not a call attempt, so a failure to list tools is not journaled. Logs carry the reason
and the request id only, never arguments, prompts, or provider content.

## Corrections and outcomes

A provider write becomes a proposal with its arguments hash, the policy's correction level, and —
where the registry row has a correction descriptor — a `beforeState` read through the audited read
tool. Approval enqueues one execute job that rechecks the lease, grant, and scope, dispatches once,
and records `afterState`. A correction restores the configured fields conditioned on the captured
version, re-reading the live record first under its own lease; if the version moved it fails cleanly.
One correction per original action. Manual and partial corrections become tasks; irreversible and
unknown are refused with the reason.

- **failed** means the write never reached the provider. Nothing changed externally.
- **uncertain** means it was dispatched and the outcome is unknown. It is never retried
  automatically. Reconcile against provider evidence before anything else.

A triage write under the allow-list is the one path where an agent's write reaches a provider without
a proposal. It is journaled identically, and the emergency case says so in the result.

## What to watch

- **Jobs sit queued.** Look at the tick first: it is the only thing that enqueues a shift. Confirm
  the workspace has working hours now (`schedule:summary` answers `working` and `attended`), that the
  daily token cap is not reached, that free slots are not zero, and that the tasks are `daily` with
  their dependencies complete.
- **Jobs sit leased.** Look for a stale replica before touching the queue. Expired leases are
  recovered on the next claim pass: ordinary commands are requeued, an approved write is not, because
  its outcome is unknown.
- **A task sits `waiting`.** Its dependencies have not all completed. It should still take one review
  shift per working day; if it does not, check that the dependency ids resolve inside the workspace.
- **A task sits `blocked`.** A dependency failed or was cancelled; the reason is on `task.error`.
  Requeue it deliberately once the dependency is settled.
- **A shift never ends.** `closeShift` is idempotent and returns the existing report; a shift row with
  no `endedAt` means the turn died before the worker could close it. The next tick will not start
  another shift for that task that day, because `uniqueKey` is per task per date.
- **Reports all read `inferred`.** The turns are not calling `submit_report`. Check that the session
  is getting `astra_shift` — a non-work, non-meeting task still gets it, a reserved kind does not.
- **Contested memory.** A contested claim reaches no model and stays until a person resolves it in
  `memory:resolveContest`, which acts on both sides of the conflict at once. The question is posted in
  the channel of the scope it was filed against.
- **A finding will not close.** `verifyFindings` only verifies an `addressed` finding whose task has a
  later report naming the finding id. A finding with no task never verifies; an administrator
  escalates it instead.
- **Replanning.** `projects:replan` sends a project back to `planning`, drops the stale proposal, and
  enqueues a fresh `plan_project`. Work already created stays. Nothing changes until a person confirms
  the new roadmap.
- **Office signals.** The lectern's tray glows and carries a count when work waits on a person; a ring
  breathes under a figure the floor is waiting on, faster and redder past 30 minutes; a provider
  console sputters when one of that provider's connections is degraded or revoked; the room dims as
  the workspace approaches its monthly token cap. A furnished but empty room means no live data
  reached the browser — check the Convex subscription and `NEXT_PUBLIC_CONVEX_URL` first.

## Recovering

**Expired credentials.** A refresh that fails with an authorization error marks the connection
`degraded` and the agent's call fails `revoked`. The owner reconnects from Integrations. Reconnecting
recomputes allowed tools as the intersection of what the server offers and the non-blocked registry,
which resets a narrowed tool list; the resource restriction, inbox resources, sharing, and relay
secret are preserved.

**Secret rotation.** `CREDENTIAL_ENCRYPTION_KEY` seals provider credentials, OAuth client secrets,
native inbox secrets, each connection's relay secret, each workspace's alert secret, push
subscription keys, and the audit journal. The code reads exactly one key, so rotating without a
migration makes everything not re-sealed unreadable. Either migrate, or: pause delivery and
approvals; swap the key on web, worker, and gateway together; re-enter every OAuth client secret,
native inbox secret, and alert secret; rotate every relay secret; have each owner reconnect; resume
and confirm with one read task and one signed test delivery. Audit evidence written under the old key
shows as undecryptable rather than being dropped. Rotate `AHQ_SERVICE_SECRET` across Convex and all
three services in one window.

**Rolling back.** Stop new dispatch, let active writes settle, and reconcile every uncertain action
against provider evidence. Then restore the previous release and its variables. Provider
configuration and workspace settings are data and do not roll back with the code; a schema change
touching `providerConfigs`, `registryTools`, or `workspaceSettings` needs its own plan. Deploy Convex
functions first, then the three services on the same commit.

## Known gaps

- Slack and email notification channels deliver nothing; see [Notifications](#notifications).
- There is no interface yet for the schedule, the policies, the allow-lists, the standards text, or
  memory administration: `schedule:updateSettings`, `memory:*`, `triage:setRules`, and the rest exist
  as Convex functions with no page behind them (page lands with phase four). Until then they are set
  through the Convex dashboard or a script.
