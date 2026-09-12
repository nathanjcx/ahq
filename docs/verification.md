# Verification

What is proven, and what is not, as of September 12, 2026. No production account, provider credential, or live deployment exists for this build. Nothing below claims a real provider call succeeded.

`npm run typecheck` passes. `npm test` runs 121 tests in 19 files, all passing.

## Unit and integration tests

| File                      | Tests | Area                                                                                                                    |
| ------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------- |
| `runtime.test.ts`         | 10    | The gateway and the approved-write executor end to end, against a fake provider                                         |
| `office-activity.test.ts` | 19    | `deriveActivities`: every activity rule, its timeout, attention, bubble text, provider matching                         |
| `office-labels.test.ts`   | 10    | Label priority, the collision pass and its stability, bubble ranking and placement                                      |
| `office-stations.test.ts` | 6     | The desk grid, sticky homes, the minimum gap, the lectern queue, consoles, handoff pairs                                |
| `office-replay.test.ts`   | 4     | `sceneAt` and `entryAt`: a recorded timeline replayed into the same scene the live floor builds                         |
| `data-jobs.test.ts`       | 8     | Queue mutations, leases, job and monitor claiming                                                                       |
| `server.test.ts`          | 8     | `safeFetch`, sealing, MCP helpers, tool policy                                                                          |
| `web-api.test.ts`         | 7     | The web routes: schemas, error envelope, status codes                                                                   |
| `actions.test.ts`         | 6     | Re-authorization before dispatch, no retry on an unknown outcome, correction fields and version preconditions           |
| `data-boundaries.test.ts` | 6     | Workspace isolation and record visibility                                                                               |
| `security.test.ts`        | 6     | Request forgery, audit authorization, error redaction, the CSP nonce, `untrustedBlock`, the service secret length check |
| `sharing.test.ts`         | 6     | Connection visibility, borrowing, who may decide                                                                        |
| `admin-config.test.ts`    | 4     | Provider configuration and tool registry rules                                                                          |
| `inbox-routing.test.ts`   | 4     | Relay and resource-routed ingestion                                                                                     |
| `native-inbox.test.ts`    | 4     | Native webhook signatures and normalization, with constructed payloads                                                  |
| `usage.test.ts`           | 4     | Usage recording, the period aggregate, the token cap                                                                    |
| `worker-leases.test.ts`   | 4     | Replica safety: one monitor per session, handover on expiry, release on shutdown, no claim without slots                |
| `projects.test.ts`        | 3     | Floors, staffing, board posts, handoffs                                                                                 |
| `contracts.types.test.ts` | 2     | Type-level: every Convex query the interface reads extends its contract, and the audit response satisfies the timeline  |

`contracts.types.test.ts` asserts with `expectTypeOf`, so it fails the type check rather than the run. It covers `workspace.dashboard`, `marketplace.list`, `projects.board`, `integrations.readiness`, `admin.providerConfigs`, `admin.registryTools`, `tasks.messages`, and the audit route response against `AuditTimeline`.

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

## Browser suites

Both suites are Playwright and need a browser, so neither is part of `npm test`. On this machine set `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium`. Without `PLAYWRIGHT_BASE_URL` the config starts `next dev` on port 3010 with Clerk and Convex unset, so port 3010 has to be free.

`npm run test:ui` runs `web-tests/ui-smoke.spec.ts` against a server with no fixture: desktop navigation across every page with modal focus, Tab wrapping, Escape, focus restoration, and no page errors; and mobile navigation with the drawer closing and no horizontal overflow.

`npm run test:visual` sets `QA_FIXTURE=1` and runs `web-tests/visual.spec.ts` against `/qa`, the fixture route in `app/qa/`. Every other build answers 404 there. The suite photographs every page and every panel at 1440x1000 and 390x844, and on each shot asserts that the document does not scroll horizontally and that no page error was thrown. It also walks the phone paths that have no desktop equivalent: opening a task, inbox item and employee detail and coming back with the browser's back button and the back header, the review bar's sheet, and the floor switcher. Screenshots land in `test-results/visual/`.

## Screenshots

`docs/screenshots` holds the reviewed captures. All nineteen were taken against a build with no connected account: either an empty workspace, the visual fixture, or the temporary office harness described below.

