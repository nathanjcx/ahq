# Deployment

Deploying Astra HQ is two jobs. First a platform administrator brings up the four pieces described in [architecture](architecture.md): Convex, web, worker, gateway. Then the same administrator configures every provider inside the running application, on the Operations page. No provider setting is an environment variable.

This document does not claim that any account exists, that a provider has been connected, or that a deployment has completed.

## 1. Convex and Clerk

Create a Convex project with a production deployment, and a Clerk production application.

In Clerk:

1. Copy the `pk_live_` publishable key and the `sk_live_` secret key.
2. Activate Clerk's Convex integration, then enable Organizations. A workspace is keyed by organization when the signed-in session has one, and by user otherwise. Organization role decides workspace owner, admin, or member.
3. Copy the production Frontend API URL. It becomes `CLERK_JWT_ISSUER_DOMAIN` in Convex. `convex/auth.config.ts` uses `applicationID: "convex"`.
4. Add the final web origin to Clerk's allowed origins and redirect URLs. That origin is `APP_URL`.
5. Record the Clerk user IDs of the platform administrators.

Set the Convex deployment variables. Convex stores variables per deployment, and `npx convex deploy` does not copy them from the web host.

```sh
npx convex env set --prod CLERK_JWT_ISSUER_DOMAIN 'https://your-production-clerk-frontend-api.example.com'
npx convex env set --prod AHQ_SERVICE_SECRET 'generate-a-separate-random-secret'
npx convex env set --prod PLATFORM_ADMIN_USER_IDS 'user_...'
npx convex deploy
```

Generate `AHQ_SERVICE_SECRET` and `CREDENTIAL_ENCRYPTION_KEY` independently. The encryption key is 32 random bytes in base64, for example `openssl rand -base64 32`; web, worker, and gateway validate it as an AES-256-GCM key. Copy the deployment's `https://...convex.cloud` URL for `NEXT_PUBLIC_CONVEX_URL`.

## 2. Railway services

One project, three services, one Dockerfile image, the same commit. Railway injects `PORT` and each process listens on it. `railway.json` supplies the shared build and the `/health` healthcheck default; set the start command and healthcheck on each service.

| Service   | Start command     | Healthcheck | Public access                                          |
| --------- | ----------------- | ----------- | ------------------------------------------------------ |
| `web`     | `npm start`       | `/health`   | Application domain over HTTPS                          |
| `worker`  | `npm run worker`  | `/health`   | Keep private                                           |
| `gateway` | `npm run gateway` | `/health`   | HTTPS domain; every `/mcp/*` request needs a run token |

The hosted Agents session connects to the gateway from OpenAI's side, so `MCP_GATEWAY_URL` must be a public HTTPS origin, not a private Railway address.

## 3. Environment variables

This is the complete list the code reads. Everything else that used to live here is now Convex data, edited on the Operations page.

| Variable                            | Where                        | Required               | Purpose                                         |
| ----------------------------------- | ---------------------------- | ---------------------- | ----------------------------------------------- |
| `NEXT_PUBLIC_CONVEX_URL`            | web, worker, gateway         | yes                    | Convex URL, browser and server fallback         |
| `CONVEX_URL`                        | web, worker, gateway         | no                     | Server-side Convex URL override                 |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | web                          | yes                    | Clerk browser SDK                               |
| `CLERK_SECRET_KEY`                  | web                          | yes                    | Clerk server SDK                                |
| `CLERK_JWT_ISSUER_DOMAIN`           | Convex                       | yes                    | Issuer Convex validates                         |
| `APP_URL`                           | web                          | yes                    | Origin checks, OAuth callback, relay URL        |
| `AHQ_SERVICE_SECRET`                | web, worker, gateway, Convex | yes                    | Authenticates service functions                 |
| `CREDENTIAL_ENCRYPTION_KEY`         | web, worker, gateway         | yes for integrations   | Seals and unseals every stored secret           |
| `OPENAI_API_KEY`                    | worker                       | yes for tasks          | Agents API                                      |
| `MCP_GATEWAY_URL`                   | worker                       | yes for tasks          | Gateway origin written into session tools       |
| `S3_ENDPOINT`                       | web, worker                  | yes for archived files | S3-compatible endpoint                          |
| `S3_BUCKET`                         | web, worker                  | yes for archived files | Artifact bucket                                 |
| `S3_ACCESS_KEY_ID`                  | web, worker                  | yes for archived files | Bucket access key                               |
| `S3_SECRET_ACCESS_KEY`              | web, worker                  | yes for archived files | Bucket secret                                   |
| `S3_REGION`                         | web, worker                  | no                     | Defaults to `auto`                              |
| `S3_FORCE_PATH_STYLE`               | web, worker                  | no                     | Defaults to `false`                             |
| `PLATFORM_ADMIN_USER_IDS`           | web, Convex                  | yes for configuration  | Clerk user IDs allowed on Operations            |
| `WORKER_CONCURRENCY`                | worker                       | no                     | Job slots, default 4, bounded 1 to 16           |
| `WORKER_MONITORS`                   | worker                       | no                     | Monitor slots, default 16, bounded 1 to 64      |
| `MAX_TURN_SECONDS`                  | worker                       | no                     | Run time limit, default 900, bounded 60 to 3600 |

