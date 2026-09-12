# Platform v4 progress

Running log for the pass described in [the plan](platform-v4-plan.md). Updated at every phase boundary. Newest entries at the bottom.

## Phase 1: contracts and tooling (done, September 12, 2026)

Branch `platform-v4`, commit `f99ef34`.

- Floors and projects separated: the old `projects` table and every identifier became `floors`; real `projects` and `milestones` tables added.
- Schema: `shifts`, `reports`, `taskSummaries`, `memories`, `channels`, `posts`, `calendarEntries`, `meetings`, `meetingTurns`, `auditFindings`, `alerts`, `notifications`, `pushSubscriptions`, `workspaceSettings`; new fields on `installations` (floor, name, kind, overnight model), `tasks` (project, milestone, cadence, deadline, dependencies, `waiting` and `blocked` statuses), `floors.reserved`.
- `lib/contracts/` and `lib/ui-api/` split per domain with an index; `components/app/actions/` split the same way. Each phase-two workstream owns its own file in each.
- `convex/work.ts` split into `convex/lib/tasks.ts` and `convex/lib/posts.ts`.
- ESLint with type-aware rules, react-hooks, and import order; `npm run check` now runs lint. Three React compiler rules are warnings until the code-quality workstream clears them.
- Office lab: `app/office-lab` (guarded by `QA_FIXTURE=1`), five deterministic baselines under `web-tests/lab/baselines`, a frame-time probe with a configurable budget, `npm run test:lab`.
- Verification: typecheck, lint, 121 unit tests, production build, two clean baseline runs.

## Phase 2: backend (merged, September 12, 2026)

Five Opus agents in isolated worktrees: memory and janitor; schedule, calendar, plan; projects, roadmap, dependencies; meetings and audit findings; channels, alerts, notifications, triage. Known reconciliation points at integration: `ensureReservedInstance` (memory, meetings, channels each carry a copy), `isAttendedTime` (schedule owns `lib/time.ts`; triage carries a private copy), `Dashboard` contract additions from the schedule workstream, additive schema changes reported by each agent.

### Merged

- `agent/memory` (commit `6fc05cd`): memory tables, people and janitor operations, the working memory compiler, 11 new tests. Follow-up merged (`fcb0b4d`): `contest` names the competing entry and `resolveContest` acts on both sides.
- `agent/meetings` (commits through `170bb56`): meetings engine on hidden per-attendee session tasks, audit findings lifecycle, `ensureReservedInstance`. Job kinds for the worker: `meeting_prep`, `meeting_answer`, `meeting_wrapup`, `audit_run`.

- `agent/projects` (commit `54b3c95`): projects, milestones, roadmap proposal validation, task dependencies with waiting and blocked states released from `recordEvents` and `tasks:cancel`, 20 new tests.

- `agent/channels` (commits through `863cc63`): channels and posts replace floor boards, alerts with signed intake and dedupe, notifications ledger, triage floor and authority, five new routes, 9 new tests.
- `agent/schedule` (commits through `33fdeec`): pure time math and planner, settings, five-minute tick, shifts and reports, calendar with derived entries and agenda suggestions, plan projection, 46 new tests. Job kinds: `start_shift`, `review_shift`, `prep_turn`, `curation_run`, `audit_run`, `triage_run`, plus `meeting_prep`, `meeting_answer`, `meeting_wrapup`, `email_classify`.
- Integration fixes by the primary thread: same-millisecond ties in post paging, unread markers, and memory ordering made deterministic on Convex creation time.
- State after merge: typecheck clean, 213 unit tests, 36 files.

### Reconciliation (phase 2b, merged)

- `tasks.kind` field (`work | meeting | audit | curation | triage`) so the dashboard hides session-only tasks; one shared "session task without a start job" helper in `convex/lib/tasks.ts` for meetings, audits, curation, and triage.
- Janitor creation onto `ensureReservedInstance` (convex/lib/audit.ts); triage's private copy too.
- Marketplace list must exclude reserved versions (`category: 'Reserved'`).
- Findings and escalations posted to channels once the channels module lands; the calendar must consume `confirmOutcome`'s `meetingRequest`.
- The dashboard task projection must carry `projectId`, `cadence`, `deadlineAt`, `dependsOn`; `releaseDependents` scans `by_status` for waiting tasks, so an index on dependencies is worth adding when that table grows.
- The scheduler must call `ensureMeeting` at the prep lead, `ensureAuditRun` after hours, `ensureJanitor` per workspace, and order shifts with `openFindingsFor`.

