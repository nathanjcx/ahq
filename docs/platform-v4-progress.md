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