- [office-desktop.png](screenshots/office-desktop.png): the Office page of an empty workspace, with the preview-mode banner, the lobby, and a furnished but unstaffed room.
- [office-mobile.png](screenshots/office-mobile.png): the same empty Office on a phone, directory, lobby and room stacked.
- [office-live-desktop.png](screenshots/office-live-desktop.png): a staffed floor at 13:00 with name pills, two speech bubbles, and the lectern's waiting count.
- [office-live-mobile.png](screenshots/office-live-mobile.png): the same floor on a phone, labels defaulted to dots, one bubble, the legend and the sound toggle.
- [office-night-desktop.png](screenshots/office-night-desktop.png): the same floor at 22:00, interior lamps carrying the room against a dark sky.
- [office-replay-desktop.png](screenshots/office-replay-desktop.png): replay open over the floor, with the task picker, the scrubber, the 10x marker, and the entry caption under it.
- [floors-desktop.png](screenshots/floors-desktop.png): the building directory, a floor's brief, its live room, its staffing, and the work queue.
- [floors-mobile.png](screenshots/floors-mobile.png): the same floor page stacked on a phone.
- [floor-staffing-desktop.png](screenshots/floor-staffing-desktop.png): the Edit floor panel with the brief, the staffing picker, and the archive control.
- [floor-staffing-mobile.png](screenshots/floor-staffing-mobile.png): the same panel as a bottom sheet.
- [mobile-floor-board.png](screenshots/mobile-floor-board.png): a floor on a phone with the Board, Work and Team switch, skeleton rows while the board loads, and the review bar.
- [mobile-tasks.png](screenshots/mobile-tasks.png): the Tasks list on a phone with status marks, floor tags, sharing lines, and the review bar above the bottom.
- [mobile-review-sheet.png](screenshots/mobile-review-sheet.png): the review sheet deciding a pending Linear write, with Reject and Approve pinned to its footer.
- [mobile-drawer.png](screenshots/mobile-drawer.png): the navigation drawer open over a floor, with its unread and review counts.
- [mobile-integrations.png](screenshots/mobile-integrations.png): Integrations on a phone from the fixture: connected, degraded and unconfigured providers, and a connection shared by another member.
- [integrations-desktop.png](screenshots/integrations-desktop.png): Integrations on a desktop, each card naming what is still missing, and an expired Google Workspace grant offering reconnect.
- [integrations-mobile.png](screenshots/integrations-mobile.png): the same empty-workspace Integrations page on a phone.
- [integration-access-desktop.png](screenshots/integration-access-desktop.png): Manage access for a GitHub connection: the reviewed tools that may be used, and the repositories to follow for the inbox.
- [google-products-desktop.png](screenshots/google-products-desktop.png): the Google Workspace product picker, with its developer-preview notice.


## Not verified

These paths have no automated coverage and no live run. Treat them as unproven until the acceptance steps in [deployment](deployment.md) are run with real accounts and the results recorded.

- **OpenAI Agents sessions.** Session creation, the event stream, reconnection and item recovery, the run time limit and cancellation, usage reporting, and artifact archiving are all exercised only against test doubles or not at all.
- **Real OAuth.** No provider consent screen has been completed. Discovery, token refresh, the multi-product Google flow, the re-consent fallback, and expiry marking are unverified.
- **Clerk members.** Organization membership lookup for the sharing member list goes through the Clerk API and has never run against a real organization.
- **Real webhooks.** Signature verification and normalization are unit tested with constructed payloads. No provider has delivered a real event to either endpoint.
- **Sound.** The WebAudio graph, its cues, and the ambient pad have never been exercised by a test. A browser only creates that graph from a user gesture, so the visual suite runs with sound off.
- **Multiple replicas under load.** The lease invariants are tested in a single process against `convex-test`. Two real workers competing for jobs and sessions, and Convex read limits at depth, have not been measured.
- **S3 storage, the Docker image, and Railway.** Not exercised in this pass.
- **The office under live data.** `/qa` renders the fixture through a Convex client pointed at an unreachable deployment, so the dashboard subscription never resolves and the office there is furnished but empty. The speech bubbles, attention rings and lectern counts in the office screenshots were rendered from a temporary harness that fed the same derivation directly, and that harness is not in the tree. `office-activity.test.ts`, `office-labels.test.ts`, `office-stations.test.ts` and `office-replay.test.ts` cover the rules behind them; nothing covers the office rendering real journal data in a browser.

The audit tab displays the recorded journal. It does not rerun provider actions, and it cannot recover intermediate events the provider did not persist.
