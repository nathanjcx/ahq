# Verification

What is proven and what is not, as of September 12, 2026, during the platform v4 pass. No production
account, provider credential, or live deployment exists for this build. Nothing below claims a real
provider call succeeded.

| Check                | Command               | State today                                                     |
| -------------------- | --------------------- | --------------------------------------------------------------- |
| Types                | `npm run typecheck`   | Clean                                                           |
| Unit and integration | `npm test`            | 281 tests in 41 files, all passing                              |
| Lint                 | `npm run lint`        | **Fails**: 19 errors and 6 warnings, all in `components/office` |
| Everything           | `npm run check`       | Fails at the lint step                                          |
| Smoke (browser)      | `npm run test:ui`     | Not part of `npm test`                                          |
| Visual (browser)     | `npm run test:visual` | Not part of `npm test`                                          |
| Office baselines     | `npm run test:lab`    | Not part of `npm test`                                          |

## Types and contracts

`tsc --noEmit` covers the whole tree. On top of it, six type-level test files assert with
`expectTypeOf` that every Convex query the interface reads still extends the contract the interface
renders. They fail the type check rather than the run.

| File                      | Asserts                                                                                                                                                                                                     |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contracts.types.test.ts` | `workspace.dashboard`, `marketplace.list`, `floors.board`, `integrations.readiness`, `admin.providerConfigs`, `admin.registryTools`, `tasks.messages`, and the audit route response against `AuditTimeline` |
| `projects.types.test.ts`  | `projects.list`, `projects.get`, the stored roadmap proposal, and the projects `uiApi` names                                                                                                                |
| `schedule.types.test.ts`  | `schedule.settings`, `schedule.summary`, `plan.projection`, `calendar.entries`, `calendar.suggestAgenda`, `services/schedule:pacing`                                                                        |
| `memory.types.test.ts`    | `memory.list`, `memory.summaries`, `memory.taskSummary`, `services/memory:recall`                                                                                                                           |
| `channels.types.test.ts`  | `channels.list`, `channels.posts`, `channels.employeeFeed`, `triage.alerts`, `notifications.list`                                                                                                           |
| `meetings.types.test.ts`  | `meetings.get`, `audit.findings`, `audit.documents`                                                                                                                                                         |

Convex returns branded `Id` values where the contracts say `string`; an `Id` is a string subtype, so
the assertion holds while the interface keeps treating ids as opaque.

## Unit tests

Pure modules, run by Vitest without a browser or a deployment.

| File                        | Tests | What it protects                                                                         |
| --------------------------- | ----- | ---------------------------------------------------------------------------------------- |
| `schedule-time.test.ts`     | 13    | `lib/time.ts`: zones, DST, working windows, attended hours, `workingHoursBetween`        |
| `schedule-planner.test.ts`  | 22    | `planTick`: priority, preemption, caps, free slots, cheap mode, unique keys              |
| `memory-compiler.test.ts`   | 6     | Section order, importance ordering, budgets, the omission note                           |
| `projects-graph.test.ts`    | 7     | Topological order, cycles, readiness, dependents, milestone status                       |
| `text.test.ts`              | 20    | `lib/text.ts`: shortening, counting, slugs                                               |
| `paging.test.ts`            | 4     | `lib/paging.ts`: pages counted per batch, in-app rows excluded, the twenty-minute gate   |
| `projects-timeline.test.ts` | 5     | The roadmap timeline's lanes, flags, and dependency strings                              |
| `office-activity.test.ts`   | 36    | `deriveActivities`: every rule, its timeout, attention, bubble text, provider matching   |
| `office-labels.test.ts`     | 13    | Label priority, the collision pass and its stability, bubble ranking and placement       |
| `office-stations.test.ts`   | 6     | The desk grid, sticky homes, the minimum gap over every activity, the prop queues        |
| `office-rooms.test.ts`      | 21    | Records, boardroom, triage and lobby layout invariants: shelves, seats, cards, the wall  |
| `office-stage.test.ts`      | 5     | `deriveScene`: the board, the room, the hour, and the workspace's hours inside the day   |
| `office-replay.test.ts`     | 11    | `sceneAt` and `entryAt`: a recorded timeline replayed into the live floor's scene        |

## Convex tests

Each family runs against `convex-test` with a real schema and real mutations.

| File                      | Tests | Family                                                                                                                                         |
| ------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `schedule.test.ts`        | 20    | Settings and their validation, the tick's jobs, reserved staff, shifts, reports, inference, pacing, daily usage                                |
| `calendar.test.ts`        | 5     | Booking, changing, cancelling, derived deadlines and shifts and audits, agenda suggestions                                                     |
| `meetings.test.ts`        | 3     | Prep, questions and answers on per-attendee sessions, wrap-up outcomes, workspace isolation                                                    |
| `audit.test.ts`           | 5     | One auditor per day, findings recorded once, posted to the audit and floor channels, the open → addressed → verified → escalated path          |
| `memory.test.ts`          | 10    | Proposal and approval, supersession, the agent budget, janitor-only curation, contest on both sides, recall ranking                            |
| `channels.test.ts`        | 4     | Channel creation, per-viewer unread, the employee feed, addressed notes, one report one post                                                   |
| `triage.test.ts`          | 12    | Fingerprint dedupe, GitHub rule matching, the emergency path, the post-mortem and its memory proposal, signed intake                           |
| `projects.test.ts`        | 15    | Roadmap confirmation, cycles, waiting and blocked release, re-pointing, planner inputs, dashboard fields                                       |
| `marketplace.test.ts`     | 18    | Listings and visibility, hiring a count and its cap, policies and requests, renaming and moving, upgrade and rollback, studio preview and diff |
| `reserved.test.ts`        | 2     | One instance per reserved kind per workspace, and reserved versions kept out of the marketplace                                                |
| `floors.test.ts`          | 3     | Floors, staffing, posts, handoffs                                                                                                              |
| `data-jobs.test.ts`       | 8     | Queue mutations, leases, job and monitor claiming                                                                                              |
| `worker-leases.test.ts`   | 4     | One monitor per session, handover on expiry, release on shutdown, no claim without slots                                                       |
| `data-boundaries.test.ts` | 6     | Workspace isolation and record visibility                                                                                                      |
| `sharing.test.ts`         | 6     | Connection visibility, borrowing, who may decide                                                                                               |
| `usage.test.ts`           | 4     | Usage recording, the period aggregate, the token cap                                                                                           |
| `actions.test.ts`         | 6     | Re-authorization before dispatch, no retry on an unknown outcome, correction preconditions                                                     |
| `security.test.ts`        | 8     | Request forgery, audit authorization, error redaction, the CSP nonce, `untrustedBlock`, the service-secret length check                        |
| `admin-config.test.ts`    | 4     | Provider configuration and tool registry rules                                                                                                 |
| `inbox-routing.test.ts`   | 4     | Relay and resource-routed ingestion                                                                                                            |
| `native-inbox.test.ts`    | 4     | Native webhook signatures and normalization, with constructed payloads                                                                         |
| `server.test.ts`          | 8     | `safeFetch`, sealing, MCP helpers, tool policy                                                                                                 |
| `web-api.test.ts`         | 8     | The web routes: schemas, error envelope, status codes                                                                                          |
| `notify.test.ts`          | 6     | Web push delivery, pruning of gone endpoints, the public-only lookup, the unconfigured fallback                                                |

## The runtime harnesses

`web-tests/runtime.test.ts` (10 tests) runs the real gateway and the real approved-write executor
against `convex-test` and a fake upstream MCP server on loopback: tool listing inside the capability,
journaled reads, blocked tools, a write becoming a proposal with the record captured beforehand, an
unknown run token, a malformed body, an approved write, a correction and its refusal of a second, a
correction whose record moved on failing cleanly, and the whole operation in the audit timeline.

`web-tests/runtime-day.test.ts` (12 tests) drives one workspace day with a fake clock
(`vi.setSystemTime` over a Wednesday at 10:00 and 22:00 and the Thursday at 10:00) and a scripted
`TurnRunner`, so the turns exercise real gateway tools, real Convex mutations, and a real fake
provider — everything except the OpenAI client.

| Scenario                                                                    | What it holds                                                                    |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| A daily shift files its report into the record and the channel              | Shift row, `submit_report`, the report post                                      |
| A shift that ends without filing one has its report inferred                | The inferred-report path and its marker                                          |
| A waiting task's review shift posts feedback and files no report            | `review_shift`, `dependencyReviews`, no report                                   |
| A meeting prepares, answers, and wraps up into a confirmable outcome        | Per-attendee sessions, `meeting_prep`/`answer`/`wrapup`, outcome confirmation    |
| A curation turn merges two overlapping claims                               | `astra_janitor`, the merge and its archived inputs                               |
| The audit night's finding is delivered at the next shift start              | `read_reports` fenced, `submit_findings`, findings ahead of the task's own brief |
| A triage turn opens a pull request under the allow-list and nothing more    | Allow-list dispatch, `merge_pull_request` withheld inside attended hours         |
| The emergency allow-list opens only after three delivered, unanswered pages | The notification ledger, one journaled write, acknowledgement closing it again   |
| A worker token is refused the audit server, an auditor a provider write     | The role matrix at the gateway                                                   |

The harness also asserts that `internalServerTools` and the tools the gateway actually serves agree
for every role, because a session that names a tool the gateway does not serve would fail on the
first call rather than at startup.

## Browser suites

All three are Playwright and need a browser, so none is part of `npm test`. On this machine set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium`. Without `PLAYWRIGHT_BASE_URL` the config starts
`next dev` on port 3010 with Clerk and Convex unset, so that port has to be free.