Keep `CLERK_SECRET_KEY` on web only and `OPENAI_API_KEY` on worker only. `PLATFORM_ADMIN_USER_IDS` must hold the same list in Convex and on the web service, because Convex guards the configuration functions and the web service guards the routes that seal secrets. Leave `PORT` unset. `ALLOW_INSECURE_MCP_FOR_TESTS` exists for the test suite and only has an effect when `NODE_ENV=test`; never set it on a deployed service.

## 4. Artifact storage

The worker downloads completed session files and writes them to the bucket; the web service reads them back for authenticated downloads, so both need the credentials. Use a private bucket. Convex stores only the object key, size, and checksum, and authorizes each download. The worker skips files over 25 MB and stops after 100 files per task, journaling both limits.

## 5. Configure providers on the Operations page

Sign in as a user whose Clerk ID is in `PLATFORM_ADMIN_USER_IDS` and open Operations. Every service reads this configuration, so a change takes effect on the next agent call and the next sign-in. Nothing here is redeployed.

The page has a readiness card per provider that names the next missing item, a configuration card per provider, and the tool registry.

**Enabled servers.** Tick the MCP servers users may connect. The choices come from the built-in registry in `lib/providers.ts`; there is no free-form URL. Convex re-checks the URL when a connection is saved, and requires HTTPS with no embedded credentials.

**OAuth clients.** One client per provider, or one per exact server URL when a single product needs its own scopes. A client with no server URL is the provider default and covers every enabled server. Register this exact callback with every provider:

```text
https://<web-origin>/api/integrations/callback
```

Fields are the client id, the client secret, the scopes, and optional fixed `authorizationUrl`, `tokenUrl`, and `tokenAuthMethod` (`client_secret_basic`, `client_secret_post`, or `none`) for a provider whose MCP server does not publish usable OAuth metadata. The browser posts the secret once to the web service, which seals it before Convex sees it. Afterwards the page shows only whether a secret is set and when it changed. Saving a client without a new secret keeps the stored one.

**Native inbox secrets.** Providers with followable resources (GitHub, Linear, Slack) verify webhooks with one app-level signing secret. The card shows the URL to configure with the provider:

```text
https://<web-origin>/api/webhooks/native/<provider>
```

Paste the provider's signing secret; the web service seals it. Clearing it makes that endpoint return 404. See [inbox delivery](inbox-delivery.md).

**Tool registry.** A tool exists for agents only when the registry has a row for its provider and name. A row holds the tool name, a description, and:

- `mode` is `read`, `write`, or `blocked`. A name that reads as destructive (`delete`, `purge`, `destroy`, `remove`) cannot be saved as `read`.
- `resourceArgument` names the argument compared against a connection's resource restriction. Without it, a restricted connection blocks the tool rather than guessing.
- A correction descriptor names the read tool, the id argument, the version field, the expected-version argument, and the fields a compensating update restores. A write with a descriptor is proposed as correctable; a write without one can only ever get a manual correction task.

**Import from my connection.** The registry section can seed rows from the tools discovered on one of the administrator's own connections. Imported rows arrive as `blocked` with an empty description and any MCP annotations the server reported. Annotations are hints for the reviewer and never grant anything. Review each row, write its description, and set its mode.

A user can start sign-in for a provider only when the server is enabled, an OAuth client covers it, and at least one tool for that provider is not blocked. Connecting fails when none of the discovered tools are in the registry.

## 6. Provider prerequisites

