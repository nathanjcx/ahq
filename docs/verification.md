# Verification

What is proven, and what is not, as of September 12, 2026. No production account, provider credential, or live deployment exists for this build. Nothing below claims a real provider call succeeded.

`npm run typecheck` passes. `npm test` runs 65 tests in 12 files, all passing.

## The runtime harness

`web-tests/runtime.test.ts` runs the real gateway (`createGateway`) and the real approved-write executor against a `convex-test` backend and a fake upstream MCP server on loopback. The provider server is a small issue store with a version field, so corrections and preconditions are exercised end to end. Its cases:

- Only the reviewed tools inside the employee's capability are listed.
- A read is journaled with its duration.
- A blocked tool is refused and the denial is journaled.
- A write becomes a pending proposal with the record captured beforehand.
- An unknown run token gets a JSON-RPC `unauthorized` error.
- A malformed body is rejected.
- An approved write is executed against the provider.
- A correction restores the record, and a second correction is refused.
- A correction whose record moved on fails cleanly instead of leaving the outcome uncertain.
- The whole operation appears in the audit timeline.

`web-tests/worker-leases.test.ts` covers the replica-safety claims in [operations](operations.md): only one worker monitors a session at a time, an expired lease hands the session over and the former owner's heartbeat reports it lost, shutdown releases a lease while another worker's release is refused, and a worker with no free slots claims nothing.

## Convex and web tests by area

| File                      | Tests | Area                                                                                                                                         |
| ------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `actions.test.ts`         | 6     | Re-authorization before dispatch, no retry on unknown outcome, correction fields and version preconditions                                   |
| `admin-config.test.ts`    | 4     | Operational configuration in Convex: server admission, readiness, service config, registry validation, importing discovered tools as blocked |
| `data-boundaries.test.ts` | 6     | Tenant isolation, private employee packages, Clerk organization claims, revoked grants, registry access                                      |
| `data-jobs.test.ts`       | 8     | Job leases, one command per task, cancellation priority, terminal tasks, action results after revocation                                     |
| `inbox-routing.test.ts`   | 3     | Reviewed-tool grants at connect time, resource-routed delivery, shared connection visibility                                                 |
| `native-inbox.test.ts`    | 4     | GitHub, Linear, and Slack signature verification, freshness, normalization, deduplication                                                    |
| `projects.test.ts`        | 3     | Floor task visibility, staffing and archive rules, correction task context                                                                   |
| `server.test.ts`          | 8     | Sealing, network admission, tool grants, resource restrictions, relay signatures                                                             |
| `sharing.test.ts`         | 5     | Task privacy, who may decide a write, journaled denials, handoff acceptance, agent floor tools                                               |
| `usage.test.ts`           | 4     | Per period and model aggregation, session totals, the monthly cap, who may set it                                                            |

`web-tests/ui-smoke.spec.ts` is a Playwright pair: desktop navigation across every page with modal focus, Tab wrapping, Escape, focus restoration, and no page errors; and mobile navigation with the drawer closing and no horizontal overflow. It runs against a served build and needs a browser, so it is not part of `npm test`.

## UI inspected with temporary fixtures

The application has no seeded data, so each UI workstream rendered its populated states with a temporary fixture route and inspected them at desktop and mobile sizes. The workstreams report that every fixture and its authentication stub was removed before the production build. Nothing in these passes involved a live provider.

- **Task detail**: conversation, streaming phases, proposal card with arguments and correction limits, visibility menu, handoff sheet.
- **Audit tab**: interleaved messages, events, tool calls, and proposal transitions, denied entries with reasons, state diffs, and the JSON export.
- **Sharing panel**: connection visibility between private, named members, and workspace, the member list, and the borrowing member's view.
- **Floors**: floor directory, board with notes, system posts and handoff requests, staffing, and the lobby.
- **Operations**: readiness cards, per provider enabled servers, OAuth client form, native inbox secret state, and the tool registry sheet with modes, resource arguments, and correction descriptors.

Earlier passes were captured as screenshots of the production build with no connected account:

- [Integrations, desktop](screenshots/integrations-desktop.png)
- [Integrations, mobile](screenshots/integrations-mobile.png)
- [Manage access, desktop](screenshots/integration-access-desktop.png)
- [Google product picker, desktop](screenshots/google-products-desktop.png)
- [Project floors, desktop](screenshots/floors-desktop.png)
- [Project floors, mobile](screenshots/floors-mobile.png)
- [Floor staffing, desktop](screenshots/floor-staffing-desktop.png)
- [Floor staffing, mobile](screenshots/floor-staffing-mobile.png)
- [Office, desktop](screenshots/office-desktop.png)
- [Office, mobile](screenshots/office-mobile.png)

## Not verified

These paths have no automated coverage and no live run. Treat them as unproven until the acceptance steps in [deployment](deployment.md) are run with real accounts and the results recorded.

- **OpenAI Agents sessions.** Session creation, the event stream, reconnection and item recovery, the run time limit and cancellation, usage reporting, and artifact archiving are all exercised only against test doubles or not at all.
- **Real OAuth.** No provider consent screen has been completed. Discovery, token refresh, the multi-product Google flow, the re-consent fallback, and expiry marking are unverified.
- **Clerk members.** Organization membership lookup for the sharing member list goes through the Clerk API and has never run against a real organization.
- **Real webhooks.** Signature verification and normalization are unit tested with constructed payloads. No provider has delivered a real event to either endpoint.
- **Multiple replicas under load.** The lease invariants are tested in a single process against `convex-test`. Two real workers competing for jobs and sessions, and Convex read limits at depth, have not been measured.
- **S3 storage, the Docker image, and Railway.** Not exercised in this pass.

The audit tab displays the recorded journal. It does not rerun provider actions, and it cannot recover intermediate events the provider did not persist.
