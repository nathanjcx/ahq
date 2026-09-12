# Operations

A runbook for a deployment configured with [the deployment guide](deployment.md). It does not replace provider incident procedures, and no restart reverses an external action.

## Service map

| Component            | Role                                                                                                                     | Check                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| Convex               | All state, the job queue, the journal, operational configuration, subscriptions                                          | Convex dashboard deployment and function logs  |
| web                  | Clerk sessions, UI, API routes, OAuth callback, audit unsealing, file downloads, webhooks, sealing administrator secrets | Railway web deployment and `/health`           |
| worker               | Queue jobs, Agents sessions, session monitoring, artifact archive                                                        | Railway worker `/health`                       |
| gateway              | The only MCP server an agent can reach                                                                                   | Railway gateway `/health`                      |
| S3-compatible bucket | Private artifact archive                                                                                                 | Bucket metrics and an authorized file download |

The browser receives live state through Convex subscriptions. The worker reads Agents session events over SSE and writes journal batches to Convex. Sessions run in an OpenAI hosted environment with network access disabled, `connection_origin: "service"` MCP transports, and `multi_agent.enabled: false`.

### The worker is replica-safe

Run as many worker replicas as you need. All coordination is Convex leases, and nothing depends on a replica's local state.

- **Jobs.** `services/queue:claimJobs(workerId, limit)` where the limit is the replica's free job slots, capped at 50 per call. A claim mints a lease token, stored on the job; every later mutation for that attempt must present it, so a second replica cannot complete, renew, or fail the same attempt. The lease lasts 60 seconds and the running job renews it every 20 seconds. At most one job per task is leased at a time; a job for a task with a live lease is pushed out to that lease's expiry.
- **Session streams.** `claimStreams(workerId, limit)` returns tasks whose stream lease is empty, expired, or already this replica's, and stamps a 120 second lease inside the same mutation. Tasks with a pending input job are skipped, because a monitor would race the job that sends the input. The monitor heartbeat is `renewStream` every 40 seconds; a heartbeat that reports another owner aborts the monitor immediately.
- **Slots.** `WORKER_CONCURRENCY` (default 4, bounded 1 to 16) sizes job slots. `WORKER_MONITORS` (default 16, bounded 1 to 64) sizes monitor slots. Claims are sized by free slots, so a replica never takes work it cannot run.
- **Wake signal.** The subscription carries counts and a wake revision only. Workers pull. A Convex cron bumps the revision every minute so due jobs and expired leases are picked up even if a push is missed, and each worker also pulls every 15 seconds.

Health is JSON on `/health`, HTTP 200 while the Convex subscription is live and HTTP 503 otherwise:

```json
{
  "status": "ok",
  "service": "worker",
  "workerId": "…",
  "connected": true,
  "inFlightJobs": 0,
  "activeMonitors": 0,
  "freeJobSlots": 4,
  "freeMonitorSlots": 16,
  "lastClaimAt": 0,
  "lastSubscriptionAt": 0
}
```

`status` is `connecting` before the first subscription update, `ok` once connected, and `stopping` during shutdown. On `SIGTERM` or `SIGINT` the worker stops claiming, unsubscribes, waits up to 30 seconds for in-flight jobs, releases every stream lease so another replica takes the sessions over without waiting the lease out, closes health, and exits. A replica killed without that grace period loses its sessions for at most the remaining 120 seconds of each stream lease; an expired job lease on an approved write is not retried, it is marked uncertain.

## Office signals

The Office page is a reading of the journal, not a separate source of truth. Four signals matter when something looks wrong.

- **The lectern glows and carries a count.** Work is waiting on a person: pending proposals this viewer can decide. Check the Tasks list and the review bar; the count is the same set.
- **A ring breathes under a figure's feet.** That employee has something waiting on a person. A faster, redder ring means an approval has sat undecided for more than 30 minutes. Find out who owns the connection that would execute it.
- **A provider console's bars sputter, and the status device stutters amber.** At least one connection for that provider is `degraded` or `revoked`. Usually an expired grant; see [Expired credentials](#expired-credentials).
- **The room is dimmer than the hour explains.** The workspace is approaching its monthly token cap; at the cap the room is 35 percent darker. Daylight is separate and follows the viewer's local clock.

