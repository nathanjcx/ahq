# Operations

This runbook describes the running web migration. It assumes the services were configured using [the deployment guide](deployment.md). It does not replace provider incident procedures or claim that a restart reverses an external action.

## Service map

| Component            | Role                                                                            | Check                                                   |
| -------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Convex               | Authenticated workspace data, queue, journal, marketplace, and subscriptions    | Convex dashboard deployment and function logs           |
| web                  | Clerk sessions, UI, API routes, OAuth callback, file authorization, inbox relay | Railway web deployment and `/`                          |
| worker               | Queue leases, Agents sessions, SSE recovery, artifact archive                   | Railway worker `/health`                                |
| gateway              | Bearer authenticated MCP discovery and calls                                    | Railway gateway `/health`                               |
| S3-compatible bucket | Private artifact archive                                                        | Provider bucket metrics and an authorized file download |

The browser receives live state through Convex subscriptions over WebSocket. It does not poll the worker. The worker reads OpenAI Agents session events over SSE and writes journal batches to Convex. An Agents session uses an OpenAI hosted environment with network access disabled, `connection_origin: "service"` MCP transports, and `multi_agent.enabled: false`. Agent-originated calls use the gateway. Web connection discovery and approved worker writes use the same MCP client and admission policy.

## Routine checks

After each deployment, check the web, worker, and gateway logs for startup errors. Request `/mcp/<connectionId>` without credentials and expect rejection. Request `/health` with a normal HTTP client and expect `{"status":"ok","service":"mcp-gateway"}`. The worker reports `connecting` with HTTP 503 until its Convex subscription is live, then reports `ok`.

Sign in with a test Clerk organization and open the dashboard. Confirm that the live workspace query updates after creating a test task. Run one read-only task and check that the worker claims a job, the Agents session has the expected model and task metadata, the gateway lists only the selected tools, and the UI receives events. Do not log prompts, credentials, raw MCP responses, or full inbox payloads while diagnosing the run.

## Task recovery

The worker leases jobs and renews the lease every 20 seconds. If it exits, Railway restarts it. On startup it subscribes to Convex again and monitors active sessions. When the Agents event stream disconnects, it reconnects with backoff and reconciles saved session items. It records a gap marker when intermediate events could not be replayed. A reconnect must never be treated as permission to repeat a provider write.

The worker watchdog cancels a turn after `MAX_TURN_SECONDS`, which defaults to 900 seconds and is bounded to 60 through 3600. Cancellation stops new dispatch, but a request already sent to a provider may have an unknown result. Mark that task outcome uncertain and reconcile with provider evidence before retrying. Restarting a service does not undo provider effects.

If the worker is down, keep the web and gateway available only if that is useful for inspection. Do not approve new writes while there is no worker to record the dispatch result. Check Convex queue depth and leases, worker logs, the worker health endpoint, the OpenAI API status, and S3 access. If jobs remain leased past the lease timeout, inspect for a stale worker before making any manual queue change. The scheduled queue wakeup reclaims expired leases automatically.

## Approval and correction

The gateway turns write tools into immutable action proposals. The UI must show the normalized target, arguments, captured version when available and the correction limit. A reviewer approves the exact proposal. The executor rechecks the task, connection, employee capability, resource scope, version, and expiry before dispatch.

The action ledger distinguishes succeeded, failed, outcome unknown, and correction states. If a dispatch times out, stop dependent work and reconcile using the provider. Do not blindly retry a non-idempotent operation. A correction may restore selected fields only when the provider and tool supply a verified conditional operation. It may be manual, partial, or unavailable. There is no universal undo for messages, notifications, workflow side effects, or files copied outside the application.

## Inbox relay

The webhook endpoint is `POST /api/webhooks/inbox/<connectionId>`. A relay signs the exact raw JSON body with the connection's secret:

```text
hex(HMAC-SHA256(secret, timestamp + "." + rawBody))
```

Send the Unix timestamp in `x-ahq-timestamp` and the hex digest in `x-ahq-signature`. The timestamp must be within five minutes. The body accepts no more than 100 normalized items and an optional cursor. The endpoint has no provider subscription management. Operators must configure each provider's relay, watch, or Pub/Sub path separately and filter events to the connection owner before signing.

