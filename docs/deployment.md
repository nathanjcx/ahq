# Deployment

Deploying Staff AI is two jobs. First a platform administrator brings up the four pieces described in [architecture](architecture.md): Convex, web, worker, gateway. Then the same administrator configures every provider inside the running application, on the Operations page. No provider setting is an environment variable.

This document does not claim that any account exists, that a provider has been connected, or that a deployment has completed.

## 1. Convex and WorkOS

Create a Convex project with a production deployment, and a WorkOS production environment.

In the WorkOS dashboard, for the production environment:

1. Copy the `client_...` client id and the `sk_live_...` API key from **Get started → Quick start**.
2. Under **Redirects**, add `https://<your web origin>/callback` as a redirect URI and point the sign-in and sign-out redirects at `https://<your web origin>/`. That origin is `APP_URL`, and the callback is `NEXT_PUBLIC_WORKOS_REDIRECT_URI`.
3. Under **Authentication**, enable the sign-in methods this deployment allows, and enable organizations. A workspace is keyed by organization when the session has one, and by user otherwise. The organization role decides workspace owner, admin, or member: the `admin` role slug administers the workspace and every other slug is a member. Keep the shipped `admin` and `member` roles.
4. Under **Authentication → Features → JWT template**, add the person's name and email to the access token so shared views can name who did what. Convex reads these claims and falls back to "Member" without them.

   ```json
   {
     "name": "{{ user.first_name || '' }} {{ user.last_name || '' }}",
     "email": {{ user.email }}
   }
   ```

5. Record the WorkOS user IDs of the platform administrators.

WorkOS needs no CORS entry: the browser never calls the WorkOS API. Signing in is a top-level redirect and the session is read on the server.

Set the Convex deployment variables. Convex stores variables per deployment, and `npx convex deploy` does not copy them from the web host. Convex validates access tokens against the environment's public keys, so it needs the client id; `convex/auth.config.ts` builds both WorkOS issuers from it.

```sh
npx convex env set --prod WORKOS_CLIENT_ID 'client_...'
npx convex env set --prod WORKOS_API_KEY 'sk_live_...'
npx convex env set --prod AHQ_SERVICE_SECRET 'generate-a-separate-random-secret'
npx convex env set --prod PLATFORM_ADMIN_USER_IDS 'user_...'
npx convex deploy
```

Deploy Convex before pushing a web change that calls a new Convex function: Railway builds `main` on push, and a client that subscribes to a function the deployment does not have yet renders the error screen until Convex catches up.

Generate `AHQ_SERVICE_SECRET`, `CREDENTIAL_ENCRYPTION_KEY`, and `WORKOS_COOKIE_PASSWORD` independently; the cookie password is at least 32 characters, for example `openssl rand -base64 32`. The encryption key is 32 random bytes in base64, for example `openssl rand -base64 32`; web, worker, and gateway validate it as an AES-256-GCM key. Copy the deployment's `https://...convex.cloud` URL for `NEXT_PUBLIC_CONVEX_URL`.

## 2. Railway services

One project, three services, three Dockerfiles, the same commit. Railway injects `PORT` and each process listens on it. `railway.json` supplies the healthcheck default; each service picks its image through the `RAILWAY_DOCKERFILE_PATH` variable and runs the image's own `CMD`, so leave the Railway start command empty.

| Service   | Dockerfile           | Process (image `CMD`)     | Healthcheck | Public access                                          |
| --------- | -------------------- | ------------------------- | ----------- | ------------------------------------------------------ |
| `web`     | `Dockerfile`         | `next start`              | `/health`   | Application domain over HTTPS                          |
| `worker`  | `Dockerfile.worker`  | `tsx services/worker.ts`  | `/health`   | Keep private                                           |
| `gateway` | `Dockerfile.gateway` | `tsx services/gateway.ts` | `/health`   | HTTPS domain; every `/mcp/*` request needs a run token |

The hosted Agents session connects to the gateway from OpenAI's side, so `MCP_GATEWAY_URL` must be a public HTTPS origin, not a private Railway address.

## 3. Environment variables

This is the complete list the code reads. Everything else that used to live here is now Convex data, edited on the Operations page.

