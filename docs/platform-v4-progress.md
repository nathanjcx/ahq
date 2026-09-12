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

## Phase 2: backend (in progress)

Five Opus agents in isolated worktrees: memory and janitor; schedule, calendar, plan; projects, roadmap, dependencies; meetings and audit findings; channels, alerts, notifications, triage. Known reconciliation points at integration: `ensureReservedInstance` (memory, meetings, channels each carry a copy), `isAttendedTime` (schedule owns `lib/time.ts`; triage carries a private copy), `Dashboard` contract additions from the schedule workstream, additive schema changes reported by each agent.

### Merged so far

- `agent/memory` (commit `6fc05cd`): memory tables, people and janitor operations, the working memory compiler, 11 new tests. Follow-up merged (`fcb0b4d`): `contest` names the competing entry and `resolveContest` acts on both sides.
- `agent/meetings` (commits through `170bb56`): meetings engine on hidden per-attendee session tasks, audit findings lifecycle, `ensureReservedInstance`. Job kinds for the worker: `meeting_prep`, `meeting_answer`, `meeting_wrapup`, `audit_run`.

- `agent/projects` (commit `54b3c95`): projects, milestones, roadmap proposal validation, task dependencies with waiting and blocked states released from `recordEvents` and `tasks:cancel`, 20 new tests.

### Reconciliation list for the end of phase 2

- `tasks.kind` field (`work | meeting | audit | curation | triage`) so the dashboard hides session-only tasks; one shared "session task without a start job" helper in `convex/lib/tasks.ts` for meetings, audits, curation, and triage.
- Janitor creation onto `ensureReservedInstance` (convex/lib/audit.ts); triage's private copy too.
- Marketplace list must exclude reserved versions (`category: 'Reserved'`).
- Findings and escalations posted to channels once the channels module lands; the calendar must consume `confirmOutcome`'s `meetingRequest`.
- The dashboard task projection must carry `projectId`, `cadence`, `deadlineAt`, `dependsOn`; `releaseDependents` scans `by_status` for waiting tasks, so an index on dependencies is worth adding when that table grows.
- The scheduler must call `ensureMeeting` at the prep lead, `ensureAuditRun` after hours, `ensureJanitor` per workspace, and order shifts with `openFindingsFor`.
