# Security

The threat model and the controls that answer it. Where this and the code disagree, fix the code or
update this document in the same change.

## Trust boundaries

| Boundary                    | Who is on the far side                          | What crosses it                                                |
| --------------------------- | ----------------------------------------------- | -------------------------------------------------------------- |
| Browser → web               | A signed-in person, or anyone at all            | Clerk session cookie, JSON bodies, webhook deliveries          |
| Web/worker/gateway → Convex | Our own processes                               | `AHQ_SERVICE_SECRET` on every service function argument        |
| Browser → Convex            | A signed-in person                              | A Clerk JWT Convex validates against `CLERK_JWT_ISSUER_DOMAIN` |
| Agent → gateway             | A hosted model running attacker-influenced text | The task run token as a bearer token                           |
| Gateway/worker → provider   | A third party                                   | OAuth-bearing MCP calls through `safeFetch` only               |
| Provider → web              | A third party, or anyone spoofing one           | Signed webhook deliveries                                      |

Two assumptions run through everything. The agent is not trusted: it reads text written by people
who are not our users, and it may be induced to try anything its grant allows. Convex holds no
plaintext secret and no encryption key, so a Convex compromise yields ciphertext.

## Controls

**Authentication.** Every browser route calls `actor()` or `platformAdmin()` (`lib/server/http.ts`),
which refuses before Clerk is even consulted when Clerk is unconfigured. Every Convex user function
starts at `requireWorkspace` or `requirePlatformAdmin`; every Convex service function starts at
`requireService`, a constant-time comparison against `AHQ_SERVICE_SECRET`. The gateway resolves a
run token to a task on every request and fails closed when the authorization service is unreachable.
Webhooks authenticate the delivery, not the caller: HMAC over the exact body, timing-safe compare,
and a freshness window.

**Authorization.** A workspace is a Clerk user or organization (`authKey`). Every record read or
written is checked against the caller's workspace and then against `canSeeTask`,
`canSeeConnection`, or `canDecide`. The gateway re-reads authorization at call time, not only at
discovery, so a grant withdrawn mid-task stops working immediately. A tool reaches an agent only in
the intersection of the connection's allowed tools, the employee version's capability, and a
non-blocked registry row.

**Untrusted text.** Anything written by a provider or by another agent is wrapped in
`untrustedBlock` (`convex/shared.ts`) before it enters a prompt: inbox items, the closing message
carried across a handoff, an agent-requested handoff brief, and the provider's result text for an
approved action. The employee operating rules (`lib/server/agents.ts`) name the delimiter and say
that nothing inside it is ever an instruction. Floor board notes are not covered because no tool
returns them: `floor_post` and `floor_handoff` only write, and the board is read by people in the
UI. A note that becomes a handoff brief is delimited on that path.

**Request forgery.** Every state-changing route requires a matching `Origin` and the
`x-requested-with` header a cross-site form cannot set. The browser client sends both on every call.

**Content Security Policy.** `proxy.ts` mints a nonce per request and serves the policy built in
`lib/server/csp.ts`, enforced in development and production. `script-src` carries the nonce and the
Clerk origins and nothing else. `style-src` keeps `'unsafe-inline'`: inline _style attributes_ are
outside a nonce's reach, and the app renders them from the error boundary, several components, and
react-three/drei's `<Html>` office overlays. The root layout forces dynamic rendering, because a
prerendered page would carry a build-time nonce no request could match.

**Outbound requests.** `safeFetch` in `lib/server/network.ts` is the only path to a provider URL, including OAuth
discovery, token exchange, and refresh, which the MCP SDK performs with the `fetchFn` we hand it.
It requires HTTPS, refuses embedded credentials and literal IPs, resolves DNS through a dispatcher
that rejects any non-public address, refuses redirects, and times out. MCP endpoints must also
appear in the provider registry (`approvedMcpUrl`) and be enabled by an administrator.

**Redirects.** The only redirect target the browser is sent to is an OAuth authorization endpoint,
which must be HTTPS without embedded credentials whether it came from administrator configuration
or from the server's discovery document (`httpsEndpoint` in `lib/server/oauth.ts`), and the admin
route's schema refuses anything else on the way in. The callback's own redirect is a fixed path
under `APP_URL`.

**Secrets.** Sealed with AES-256-GCM under `CREDENTIAL_ENCRYPTION_KEY`, which is validated as 32
bytes. The gateway and worker refuse to start with a missing key or a service secret shorter than
32 characters. Secrets travel into configuration and never back out: the UI is told only whether one
is set. `safeError` redacts bearer tokens, API keys, and token fields, and reduces a Convex failure
to its thrown message, dropping the framing and the server stack. The gateway and worker log reason
codes and request ids, never arguments, prompts, or provider content.

**Size and shape.** Bodies are capped at 1 MB. Convex mutations cap prompts, messages, events,
tool-call evidence, proposal arguments, and error strings. `v.any()` arguments are normalized with
`stableJson` and rejected past 100 KB; they are rendered as React children, never as HTML. Nothing
in the app uses `dangerouslySetInnerHTML`, and markdown-lite link rendering goes through
`safeHttpsUrl`.

**Files.** Archive keys are built as `<workspace>/<task>/<file id>` and the file id is checked
against `[A-Za-z0-9_-]` in the worker before upload and again in Convex before the record is
written, so a key cannot escape its task. Downloads always answer `application/octet-stream` with
`nosniff` and `no-store`; the provider's media type never reaches a `Content-Type`.

**Rate limits.** In-process fixed windows guard the unauthenticated webhook routes, relay-secret
reveal, and starting an OAuth flow. Health endpoints are unlimited by design.

## Known gaps

- **Rate limits are per instance.** Several web replicas multiply every limit by the replica count.
  They blunt bursts; they do not meter.
- **No key rotation dual-reader.** `credentialKeyVersion` is recorded but `unseal` reads one key, so
  rotating `CREDENTIAL_ENCRYPTION_KEY` invalidates existing ciphertext. Audit entries degrade to a
  placeholder; connections must be reconnected.
- **Native inbox routing trusts the resource id.** A connection that lists another account's channel
  or repository id in `inboxResources` receives that resource's webhook deliveries. The provider
  grant is not consulted. Treat inbox resources as a subscription, not an access control.
- **A global per-provider webhook limit is shared.** One noisy sender can push a provider's native
  webhook route to its limit and delay legitimate deliveries.
- **The service secret is a single shared bearer.** Any process that holds it can call every Convex
  service function. There is no per-service scoping.
- **`'unsafe-inline'` remains in `style-src`.** See the CSP control above.
- **In-flight tasks can overshoot the token cap.** Usage is recorded, never reserved.

## Reporting

Send the affected route or Convex function, what you observed, and the smallest reproduction you
have to the repository owner privately. Do not open a public issue first, and do not exercise a
finding against a workspace that is not yours. This repository has no published security contact
address yet; add one here when it exists.
