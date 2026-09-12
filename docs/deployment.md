# Web deployment

This guide is for the web migration as of September 11, 2026. Follow the sections in order. The service configuration is ready to review, but this document does not claim that an account has been created, a provider has been connected, or a Railway deployment has completed.

## 1. Preserve the demo and choose the source

Before touching a production deployment, verify the preserved demo branch:

```sh
git fetch origin
git show origin/demo:package.json >/dev/null
git rev-parse origin/demo
```

The expected commit is `110d2ba`. If `origin/demo` does not exist, create it from that commit and push it once:

```sh
git branch demo 110d2ba
git push origin demo
```

Do not overwrite an existing `demo` branch. Deploy `main` after the migration is merged. Do not run a seed function or import demo data into the production Convex deployment.

## 2. Create Convex and Clerk first

Create a Convex project and a production deployment. The repository's `convex/auth.config.ts` expects Clerk's Frontend API URL in `CLERK_JWT_ISSUER_DOMAIN` and uses `applicationID: "convex"`. Convex documents this issuer setup in [its Clerk guide](https://docs.convex.dev/auth/clerk).

In Clerk:

1. Create a production application and copy its `pk_live_` publishable key and `sk_live_` secret key.
2. Activate Clerk's Convex integration, then enable Organizations. Require organization membership for a company workspace, then create the first organization or invite the operators who will test it. Workspace roles control workspace administration. Publishing uses the separate platform administrator allowlist.
3. Copy the production Frontend API URL into `CLERK_JWT_ISSUER_DOMAIN`. It must be the issuer for the same Clerk instance, not the development URL.
4. Add the final web origin to Clerk's allowed origins and redirect URLs. The origin is the value used for `APP_URL`.
5. Record the Clerk user IDs of platform administrators. Put those IDs, comma separated, in `PLATFORM_ADMIN_USER_IDS` in Convex.

Set these variables in the Convex production deployment. Convex stores environment variables per deployment, and `npx convex deploy` publishes functions and schema without copying variables from the web host. See [Convex environment variables](https://docs.convex.dev/production/environment-variables).

```sh
npx convex env set --prod CLERK_JWT_ISSUER_DOMAIN 'https://your-production-clerk-frontend-api.example.com'
npx convex env set --prod AHQ_SERVICE_SECRET 'generate-a-separate-random-secret'
npx convex env set --prod PLATFORM_ADMIN_USER_IDS 'user_...'
npx convex env set --prod MCP_SERVER_URLS_JSON '{"linear":["https://mcp.linear.app/mcp"]}'
npx convex env set --prod MCP_TOOL_REGISTRY_JSON '{"linear":[{"name":"list_issues","description":"List permitted issues","mode":"read"},{"name":"get_issue","description":"Read one permitted issue","mode":"read"}]}'
```

The example commands are illustrative. Set the complete URL and tool registries from `.env.example` before connecting providers. `MCP_SERVER_URLS_JSON` is an exact per-provider URL admission list. `MCP_TOOL_REGISTRY_JSON` is an exact per-provider list of discovered, reviewed tools that a published employee can request. Each entry has `name`, `description`, and `mode` with `read`, `write`, or `blocked`. A tool still needs a connection grant, employee capability, policy, and resource scope at runtime. Generate `AHQ_SERVICE_SECRET` and `CREDENTIAL_ENCRYPTION_KEY` independently. For the encryption key, use 32 random bytes encoded as base64, for example `openssl rand -base64 32`. The web and gateway validate this key as an AES-256-GCM key.

Deploy the Convex code from the final migration checkout:

```sh
npx convex deploy
```

Copy the resulting `https://...convex.cloud` URL. It becomes `NEXT_PUBLIC_CONVEX_URL` and, unless `CONVEX_URL` is set explicitly, the server-side fallback as well.

## 3. Create the Railway project and services

Create one Railway project linked to the migration repository. Railway reads `Dockerfile` and injects `PORT`; the services in this repository listen on that value. Railway's healthcheck switches traffic only after the endpoint returns a `2xx`, and it does not keep polling after deployment. See [Railway Dockerfiles](https://docs.railway.com/builds/dockerfiles) and [healthchecks](https://docs.railway.com/deployments/healthchecks).

Create three services from the same repository and commit. Each builds the same Dockerfile image. Set these start commands in the service settings:

| Service   | Start command     | Healthcheck | Public access                                          |
| --------- | ----------------- | ----------- | ------------------------------------------------------ |
| `web`     | `npm start`       | `/health`   | Add the application domain and HTTPS                   |
| `worker`  | `npm run worker`  | `/health`   | Keep private                                           |
| `gateway` | `npm run gateway` | `/health`   | Add an HTTPS domain; require bearer tokens at `/mcp/*` |

The root `railway.json` supplies the shared Docker build and web healthcheck default. Set the command and healthcheck on each service in Railway; do not rely on one repository-level `startCommand` for all three processes. Railway runs staged variable changes only after they are deployed, so review the staged changes before applying them. Shared variables can reduce duplication, but keep secrets sealed and do not expose them as build arguments. See [Railway start commands](https://docs.railway.com/deployments/start-command) and [Railway variables](https://docs.railway.com/variables).

Set `APP_URL` to the final web origin, for example `https://hq.example.com`. Set `MCP_GATEWAY_URL` to the gateway's public HTTPS origin, for example `https://mcp.example.com`. The OpenAI hosted session uses a service-origin MCP transport, so the gateway needs a stable HTTPS address that the OpenAI service can reach. Protect it with the bearer task token and provider admission checks. Railway private DNS can still be used for web-to-gateway traffic, but it is not the address supplied to the hosted Agents session.

## 4. Add variables

The exact names come from the current web, worker, gateway, and Convex code. Add the common values to each Railway service that needs them. The simplest safe setup is to share the non-public runtime configuration with all three services, then seal secrets in Railway. Only the Convex URL and Clerk publishable key belong in `NEXT_PUBLIC_*` variables. Next.js includes those public values in the browser build. Keep every secret server-side.

| Variable                            | Railway services     | Convex | Required               | Purpose                                                                  |
| ----------------------------------- | -------------------- | ------ | ---------------------- | ------------------------------------------------------------------------ |
| `NEXT_PUBLIC_CONVEX_URL`            | web, worker, gateway | no     | yes                    | Convex browser URL and fallback                                          |
| `CONVEX_URL`                        | web, worker, gateway | no     | no                     | Server-side Convex URL override                                          |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | web                  | no     | yes                    | Clerk browser SDK                                                        |
| `CLERK_SECRET_KEY`                  | web                  | no     | yes                    | Clerk server SDK                                                         |
| `CLERK_JWT_ISSUER_DOMAIN`           | no                   | yes    | yes                    | Clerk issuer for Convex auth                                             |
| `APP_URL`                           | web                  | no     | yes                    | Origin checks and OAuth callback base                                    |
| `AHQ_SERVICE_SECRET`                | web, worker, gateway | yes    | yes                    | Authenticates service calls into Convex                                  |
| `CREDENTIAL_ENCRYPTION_KEY`         | web, worker, gateway | no     | yes for integrations   | 32 base64 encoded random bytes                                           |
| `OPENAI_API_KEY`                    | worker               | no     | yes for tasks          | Server-side Agents API key                                               |
| `MCP_GATEWAY_URL`                   | worker               | no     | yes for tasks          | Public HTTPS gateway origin                                              |
| `S3_ENDPOINT`                       | web, worker          | no     | yes for archived files | S3-compatible endpoint                                                   |
| `S3_FORCE_PATH_STYLE`               | web, worker          | no     | no                     | Defaults to `false`; use the bucket's documented URL style               |
| `S3_REGION`                         | web, worker          | no     | no                     | Defaults to `auto`                                                       |
| `S3_BUCKET`                         | web, worker          | no     | yes for archived files | Artifact bucket                                                          |
| `S3_ACCESS_KEY_ID`                  | web, worker          | no     | yes for archived files | Bucket access key                                                        |
| `S3_SECRET_ACCESS_KEY`              | web, worker          | no     | yes for archived files | Bucket secret                                                            |
| `MCP_SERVER_URLS_JSON`              | no                   | yes    | yes                    | Exact provider URL admission allowlist                                   |
| `MCP_TOOL_REGISTRY_JSON`            | no                   | yes    | yes for publishing     | Exact reviewed provider tools allowed in published employee capabilities |
| `PLATFORM_ADMIN_USER_IDS`           | no                   | yes    | yes for publishing     | Clerk user IDs allowed to publish                                        |
| `NATIVE_INBOX_CONFIG_JSON`          | web                  | no     | for native inbox       | Per-connection provider, signing secret, and resource IDs                |
| `INBOX_WEBHOOK_SECRETS_JSON`        | web                  | no     | only for push inbox    | Connection ID to HMAC secret map                                         |
| `MCP_APPROVED_HOSTS`                | web, worker, gateway | no     | no                     | Additional approved MCP hostnames                                        |
| `MCP_TOOL_POLICIES_JSON`            | web, worker, gateway | no     | no                     | Explicit tool policy overrides                                           |
| `MCP_OAUTH_CONFIG_JSON`             | web, worker, gateway | no     | for OAuth              | Provider OAuth clients                                                   |
| `WORKER_CONCURRENCY`                | worker               | no     | no                     | Defaults to 4, capped at 16                                              |
| `MAX_TURN_SECONDS`                  | worker               | no     | no                     | Defaults to 900, bounded to 60 through 3600                              |
| `TASK_RESERVED_COST_USD`            | no                   | yes    | no                     | Global reservation override                                              |
| `TASK_RESERVED_COST_USD_LUNA`       | no                   | yes    | no                     | Luna reservation override                                                |
| `TASK_RESERVED_COST_USD_TERRA`      | no                   | yes    | no                     | Terra reservation override                                               |
| `TASK_RESERVED_COST_USD_SOL`        | no                   | yes    | no                     | Sol reservation override                                                 |
| `TASK_RESERVED_COST_USD_ASTRA`      | no                   | yes    | no                     | Astra reservation override                                               |

Railway supplies `PORT`. Leave it unset so each process binds to Railway's assigned port. Set `MCP_SERVER_URLS_JSON` in Convex even when the same value exists in Railway. Convex rejects a connection when its URL is absent from the exact provider array. For ServiceNow or any custom server, set both its hostname in Railway's `MCP_APPROVED_HOSTS` and its exact HTTPS URL in Convex's `MCP_SERVER_URLS_JSON` for that provider. Neither setting alone admits a custom endpoint. The code still requires HTTPS and blocks IP addresses, credentials, fragments, and non-standard ports.

`MCP_TOOL_POLICIES_JSON` is fail-closed for restricted resources. An entry can set `mode` to `read`, `write`, or `blocked`; a restricted non-empty `resourceScope` also needs a configured `resourceArgument` such as `projectId`. Only the configured comma-separated IDs are accepted. The gateway never infers a resource argument from arbitrary tool parameters. A correction descriptor must name the read tool, ID argument, version field, expected version argument, and fields. Default approval rules vary by provider, so review each discovered tool before enabling it.

### OAuth client registration

Register one OAuth client per provider that supports OAuth. Use this exact callback for every client:

```text
https://your-web-origin.example.com/api/integrations/callback
```

Put the resulting client IDs and secrets in `MCP_OAUTH_CONFIG_JSON`. The application accepts this shape:

```json
{
  "linear": {
    "clientId": "client-id",
    "clientSecret": "client-secret",
    "scopes": "scope-a scope-b",
    "authorizationUrl": "https://provider.example/authorize",
    "tokenUrl": "https://provider.example/token",
    "tokenAuthMethod": "client_secret_post"
  }
}
```

`clientSecret`, `authorizationUrl`, `tokenUrl`, and `tokenAuthMethod` are optional when the provider's MCP server publishes compatible OAuth metadata. `tokenAuthMethod` is `client_secret_basic`, `client_secret_post`, or `none`. Use the provider's documented values. A Google Workspace example is in [the Google Workspace MCP guide](google-workspace-mcp.md). Do not paste a provider access token into this JSON. Access tokens entered by a user are sealed with `CREDENTIAL_ENCRYPTION_KEY` before Convex stores them.

## 5. Configure artifact storage

The worker downloads completed Agents artifacts and writes them to the configured S3-compatible bucket. The bucket is required for tasks that produce files. A Railway Storage Bucket or another S3-compatible service is acceptable. Copy its endpoint, region, bucket name, access key ID, and secret into both web and worker. [Railway storage buckets](https://docs.railway.com/storage-buckets) document the current bucket product and credentials.

Use a private bucket. The application authorizes downloads through Convex before it returns an artifact, and stores only the object key and checksum in the task record. The worker refuses artifacts larger than 25 MB. Do not add a public bucket URL to task messages.

## 6. Configure the provider registry and relay

The built-in registry currently contains these providers:

| Provider         | MCP server URL                                                                                        | Current note                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Linear           | `https://mcp.linear.app/mcp`                                                                          | External changes are reviewed.                                                             |
| Slack            | `https://mcp.slack.com/mcp`                                                                           | Requires an internal or marketplace-published Slack app.                                   |
| Google Workspace | Gmail, Drive, Docs, Sheets, Slides, Calendar endpoints in [the Google guide](google-workspace-mcp.md) | Developer Preview. Connect each product separately. Gmail prepares drafts and cannot send. |
| GitHub           | `https://api.githubcopilot.com/mcp/`                                                                  | Use a token restricted to needed repositories.                                             |
| Salesforce       | `https://api.salesforce.com/platform/mcp/v1/platform/sobject-all`                                     | Hosted MCP access and Salesforce object and field restrictions are required.               |
| ServiceNow       | administrator supplied                                                                                | Approve the instance hostname and MCP URL before use.                                      |
| Canva            | `https://mcp.canva.com/mcp`                                                                           | Tools depend on the Canva account.                                                         |

Connecting an MCP server does not create an inbox subscription. Slack, Linear, and GitHub have native signature-verified webhook endpoints. Configure `NATIVE_INBOX_CONFIG_JSON` and provider subscriptions using [inbox delivery](inbox-delivery.md). Salesforce, ServiceNow, and Google Workspace use the normalized relay below. For each push connection, generate a random secret and add it to the web variable like this:

```json
{ "<connectionId>": "<random-relay-secret>" }
```

The relay must normalize only events visible to that connection's owner, then POST to:

```text
POST https://your-web-origin.example.com/api/webhooks/inbox/<connectionId>
x-ahq-timestamp: <unix-seconds>
x-ahq-signature: <hex HMAC-SHA256>
```

Sign the exact raw request body as `HMAC_SHA256(secret, timestamp + "." + rawBody)`. The body is JSON with at most 100 items:

```json
{
  "items": [
    {
      "externalId": "provider-event-id",
      "title": "Short title",
      "preview": "Redacted preview",
      "sourceUrl": "https://provider.example/item/1",
      "createdAt": 1720000000000
    }
  ],
  "cursor": "provider-cursor"
}
```

`sourceUrl` must use HTTPS. Timestamps must be within five minutes of receipt. Never log full webhook bodies, OAuth responses, bearer tokens, or provider content. Store only the normalized fields needed for the inbox.

Google push ingestion needs a separately configured Google Pub/Sub and provider watch or relay. The app does not register that subscription when an MCP connection is created. The same explicit relay protocol applies after the provider-side watch is authorized.

## 7. Connect providers, publish an employee, and test

Complete these steps with a test account and a test provider workspace:

1. Sign in through Clerk and create or join the intended organization. Bootstrap the workspace in the UI.
2. Open Integrations, choose a provider and its exact approved server URL, run discovery, and select the smallest useful tool set. Apply resource restrictions only when the tool has a configured `resourceArgument`; otherwise use a provider account restricted to the intended records. OAuth consent does not grant every discovered tool to every employee.
3. Review the discovered tools and add their exact names, descriptions, and modes to Convex's `MCP_TOOL_REGISTRY_JSON`. Configure execution policies on Railway separately. As a platform administrator, create a marketplace draft with its required and optional capabilities, private instructions, skills, and public media. Publish it, then hire the published employee.
4. Run a read-only task. Verify live task updates, the worker's session, and the recorded MCP read. Revoke a required connection and verify the next task is blocked before an Agents session starts.
5. Restore the connection and run a write-capable task against a test record. Confirm the UI shows a proposal and correction limits, with no provider mutation before approval. Approve it, inspect the result, then exercise its documented correction path.
6. Configure native inbox webhooks or the normalized relay after provider visibility and signature verification pass. Send one signed event twice and confirm deduplication.
7. Restart the worker during a test session. Confirm SSE reconnection, saved-item recovery, explicit history gaps, and no repeated external write. Download a generated artifact through its authenticated Files link.

Do not call this production ready until these checks have been run with real accounts and their results recorded. The repository contains no account credentials and this guide does not fabricate a successful provider call.

## References

- [Convex with Clerk](https://docs.convex.dev/auth/clerk)
- [Convex production deployment](https://docs.convex.dev/production/overview)
- [Convex `npx convex deploy`](https://docs.convex.dev/cli/reference/deploy)
- [Railway variables](https://docs.railway.com/variables)
- [Railway healthchecks](https://docs.railway.com/deployments/healthchecks)
- [OpenAI Agents sessions](https://developers.openai.com/api/docs/guides/agents-api/sessions)
- [OpenAI Agents events](https://developers.openai.com/api/docs/guides/agents-api/sessions/events)
- [OpenAI MCP connections](https://developers.openai.com/api/docs/guides/agents-api/tools/mcp)
- [OpenAI hosted environments](https://developers.openai.com/api/docs/guides/agents-api/environments/openai-hosted)

For current Railway buckets, use the base endpoint and leave `S3_FORCE_PATH_STYLE=false`. Older buckets may require `true`; the bucket Credentials tab states the URL style. Both web and worker need S3 credentials because the web service serves authenticated file downloads. See [Railway bucket URL styles](https://docs.railway.com/storage-buckets#url-style).