| Variable                          | Where                        | Required               | Purpose                                                    |
| --------------------------------- | ---------------------------- | ---------------------- | ---------------------------------------------------------- |
| `NEXT_PUBLIC_CONVEX_URL`          | web, worker, gateway         | yes                    | Convex URL, browser and server fallback                    |
| `CONVEX_URL`                      | web, worker, gateway         | no                     | Server-side Convex URL override                            |
| `NEXT_PUBLIC_WORKOS_REDIRECT_URI` | web                          | yes                    | `<APP_URL>/callback`, also set in WorkOS                   |
| `WORKOS_CLIENT_ID`                | web, Convex                  | yes                    | WorkOS environment; Convex validates tokens                |
| `WORKOS_API_KEY`                  | web, Convex                  | yes                    | WorkOS server API                                          |
| `WORKOS_AUTH_DOMAIN`              | Convex                       | with a custom domain   | The environment's custom auth domain, the token issuer     |
| `WORKOS_COOKIE_PASSWORD`          | web                          | yes                    | Seals the session cookie, 32+ characters                   |
| `APP_URL`                         | web, gateway, worker         | yes                    | Origin checks, OAuth callback and token refresh, relay URL |
| `AHQ_SERVICE_SECRET`              | web, worker, gateway, Convex | yes                    | Authenticates service functions                            |
| `CREDENTIAL_ENCRYPTION_KEY`       | web, worker, gateway         | yes for integrations   | Seals and unseals every stored secret                      |
| `OPENAI_API_KEY`                  | worker                       | yes for tasks          | Agents API                                                 |
| `MCP_GATEWAY_URL`                 | worker                       | yes for tasks          | Gateway origin written into session tools                  |
| `S3_ENDPOINT`                     | web, worker                  | yes for archived files | S3-compatible endpoint                                     |
| `S3_BUCKET`                       | web, worker                  | yes for archived files | Artifact bucket                                            |
| `S3_ACCESS_KEY_ID`                | web, worker                  | yes for archived files | Bucket access key                                          |
| `S3_SECRET_ACCESS_KEY`            | web, worker                  | yes for archived files | Bucket secret                                              |
| `S3_REGION`                       | web, worker                  | no                     | Defaults to `auto`                                         |
| `S3_FORCE_PATH_STYLE`             | web, worker                  | no                     | Defaults to `false`                                        |
| `PLATFORM_ADMIN_USER_IDS`         | web, Convex                  | yes for configuration  | WorkOS user IDs allowed on Operations                      |
| `VAPID_PUBLIC_KEY`                | web, worker                  | yes for push           | Web Push application key                                   |
| `VAPID_PRIVATE_KEY`               | web, worker                  | yes for push           | Web Push signing key                                       |
| `VAPID_SUBJECT`                   | web, worker                  | yes for push           | `mailto:` address or origin the push service contacts      |
| `WORKER_CONCURRENCY`              | worker                       | no                     | Job slots, default 4, bounded 1 to 16                      |
| `WORKER_MONITORS`                 | worker                       | no                     | Monitor slots, default 16, bounded 1 to 64                 |
| `MAX_TURN_SECONDS`                | worker                       | no                     | Run time limit, default 900, bounded 60 to 3600            |

Without the three `VAPID_*` variables push notifications are off and say so in the log; the other
channels still deliver. Generate the pair once with `npx web-push generate-vapid-keys`.

`OPENAI_API_KEY` and `MCP_GATEWAY_URL` are read when a task needs them, not at startup: a worker
without them starts, serves `/health` with them named in `missingConfig`, logs the same line, and
fails each job it claims with that reason rather than crash-looping out of the deployment.

Keep `WORKOS_API_KEY` and `WORKOS_COOKIE_PASSWORD` off the browser and `OPENAI_API_KEY` on worker only. Nothing WorkOS needs is public: `NEXT_PUBLIC_WORKOS_REDIRECT_URI` is a URL on this application's own origin. `PLATFORM_ADMIN_USER_IDS` must hold the same list in Convex and on the web service, because Convex guards the configuration functions and the web service guards the routes that seal secrets. Leave `PORT` unset. `ALLOW_INSECURE_MCP_FOR_TESTS` exists for the test suite and only has an effect when `NODE_ENV=test`; never set it on a deployed service.

## 4. Artifact storage

The worker downloads completed session files and writes them to the bucket; the web service reads them back for authenticated downloads, so both need the credentials. Use a private bucket. Convex stores only the object key, size, and checksum, and authorizes each download. The worker skips files over 25 MB and stops after 100 files per task, journaling both limits.