A furnished but empty room means no live data reached the browser. Check the Convex subscription and `NEXT_PUBLIC_CONVEX_URL` before looking at anything else.

`QA_FIXTURE` must never be set on a deployed service. It is the development-only switch that builds `/qa`, a fake workspace with fake employees, tasks and proposals; without it that route answers 404.

## Routine checks

After a deployment, read the startup logs of all three services. Request `/mcp/<connectionId>` on the gateway without a bearer token and expect HTTP 401 with `reason: "unauthorized"`. Request the gateway's `/health` and expect `{"status":"ok","service":"mcp-gateway"}`.

Then sign in with a test organization, run one read-only task, and confirm the worker claims a job, the gateway lists only the reviewed tools inside the employee's capability, and the Audit tab shows the read. Do not log prompts, credentials, raw MCP responses, or inbox payloads while diagnosing.

## Gateway failure taxonomy

Protocol failures are JSON-RPC errors with a stable `reason` and the request id. Tool failures come back as an MCP result with `isError` and structured content `{ code, reason, message, retryable, requestId }`, because the model has to reason about them. The gateway logs the reason and the request id only.

| Code   | Reason              | HTTP | Retryable | Raised when                                                                                                              |
| ------ | ------------------- | ---- | --------- | ------------------------------------------------------------------------------------------------------------------------ |
| -32001 | `unauthorized`      | 401  | no        | No bearer token, an unknown run token, or the authorization query failed                                                 |
| -32002 | `revoked`           | 403  | no        | The connection is not available to this task, not connected, the grant was revoked, or the task is not on a floor        |
| -32003 | `policy_denied`     | 403  | no        | Tool blocked or outside the capability, outside the resource restriction, or a correction whose read tool is not granted |
| -32004 | `provider_error`    | 502  | yes       | The upstream MCP server failed, or returned an unusable result                                                           |
| -32005 | `approval_required` | 200  | no        | A write became a proposal; informational, not an error                                                                   |
| -32006 | `provider_timeout`  | 504  | yes       | The upstream did not answer in time                                                                                      |
| -32700 | `malformed_request` | 400  | no        | The body is not valid JSON, or the endpoint path is unknown                                                              |
| -32600 | `request_too_large` | 413  | no        | The request body is larger than 1 MB                                                                                     |
| -32602 | `invalid_arguments` | 400  | no        | A required floor tool argument is missing or not a string                                                                |

`policy_denied` and `revoked` raised while authorizing a call are also journaled as denied attempts. A failure to list tools is not, because discovery is not a call attempt.

## Audit trail

Every task has a timeline that merges four sources in time order: session events, messages, tool calls, and proposals with their transitions. The web service unseals it for viewers who can see the task; the Audit tab renders it and exports the same JSON.

Journaled for each tool call: the operation id, the connection, the tool, the outcome (`started`, `succeeded`, `failed`, `denied`), a reason code on failures and denials, the duration, sealed arguments, a sealed result, and the result's SHA-256. An approved write also carries its proposal id and the SHA-256 of the lease token that authorized it, so the ledger shows which attempt dispatched it. Evidence over 50,000 bytes is replaced by its digest, byte count, and a truncation marker; a single field over 100 KB is refused outright.

Denied attempts are journaled with the reason before the refusal reaches the agent, so the timeline shows what was tried and why it was stopped. A terminal outcome cannot contradict a recorded one: a `started` row must exist before a success or failure, its arguments and proposal must match, and a second, different terminal outcome for the same operation is refused.

Sealed evidence is readable only by a service holding `CREDENTIAL_ENCRYPTION_KEY`. Convex holds ciphertext. An entry that cannot be decrypted with the current key is displayed as unavailable rather than dropped.

## Corrections

A correction is a new, separately approved write that compensates for a previous one. What is possible depends on the tool's registry row.