Phase 2b outcome (`agent/integrate`): one reserved-instance helper in `convex/lib/reserved.ts` used by janitor, auditor, and triage; one attended-hours check and one settings owner in the schedule module; `tasks.kind` and `sessionKey` with `openSessionTask` for meeting, audit, and standing sessions; the dashboard hides session tasks and carries project, cadence, deadline, and dependency fields; the tick creates reserved staff, opens audit runs after hours, and prepares meetings at the lead; reports, findings, escalations, and contested claims post to channels; every meeting is booked through `createMeetingEntry`; new indexes on `usageReports` and `tasks`; `floorPosts` removed. 221 tests.

## Phase 3: infrastructure (in progress)

Four Opus agents: worker turns and internal tool servers with role enforcement (`agent/runtime`); marketplace listings, instances, hiring policy, studio preview (`agent/marketplace`); code quality helpers, lint to zero outside the office, CSS consolidation, typed boundaries (`agent/quality`); 3D rooms and props with new baselines (`agent/rooms`, started with phase 2b).

- Merged `agent/marketplace` (commits through `2ba4453`): listings as the unit with visibility, evidence, and counters; instances hired by count with names and floor staffing; hiring policy with requests; upgrade with readiness rollback; studio preview and version diff; `lib/instructions.ts` as the shared instruction composer. 236 tests. Note: `capacity.instances` in the plan projection still counts reserved instances while the hiring cap counts workers only; reconcile in the UI phase.
- Merged `agent/rooms` (commits through `8d4f6c0`): records basement, boardroom, triage floor, lobby calendar wall, floor props (memory binder, notebooks, contested and findings folders, task board with dependency strings, incident beacon, overnight lamp), figure kits for janitor, auditor, and triage; six new baselines and three re-accepted after an overlay relayout fix; 16 pure layout tests. 252 tests. Open item for phase five: draw calls per frame are about 2,000 on a floor at 1440 (pre-existing), far above the plan's 400; the performance workstream must instance and merge geometry before the probe can enforce that budget.
- Merged `agent/runtime`: worker turns for every job kind (`start_shift`, `review_shift`, `meeting_*`, `curation_run`, `audit_run`, `triage_run`, `email_classify`, `plan_project`), internal tool servers in the gateway (`astra_memory`, `astra_floor`, `astra_shift`, `astra_audit`, `astra_janitor`, `astra_triage`) with the role matrix in `lib/server/agents.ts`, one untrusted fence in `lib/server/untrusted.ts`, and a nine-scenario runtime day harness with a fake clock. Primary thread wired the two hooks the runtime flagged: `projects:create` and `replan` enqueue `plan_project` through `enqueuePlanningFor`, and Gmail inbox ingestion enqueues `email_classify`. Project views now count only work tasks so the planner's standing session task is invisible. 261 tests.
- Merged `agent/quality` (commits through `c5d8e90`): React compiler findings cleared outside the office (two real bugs: a replay rerender loop and `[object Object]` in the JSON view); `lib/text.ts` and `components/shared/time.ts` as the one home for text and clock formatting; `app/globals.css` down from 4,029 to 1,006 lines with one stylesheet per page directory; typed draft input derived from the Convex function; `components/README.md` records the conventions. The three React compiler rules are errors again; 19 errors remain, all in `components/office`, for the office workstream in phase four. 281 tests.
- Phase four scaffold by the primary thread: page ids `projects`, `calendar`, `records`, `audit`, `triage` with placeholder pages; `PageProps` in `components/app/page-props.ts` with project and meeting selection in the shell; `useUiQuery` (`components/shared/use-ui-query.ts`) answers from `app/qa/fixtures/*` under the fixture route so page-owned queries can be photographed; `ChannelFeed` and `IncidentStrip` stubs at their final import paths.

## Phase 4: interface (in progress)

Six Opus agents in isolated worktrees on top of the scaffold: projects and roadmap (`agent/projects`); calendar and boardroom (`agent/calendar`); records, audit, and settings sections (`agent/records`); floors, channels, triage, incident strip, and notifications (`agent/floors`); employees, hire by count, marketplace, and studio (`agent/employees`); the live office scene, day replay, lint to zero, and draw-call instancing (`agent/office`). A docs agent (`agent/docs`) rewrites architecture, operations, verification, and security for the backend that is final. The primary thread switched the worker to the shared instruction composer (`db9caa0`).
- Merged `agent/docs` (`e82affc`): architecture, operations, verification, and security rewritten against the code; `project-floors.md` reduced to a pointer. Gaps it found, for phase five (backend) and the running workstreams: the emergency rule cannot be reached because nothing re-pages on a schedule and the attempt count only looks back 20 minutes; only in-app notification delivers; `auditPolicy` is stored and never read; `overnightPolicy: 'off'` still runs the nightly audit; two job-kind lists are kept in step by hand; the `lobby` reserved floor and the `task` memory scope are unreachable; the alert secret is set through a platform-admin route; `README.md` still describes project floors. Already assigned: `capacity.instances` (employees workstream), activity model and draw-call assertion (office workstream).