Each provider needs one-time setup outside the application before anyone can connect it.

- Linear: create an OAuth application in Linear settings with the callback above. No further provider approval is required.
- GitHub: create a GitHub App (preferred) or an OAuth App with the same callback. Organization repositories require an organization owner to install or approve the app. Organizations enforcing SAML require SSO authorization on first sign-in.
- Slack: create a Slack app with the needed scopes and the same callback. Slack MCP allows internal apps and apps listed in the Slack Marketplace; unlisted distributed apps are prohibited. An internal app works immediately for your own Slack workspace. Serving other companies requires a Marketplace listing, after which each customer's Slack administrator approves the install.
- Google Workspace: a Google Cloud project with the product APIs and MCP services enabled, a configured consent screen, and a `Web application` OAuth client. Developer Preview. Gmail and Drive scopes are restricted: an external audience requires Google OAuth verification and a security assessment, and until that completes only listed test users can connect and they see an unverified-app warning. Workspace administrators may block third-party apps. See [the Google Workspace guide](google-workspace-mcp.md).
- Canva: apply on Canva's MCP waitlist. After approval, add the redirect URI to Canva's allowlist. Until then only the developer's own team can connect.

## 7. Inbox delivery

Connecting an MCP server does not create any subscription. GitHub, Linear, and Slack deliver to the native endpoints configured in step 5. Everything else, including Google Workspace, uses the normalized relay at `/api/webhooks/inbox/<connectionId>`, signed with the connection's own relay secret. The owner reveals or rotates that secret from Manage access on the connection. [Inbox delivery](inbox-delivery.md) has the signatures, the payload, and the test procedure.

## 8. Acceptance steps

Run these with a test Clerk organization and test provider records, and record the results. Until then the deployment is not proven.

1. **Configure providers.** On Operations, enable the servers, add an OAuth client per provider, set the native inbox secrets, then import and review tools until each provider's readiness card reports everything configured. Confirm the page never redisplays a secret.
2. **Connect.** As an ordinary user, open Integrations and connect one provider. Confirm the connection lists only reviewed tools, and that a provider with no reviewed tool refuses to start sign-in.
3. **Run a read task.** Publish and hire an employee whose capability uses those tools, then run a read-only task. Confirm live events in the UI, one worker job, and one journaled read with a duration in the Audit tab.
4. **Approve a write.** Run a task that needs a write. Confirm the UI shows a proposal with the arguments, the captured record version, and the correction limit, and that nothing reached the provider before approval. Approve it and check the recorded result.
5. **Undo it with a correction.** For a tool with a correction descriptor, request the correction. Confirm the precondition read appears in the audit trail, the compensating write restores only the configured fields, and a second correction is refused. For a tool without a descriptor, confirm the app creates a correction task instead.
6. **Check the Audit tab.** Confirm the timeline interleaves messages, events, tool calls, and proposal transitions, that a denied attempt shows its reason, and that the JSON export contains the unsealed arguments and results.
7. **Restart a worker.** Restart it mid-session. Confirm another replica or the restarted process picks the session back up, the timeline records the disconnection and the recovery gap, and no external write repeats.
8. **Share a connection.** As the owner, share it with a teammate from Manage access. Confirm the teammate can start a task that uses it, cannot approve a write through it, and that the owner sees the pending proposal even on a private task.
9. **Accept a handoff on a floor.** Create a floor, staff it, run a floor task, and have the agent request a handoff. Confirm a person has to accept it, and that accepting creates a floor task carrying the source task's final message.

## References

- [Convex with Clerk](https://docs.convex.dev/auth/clerk)
- [Convex environment variables](https://docs.convex.dev/production/environment-variables)
- [Convex `npx convex deploy`](https://docs.convex.dev/cli/reference/deploy)
- [Railway Dockerfiles](https://docs.railway.com/builds/dockerfiles)
- [Railway healthchecks](https://docs.railway.com/deployments/healthchecks)
- [Railway variables](https://docs.railway.com/variables)
- [Railway storage buckets](https://docs.railway.com/storage-buckets)
- [OpenAI Agents sessions](https://developers.openai.com/api/docs/guides/agents-api/sessions)
- [OpenAI MCP connections](https://developers.openai.com/api/docs/guides/agents-api/tools/mcp)
- [OpenAI hosted environments](https://developers.openai.com/api/docs/guides/agents-api/environments/openai-hosted)