- **Supported.** The registry row has a correction descriptor, so the original proposal captured the record through the audited read tool before the write and stored the version the write returned. Requesting the correction builds a proposal that restores only the configured fields, conditioned on that version. When it is executed, the worker first re-reads the live record through the configured read tool, under the correction's own lease, journaled as `precondition:<proposalId>`. If the version moved, the correction fails cleanly instead of dispatching a write that the provider would reject. One correction per original action; a second is refused.
- **Partial and manual.** No verified conditional operation exists. Requesting a correction creates a correction task for the same employee, on the same floor, with the original action's summary and its stated limits. The employee prepares the safest supported correction or clear manual steps and never repeats the original action.
- **Irreversible and unknown.** The request is refused and the UI shows the reason with no button.

Today the gateway records a write as `supported` when its registry row has a descriptor and as `manual` when it does not. `partial`, `irreversible`, and `unknown` are accepted by the schema and handled by the UI, but nothing currently assigns them.

A correction restores fields. It does not recall notifications, webhooks, downstream automation, or anything a person already read. Do not describe any action as undoable.

Two outcomes are not the same thing:

- **failed** means the write never reached the provider. Nothing changed externally. It is safe to decide again.
- **uncertain** means the request was dispatched and the result is unknown: a timeout, a transport error after dispatch, or a worker lease that expired mid-flight. The proposal and the task both go to `uncertain`, and the write is never retried automatically. Reconcile with provider evidence before doing anything else.

## Usage, not cost

The app records token usage. It stores no dollar figure and shows none.

Each usage report from a session is recorded against the task, in a per-report journal keyed by the report's external id, and in a per workspace, period, and model aggregate: `input`, `cached`, `output`, and a task count. A report with no external id is treated as the session total and takes the maximum rather than adding. The period is the calendar month, `YYYY-MM`. Cache hit rate is `cached / input`. Workspace settings shows usage by model for the current period.

A workspace owner or admin may set an optional monthly token cap on `input + output`. Nothing is reserved: the cap is checked when new work is accepted, and it refuses task creation, follow-up messages, and inbox assignment once the period's recorded usage has reached it. Accepting a handoff and creating a correction task are not checked, so a capped workspace can still finish and unwind work in flight. An in-flight task can overshoot the cap by its own usage. A cap of 0 means no cap.

Upstream charges are separate from all of this: OpenAI model and hosted-session charges, Railway compute, egress and storage, and any provider's own fees. Missing upstream usage is unknown, not zero.

## Expired credentials

When a refresh fails with an authorization error, the provider has revoked or expired the grant. The connection is marked `degraded` with `Authorization expired. Reconnect this integration to continue.`, and the agent's call fails with `revoked`. The owner reconnects from Integrations, which runs OAuth again and restores `connected`. Tasks needing that connection stay blocked until then.

Reconnecting never widens access beyond the registry: allowed tools are recomputed as the intersection of the tools discovered on the server and the non-blocked rows in the registry. That recomputation resets a narrowed tool list back to the full intersection, so an owner who had switched tools off must switch them off again on Manage access. The resource restriction, inbox resources, sharing, and relay secret are preserved.

## Secret rotation

`CREDENTIAL_ENCRYPTION_KEY` now seals four kinds of stored secret plus the audit journal:

1. Provider credentials on each connection.
2. OAuth client secrets in the provider configuration.
3. Native inbox signing secrets in the provider configuration.
4. Each connection's inbox relay secret.
5. Tool-call arguments and results in the audit trail, and the short-lived OAuth state cookie.

The code reads exactly one key. `credentialKeyVersion` is stored on a connection but the unseal path ignores it, so there is no dual-key reader: whatever is not re-sealed becomes unreadable the moment the key changes. Either write a migration that reads the old key and re-seals with the new one before swapping, or accept the manual path and re-establish each secret in this order:

1. Pause webhook delivery at the providers and stop approving writes.
2. Swap the key on web, worker, and gateway together. They must never run with different keys.
3. Re-enter each OAuth client secret and each native inbox secret on the Operations page. Re-entering seals under the new key, and the provider-side value does not change.
4. Rotate every connection's relay secret from Manage access, and give the new value to each relay. Rotation generates a new secret and seals it under the new key.
5. Have each connection owner reconnect, which re-seals the provider credential. Until then those connections fail with an authorization error.
6. Resume delivery and approvals, and confirm one read task and one signed test delivery.

Audit evidence written under the old key stays sealed. It is shown as undecryptable rather than lost, which is the reason to prefer the migration over the manual path.

Rotate `AHQ_SERVICE_SECRET` by updating Convex and all three services in the same window, then run a task and the health checks. Keep `OPENAI_API_KEY` on the worker, `CLERK_SECRET_KEY` on the web service, and S3 keys on web and worker.

## Failure guide

Provider configuration lives in Convex, so most of these are answered on the Operations page rather than in a variable.

- **Sign-in fails.** Compare `APP_URL`, the Clerk keys, and `CLERK_JWT_ISSUER_DOMAIN` in Convex. An empty dashboard usually means the browser bundle has the wrong `NEXT_PUBLIC_CONVEX_URL`, or the signed-in organization has no workspace yet.
- **Operations page is missing or read-only.** The signed-in Clerk user ID must be in `PLATFORM_ADMIN_USER_IDS` in both Convex and the web service. Convex rejects the queries otherwise, and the web routes that seal secrets reject the writes.
- **A provider cannot be connected.** The readiness card names the first missing item: no enabled server, no OAuth client covering an enabled server, no reviewed tool, or no native inbox secret. `This MCP server is not enabled by your administrator` means the URL is not ticked; `Sign-in for this server is not set up yet` means no client covers it; `None of the tools on this server are in the reviewed tool registry yet` means every discovered tool is blocked or absent.
- **OAuth returns an error.** Check the callback is exactly `https://<web-origin>/api/integrations/callback`, that `APP_URL` matches the origin the user is on, and that the client id, secret, and scopes on Operations match the provider. A second consent prompt for one product of a multi-product provider means the client's scopes do not cover that product.
- **Discovery works but a call is refused.** Read the reason in the Audit tab. `policy_denied` points at the registry row's mode, the employee capability, or the resource restriction. A non-empty restriction also requires a `resourceArgument` on the registry row; without one the gateway refuses rather than guessing which argument names the resource.
- **A write is stuck awaiting approval.** Only the owner of the connection that would execute it, or a workspace owner or admin, can decide it. The creator of a task borrowing someone else's shared connection cannot.
- **Webhooks return 404.** The native endpoint 404s for an unknown provider path and for a provider whose inbox secret is not set. The relay endpoint 404s when the connection has no relay secret; rotate it once from Manage access to create one.
- **Artifacts are missing.** Check the S3 endpoint, region, bucket, and key permissions on both web and worker. Files over 25 MB and files past the 100-file limit are skipped with a journal entry, not silently.
- **Jobs sit leased.** Look for a stale replica before touching the queue. Expired leases are recovered on the next claim pass: ordinary commands are requeued, an approved write is not, because its outcome is unknown.

## Safe deploy and rollback

Deploy Convex functions first, then the three services on the same commit with matching variables. Verify the health endpoints and one read-only task before approving a write.

To roll back, stop new dispatch, let active writes settle, and reconcile every uncertain action with provider evidence. Then restore the previous release and its variables. Provider configuration is data and does not roll back with the code; a schema change that alters `providerConfigs` or `registryTools` needs its own plan.

## References

- [OpenAI Agents sessions](https://developers.openai.com/api/docs/guides/agents-api/sessions)
- [OpenAI Agents events and items](https://developers.openai.com/api/docs/guides/agents-api/sessions/events)
- [Convex deployment settings](https://docs.convex.dev/dashboard/deployments/deployment-settings)
- [Railway healthchecks](https://docs.railway.com/deployments/healthchecks)
- [Railway variables](https://docs.railway.com/variables)