Against a dedicated server — which is the pattern to use when running more than one suite, or when
port 3010 is busy:

```bash
QA_FIXTURE=1 npm run dev -- --port 3011 &
PLAYWRIGHT_BASE_URL=http://localhost:3011 \
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium \
QA_FIXTURE=1 npx playwright test web-tests/visual.spec.ts
```

`PLAYWRIGHT_BASE_URL` suppresses the managed server entirely, so the suite's own `QA_FIXTURE` must
match the server you started: the visual and lab suites need `QA_FIXTURE=1`, and the smoke suite
deliberately runs without it.

**Smoke**, `npm run test:ui` (`web-tests/ui-smoke.spec.ts`). An empty workspace with no fixture:
desktop navigation across every page, the settings dialog with focus movement, Tab wrapping, Escape,
and focus restoration, and mobile navigation with the drawer closing and no horizontal overflow. It
asserts no page error was thrown.

**Visual**, `npm run test:visual` (`web-tests/visual.spec.ts`). Sets `QA_FIXTURE=1` and runs against
`/qa`, which every other build answers 404. It photographs every page and every panel at 1440×1000
and 390×844, asserting on each shot that the document does not scroll horizontally and that no page
error was thrown, and walks the phone paths with no desktop equivalent: opening a task, inbox item,
and employee detail and coming back with the browser's back button and the back header, the review
bar's sheet, and the floor switcher. Shots land in `test-results/visual/`.