## 5. Configure providers on the Operations page

Sign in as a user whose WorkOS ID is in `PLATFORM_ADMIN_USER_IDS` and open Operations. Every service reads this configuration, so a change takes effect on the next agent call and the next sign-in. Nothing here is redeployed.

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

### Provider OAuth clients (set up September 13, 2026)

| Provider         | Client                                                                                                                                                                     | Where registered                                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Linear           | none needed: `mcp.linear.app` registers a client on the first sign-in (dynamic registration)                                                                               | stored by the flow under the server URL                                                                                |
| Canva            | none needed: `mcp.canva.com` registers dynamically                                                                                                                         | same                                                                                                                   |
| GitHub           | OAuth app "Staff AI" on the `trystaff` GitHub organization, scopes `repo read:org read:user user:email`                                                                    | Convex `providerConfigs.github`, endpoints on github.com                                                               |
| Slack            | app "Staff AI" (`A0C1L574S4U`) in the Trystaff Slack workspace, 25 user scopes from the MCP tool table, redirect `/api/integrations/callback`                              | Convex `providerConfigs.slack`, endpoints `slack.com/oauth/v2_user/authorize` and `slack.com/api/oauth.v2.user.access` |
| Google Workspace | OAuth client "Staff AI Workspace" in Cloud project `staff-ai-508505`; consent screen carries Gmail, Drive, Docs, Sheets, Slides, Calendar scopes; the six APIs are enabled | Convex `providerConfigs.google-workspace` as the default client for all six product servers                            |

The secrets live in `~/.config/trystaff/deploy.env` on the setup machine and sealed in Convex. Slack's MCP server admits only directory-published or internal apps, so until the app is submitted to the Slack Marketplace it works for the Trystaff workspace only; the app's "Enable Slack MCP Server" switch (Agents page) is on, without it every connection fails at discovery. Google's Gmail and Drive scopes are restricted: until Google's verification completes, only the test users listed on the consent screen can connect, and the verification needs a demo video and a CASA security assessment.

State on September 13, 2026:

- Google Workspace: the six MCP APIs are enabled in `staff-ai-508505` (without them the servers answer 401 `invalid_token`), all six products connect and grant every reviewed tool, and the Developer Preview Program application for project number `701645781270` (spencer@trystaff.ai) is submitted; until Google approves it every tool call answers "not enrolled in the required Developer Preview Program". Verification: branding published, scope justifications and intended use saved; the demo video link is still missing because YouTube is not yet available to the trystaff.ai account (`youtube.com/oops`, the service is on in the admin console). The recorded demo is `~/.config/trystaff/staff-ai-google-demo.mp4` (4.5 min, sign-in, consent, connection, tool list, hire, task). Once it is on YouTube, paste the link on the scopes page, save, and press Confirm on Verification center → Prepare for verification.
- Slack: connected for the Trystaff workspace with the seven registered `slack_*` tools.
- Linear: dynamic registration works; the sign-in reaches Linear's login and needs a Linear account.
- GitHub: the sign-in reaches GitHub's sudo verification (a code by email or passkey); complete it once in the browser.
- Canva: `mcp.canva.com` answers "Invalid redirect URI" until Canva allow-lists the callback through its MCP waitlist; nothing to fix on our side.
- Every Railway service carries `APP_URL`; without it the gateway and worker cannot use a stored OAuth grant and every provider tool listing fails with `provider_error`.

## 7. Inbox delivery

Connecting an MCP server does not create any subscription. GitHub, Linear, and Slack deliver to the native endpoints configured in step 5. Everything else, including Google Workspace, uses the normalized relay at `/api/webhooks/inbox/<connectionId>`, signed with the connection's own relay secret. The owner reveals or rotates that secret from Manage access on the connection. [Inbox delivery](inbox-delivery.md) has the signatures, the payload, and the test procedure.

## 8. Acceptance steps

Run these with a test WorkOS organization and test provider records, and record the results. Until then the deployment is not proven.

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