To rotate a relay secret, pause delivery, deploy the new value in `INBOX_WEBHOOK_SECRETS_JSON`, update the relay with the same value, then resume delivery and send a signed test item. Each connection accepts one secret at a time. A connection ID is a Convex identifier, so do not guess it or reuse one across accounts.

## Secrets and rotation

Store secrets in Railway sealed variables or an equivalent secret manager. Keep `OPENAI_API_KEY` on the worker only, `CLERK_SECRET_KEY` on the web service only, and S3 keys on the web and worker services. Web, worker, and gateway share `CREDENTIAL_ENCRYPTION_KEY` to seal credentials and audit evidence or unseal credentials for MCP calls. Keep `AHQ_SERVICE_SECRET` identical across the web, worker, gateway, and Convex deployment.

To rotate `CREDENTIAL_ENCRYPTION_KEY`, first add a migration that can read the old key and re-seal credentials with the new key. Deploy that reader, re-seal every stored credential, verify a read-only provider call, then remove the old key. Do not replace the key first, because existing ciphertext would become unreadable. Rotate `AHQ_SERVICE_SECRET` by updating Convex and all Railway services together during a quiet window, then run a task and health checks.

## Costs and limits

The app reserves a default amount per task before dispatch: Luna `$0.25`, Terra `$1`, Sol `$2`, and Astra `$5`. The worker estimates usage from token counts using the model rates in `lib/server/agents.ts`. The estimate includes input, cached input, and output token rates, but excludes large-context premiums and separate hosted or tool charges. It is a budget control and usage estimate, not a guaranteed OpenAI invoice.

OpenAI API and hosted-session charges are separate from Railway compute, egress, and storage charges. Provider services may have their own plans or usage fees. Set workspace budgets and task reservation overrides conservatively, then compare the journal estimate with the provider billing consoles. Missing upstream usage remains unknown rather than zero.

## Failure guide

If sign-in returns a configuration error, compare `APP_URL`, the Clerk publishable and secret keys, organization membership, and `CLERK_JWT_ISSUER_DOMAIN` in Convex. If the dashboard is empty, check that the browser was built with the correct `NEXT_PUBLIC_CONVEX_URL` and that the signed-in organization has a workspace.

If a connection is rejected, compare its URL byte for byte with `MCP_SERVER_URLS_JSON` in Convex. For custom ServiceNow endpoints, also check `MCP_APPROVED_HOSTS`, HTTPS, DNS, and the standard port. If discovery works but a task cannot call a tool, inspect the employee capability, connection allowed tools, `MCP_TOOL_POLICIES_JSON`, and the resource scope. A non-empty restricted scope requires a configured resource argument and matching permitted IDs.

If OAuth returns to an error, check the exact callback URI, provider client, `APP_URL`, `MCP_OAUTH_CONFIG_JSON`, consent audience, and provider scopes. If a Google connection works for reads but a push inbox is empty, configure the external watch and relay. Connecting MCP does not create that subscription.

If artifacts fail, check S3 endpoint, region, bucket, key permissions, and object size. The worker archives completed session files at or below 25 MB, up to 100 files per task. Previously archived files are not downloaded again. If a file is missing, preserve the task record and inspect the bucket key and worker log without printing the file.

## Safe deploy and rollback

Deploy Convex functions first, then deploy the three Railway services with the same commit and matching environment. Verify health endpoints and a read-only task before approving a write. If a deployment fails, inspect the new service logs and healthcheck result. Railway's healthcheck is a startup gate, not continuous monitoring.

For rollback, stop or disable new task dispatch, wait for active writes to settle, and reconcile any outcome-unknown actions with provider evidence. Restore the last known application release and compatible environment variables. A code rollback changes the application; it cannot reverse a provider write or a file already downloaded by a user.

## References

- [OpenAI Agents sessions](https://developers.openai.com/api/docs/guides/agents-api/sessions)
- [OpenAI Agents events and items](https://developers.openai.com/api/docs/guides/agents-api/sessions/events)
- [OpenAI observability and usage](https://developers.openai.com/api/docs/guides/agents-api/observability)
- [Convex deployment settings](https://docs.convex.dev/dashboard/deployments/deployment-settings)
- [Railway healthchecks](https://docs.railway.com/deployments/healthchecks)
- [Railway variables](https://docs.railway.com/variables)