**Per-page visual suites**, one file per workstream, run the same way as the visual suite and against
the same fixture route. Each walks its pages at 1280×1000 and 390×844, asserts no page error and no
horizontal overflow, and writes its shots under `test-results/visual-<domain>/`:

| Spec                                 | What it photographs                                                                                                                       |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `web-tests/visual-projects.spec.ts`  | The projects list, a running project, a roadmap awaiting review with its bottleneck questions, the planner working, the new-project sheet |
| `web-tests/visual-calendar.spec.ts`  | The calendar week, the day, the agenda list on a phone, the scheduling sheet, the boardroom                                               |
| `web-tests/visual-records.spec.ts`   | The records basement, the audit room, every section of the settings panel                                                                 |
| `web-tests/visual-floors.spec.ts`    | A floor's channel, feeds, work, team, and binder; the Triage floor; the notifications ledger                                              |
| `web-tests/visual-employees.spec.ts` | The employees page, the marketplace, the marketplace studio                                                                               |

**Office baselines**, `npm run test:lab` (`web-tests/lab/office.spec.ts`). Fifteen deterministic
scenes from `/office-lab` at 1280×720, reduced motion, a fixed seed, and 1.5 seconds to settle the
first frames, the label pass, and the lighting blend: `lobby-day`, `floor-day`, `floor-night`,
`floor-dots`, `floor-celebrate`, `floor-props`, `after-hours`, `lobby-calendar`, `records`,
`boardroom`, `triage`, and the four the activity model added — `meeting-live` (the boardroom with a
speaker holding the floor), `audit-night` (the auditor working an empty floor after hours),
`incident` (triage on an open incident, with the notice the emergency allow-list leaves by the door),
and `day-replay` (a whole day replayed and stopped at three in the afternoon, with the day's own
board on the wall and a string from whoever is waiting to the card they wait on). Images live in
`web-tests/lab/baselines/`; the tolerance is `maxDiffPixelRatio: 0.01`, one percent, set in
`playwright.config.ts`.