- [Convex with WorkOS AuthKit](https://docs.convex.dev/auth/authkit)
- [WorkOS AuthKit for Next.js](https://workos.com/docs/authkit/nextjs)
- [Convex environment variables](https://docs.convex.dev/production/environment-variables)
- [Convex `npx convex deploy`](https://docs.convex.dev/cli/reference/deploy)
- [Railway Dockerfiles](https://docs.railway.com/builds/dockerfiles)
- [Railway healthchecks](https://docs.railway.com/deployments/healthchecks)
- [Railway variables](https://docs.railway.com/variables)
- [Railway storage buckets](https://docs.railway.com/storage-buckets)
- [OpenAI Agents sessions](https://developers.openai.com/api/docs/guides/agents-api/sessions)
- [OpenAI MCP connections](https://developers.openai.com/api/docs/guides/agents-api/tools/mcp)
- [OpenAI hosted environments](https://developers.openai.com/api/docs/guides/agents-api/environments/openai-hosted)

## 6. The trystaff deployment (as set up on September 13, 2026)

What exists, created from this machine's CLI logins (Railway and Cloudflare as `spencer@trystaff.ai`, Convex as the trystaff account):

| Piece             | Where                                                                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Source            | GitHub `trystaff/staff-ai`, branch `main` (mirrors `platform-v4`)                                                                         |
| Convex project    | team `spencer-morris-739a5` (rename to `trystaff` in the dashboard), project `staff-ai`                                                   |
| Convex production | `combative-pig-574` at `https://combative-pig-574.convex.cloud`; dev `laudable-mongoose-734`                                              |
| Railway project   | `staff-ai` (`2e764c8c-ca28-49f7-9ed2-74cb71e8dee2`) in workspace "Spencer Morris's Projects"                                              |
| Railway services  | `web` (`Dockerfile`), `worker` (`Dockerfile.worker`), `gateway` (`Dockerfile.gateway`), all from `main`                                   |
| Railway domains   | web `web-production-34638.up.railway.app`, gateway `gateway-production-1a0f.up.railway.app`                                               |
| Custom domain     | `app.trystaff.ai` on `web`: CNAME `app` → `vr13r0en.up.railway.app`, TXT `_railway-verify.app` → the token `railway domain status` prints |
| Cloudflare        | account `efcd9eb4fb3e9ac231414a8867b3babe`; no zone and R2 not enabled yet                                                                |

Variables already set: Convex production has `AHQ_SERVICE_SECRET`, `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, `PLATFORM_ADMIN_USER_IDS`; every Railway service has `NEXT_PUBLIC_CONVEX_URL`, `AHQ_SERVICE_SECRET`, `CREDENTIAL_ENCRYPTION_KEY`; every Railway service has `APP_URL=https://app.trystaff.ai` (the gateway and worker need it to use a stored OAuth grant); `web` has the four WorkOS variables, `PLATFORM_ADMIN_USER_IDS`, and the `S3_*` set; `worker` has `OPENAI_API_KEY`, `MCP_GATEWAY_URL`, `WORKER_CONCURRENCY`, and the `S3_*` set. The generated secrets live only in `~/.config/trystaff/deploy.env` on the machine that ran the setup, and in the services.

WorkOS (production environment): the organization `trystaff` (`org_01M2CEJA0S187MRZAW96NEA45A`) exists with `spencer@trystaff.ai` as `admin` (`user_01M2CEJ9SQAYKZGWT8CFFYTCY8`, the platform administrator), the redirect URI is `https://app.trystaff.ai/callback`. Cloudflare R2 bucket `staff-ai-artifacts` is wired and write-tested. Requests on the Railway-generated host redirect to `app.trystaff.ai`.

WorkOS production has Magic Auth, Email + Password, and Google OAuth enabled, the JWT template with `name` and `email` saved, and the sign-out redirect `https://app.trystaff.ai/`. Google sign-in uses the Google Cloud project `staff-ai-508505` (organization trystaff.ai): consent screen "Staff AI", external audience, published (in production), privacy and terms links at `https://app.trystaff.ai/privacy` and `/terms`; OAuth client "Staff AI WorkOS" whose authorized redirect URIs include WorkOS's credential-specific callback `https://auth-request.trystaff.ai/sso/oauth/google/7WTffvb93WEE8h6EMhOPWWnFq/callback` (the environment's custom auth domain). The WorkOS settings were made through its MCP server (`~/.config/trystaff/mcp/mcp.py`); the Google credential itself had to be entered through the WorkOS dashboard, and the Google Cloud steps through the Cloud Console, both driven from a Chromium profile under `~/.config/trystaff/chrome-profile`. Optional: the three `VAPID_*` variables for web push, and Railway's draining seconds on `worker` (see operations.md).