The same file holds the performance probe: `/office-lab?preset=floor-day` at 1440×900 with
`width=1440&height=860`, which sizes the stage to the viewport, so the frame time is a measurement of
a 1440 canvas rather than of the 1280 one the baselines fix. Twenty frames are sampled through
`requestAnimationFrame` and the median asserted. The plan's budget is 16 ms,
and `LAB_FRAME_BUDGET_MS` sets it; the default is 700 ms, because this machine renders through
SwiftShader with no GPU. Set the real budget on a machine with one. The probe also asserts the plan's
draw-call budget: under 400 calls on a floor at 1440, read from `data-office-stats`. Static geometry
is merged per material family, which brought a floor from roughly 2,100 calls to roughly 300.

**Accepting a changed baseline.** Look at the image first. Playwright writes the actual, expected,
and diff images under `test-results/`; open the diff and satisfy yourself that the change is the one
you made. Then:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium QA_FIXTURE=1 \
  npx playwright test web-tests/lab --update-snapshots
```

Run it twice and confirm the second run is clean, so the baseline you commit is stable rather than a
lucky frame. A baseline is never accepted without a person having looked at it.

## Lint

`npm run lint` is `eslint .` over the whole tree, configured in `eslint.config.mjs`:
`typescript-eslint`'s type-checked preset with `projectService`, so the rules see real types;
`no-floating-promises`, `no-misused-promises`, `no-explicit-any`, and inline type imports as errors;
`import-x/no-duplicates` as an error and `import-x/order` as a warning; and the React compiler rules
that ship with `eslint-plugin-react-hooks` v7. Tests relax `no-explicit-any` and
`no-non-null-assertion`.

It passes over the whole tree, `components/office` included. The React compiler findings that used to
sit there were fixed at source rather than suppressed; two of them were real bugs, a replay rerender
loop and a `[object Object]` in the JSON view. `npm run check` runs lint, typecheck, and the unit
tests together.

## Not verified

These have no automated coverage and no live run. Treat them as unproven until the acceptance steps
in [deployment](deployment.md) are run with real accounts and the results recorded.

- **OpenAI Agents sessions.** Session creation, the event stream, reconnection and item recovery, the
  run-time limit and cancellation, usage reporting, and artifact archiving are exercised only against
  test doubles. The runtime day harness replaces the whole OpenAI client with a scripted
  `TurnRunner`, so what a real model does with these prompts and tools is untested by construction.
- **Real OAuth.** No provider consent screen has been completed. Discovery, token refresh, the
  multi-product Google flow, the re-consent fallback, and expiry marking are unverified.
- **Real webhooks.** Signatures and normalization are unit tested with constructed payloads. No
  provider has delivered a real event to any endpoint, including the alert intake.
- **Notification delivery.** Only `in_app` delivers, and it delivers by writing the row that was
  already written. Push, Slack, and email have no transport, so nothing tests one.
- **The emergency rule end to end.** The gateway's gate is tested; the ledger reaching three
  delivered, unanswered pages is not, because nothing in production sends the second and third page.
  The harness sends them itself.
- **Clerk members.** Organization membership lookup for the sharing member list has never run against
  a real organization.
- **Sound.** The WebAudio graph, its cues, and the ambient pad have never been exercised by a test;
  a browser only creates that graph from a user gesture.
- **Multiple replicas under load.** The lease invariants are tested in a single process against
  `convex-test`. Two real workers competing, and Convex read limits at depth, have not been measured.
- **S3 storage, the Docker image, and Railway.** Not exercised in this pass.
- **The office under live data.** The office takes the dashboard from the page rather than
  subscribing for it, so `/qa` now photographs every room dressed by the fixture. What is still
  untested is the same rooms against a Convex subscription: no browser suite has run one.
- **Every page against live data.** The per-page visual suites walk the roadmap, the calendar week,
  the records room, the audit documents, and the incident timeline, but they walk them against the
  `/qa` fixture. No browser suite has rendered one of those pages from a Convex subscription.

The audit tab displays the recorded journal. It does not rerun provider actions, and it cannot
recover intermediate events the provider did not persist.
