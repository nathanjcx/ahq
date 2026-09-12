# Platform v4 plan

Written September 12, 2026. This is the implementation contract for one pass. Where this document and the code disagree after the pass, the code is wrong or this document is updated in the same change.

## 1. Domain model

The workspace is the tower. It has floors, projects, employees, people, a schedule, and a memory. Today the code calls a floor a project; this pass separates them.

| Object              | Meaning                                                                                                       | Key fields                                                                                                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `floors`            | A room and a team. Reserved floors: Lobby, Triage.                                                            | name, brief, staff (installation ids), archivedAt                                                                                                                                                                    |
| `projects`          | A plan that spans floors: roadmap, deadlines, meetings.                                                       | name, brief, floorIds, status, milestones, createdBy                                                                                                                                                                 |
| `milestones`        | Ordered steps of a project with a deadline and tasks.                                                         | projectId, order, title, deadlineAt, taskIds, dependsOn (milestone ids)                                                                                                                                              |
| `installations`     | One employee instance on one floor. Hiring the same version again creates another instance with its own name. | versionId, floorId, name, status, overnightModel?                                                                                                                                                                    |
| `tasks`             | One unit of work for one instance.                                                                            | projectId?, milestoneId?, floorId, cadence (`once` or `daily`), deadlineAt?, dependsOn (task ids), status including `waiting` and `blocked`                                                                          |
| `shifts`            | One working session of a daily task on one day.                                                               | taskId, date, model, startedAt, endedAt, reportId?                                                                                                                                                                   |
| `reports`           | Structured progress report at the end of a shift.                                                             | taskId, shiftId, done, inProgress, blockedOn, next, risks, deadlineConfidence, inferred                                                                                                                              |
| `memories`          | Atomic claims in four scopes.                                                                                 | scope (`task`, `agent`, `floor`, `project`, `workspace`), scopeId, kind, text, tags, source, author, confidence, status (`proposed`, `active`, `contested`, `archived`), supersedesId, expiresAt                     |
| `taskSummaries`     | Structured outcome of a finished task.                                                                        | taskId, outcome, decisions, openQuestions, artifactIds, text                                                                                                                                                         |
| `channels`, `posts` | Floor, project, workspace, triage, and audit channels; typed posts.                                           | kind (`note`, `report`, `feedback`, `alert`, `finding`, `decision`, `handoff`, `system`), author, taskId?, handoff?                                                                                                  |
| `calendarEntries`   | Meetings created by people; deadlines, shifts, and audits derived.                                            | kind, startsAt, endsAt, projectId?, floorId?, attendees, agenda, status                                                                                                                                              |
| `meetings`          | A boardroom session.                                                                                          | calendarEntryId, status, transcript, prepReports, outcomes                                                                                                                                                           |
| `auditFindings`     | One finding from an auditor.                                                                                  | employeeId, taskId?, severity, claim, evidence, requiredAction, status (`open`, `addressed`, `verified`, `escalated`)                                                                                                |
| `alerts`            | Normalized incidents.                                                                                         | source, fingerprint, severity, title, url, status, triageTaskId, affectedFloorIds                                                                                                                                    |
| `notifications`     | Attempts to reach a person.                                                                                   | subject, kind, channels, sentAt, acknowledgedAt                                                                                                                                                                      |
| `workspaceSettings` | Schedule, budgets, policies, plan.                                                                            | timezone, workingDays, hours, attendedHours, overnightPolicy (`off`, `audits_only`, `cheap`), dailyTokenCap, triageAllowance, auditPolicy, triageAuthority, emergencyAllowList, plan (`subscription`, `byok`), rates |

Reserved employee kinds: `worker` (default), `janitor`, `auditor`, `triage`. Reserved kinds are created by the workspace, not hired from the marketplace.

## 2. Features

### Projects and roadmaps

- New project flow: name, brief, choose one or more floors. A planner turn proposes staffing from each floor's instances, milestones with deadlines, tasks per milestone with dependencies, parallelism per floor, and meeting points. The roadmap renders as a timeline with one row per instance. The planner prompts on bottlenecks, for example one Canva instance on Marketing with four parallel tasks due the same week: hire more, or move the deadline. The person edits everything and confirms. Confirmation creates daily tasks with deadlines, calendar entries, and meetings.
- The project page shows the roadmap, the project channel, milestone status, and the same prompts whenever reports say a milestone is behind. Replanning proposes changes; nothing changes without confirmation.
- Estimates come from history: median tokens and working hours per task by employee version and kind, with a stated confidence; without history the planner uses per-model defaults and says so.

### Instances, capacity, and cost

- Hiring creates a named instance on a floor; hiring again creates another. One running shift per instance, so the count is the parallelism. The employees page groups instances by version and floor.
- Plans: `subscription` has a monthly token allowance and a maximum concurrent instances; `byok` uses the workspace's own key and an admin-maintained per-model rates table, shown as an estimate. Usage stays token-based; cost is a projection on top. The roadmap shows projected allowance consumption or spend and flags a plan that exceeds it.

### Time: schedule, shifts, pacing

- Fixed defaults: nine to six local, Monday to Friday, overnight `audits_only`, attended hours equal to working hours. A prominent Schedule section in settings changes all of it.
- A daily task runs one shift per working day inside hours on a persistent session, with working memory refreshed each shift. Each shift ends with a structured report; a missing report is inferred from the journal and marked.
- Order inside a shift: open audit findings first, then project work. Findings policy is `soft`: other work waits behind findings that day and is not blocked on later days.
- Waiting: a task whose dependency is unfinished sits in `waiting`; once per working day, or on a dependency milestone, it runs a bounded review shift that reads the dependency's latest report and artifacts and posts feedback to the channel.
- Pacing: working memory carries the deadline, working hours left, the next meeting and its agenda, and an ahead, on track, or behind note from the employee's own last report. Behind employees document what cannot be finished and bring it to the meeting.
- Overnight `cheap`: shifts outside hours run on the instance's overnight model with smaller step budgets and a checkpoint report per step.
- Scheduler: a Convex cron every five minutes runs a pure planner per workspace over schedule, caps, slots, and priorities, and enqueues ordinary leased jobs: shifts, review shifts, prep turns, curation, audits, triage.

### Calendar and meetings

- Calendar page: week and day views, one row per instance, shifts as blocks, deadlines as markers, meetings as events, audits and triage as tower rows. Employee and floor pages show their slice. Mobile is an agenda list.
- Scheduling a meeting: time, project or floor, attendees, purpose. Suggested agenda from work due before the meeting: milestones and tasks with deadlines before it, reports flagged behind, contested memory, open findings, open alerts. Edit and confirm.
- Preparation: at a lead of sixty working minutes, each attendee runs a bounded prep turn producing a report against the agenda; reports are readable before the meeting.
- Boardroom: the person opens the meeting, reads the reports, and types questions addressed to one attendee or everyone. Addressed employees answer in parallel bounded turns with the meeting context, their report, their memory, and the transcript; everyone-questions get short answers. Closing runs a wrap-up per attendee that proposes action items, deadline changes, and a next meeting; the person confirms which become tasks, calendar entries, or replans. Tokens are shown per question.

### Channels and feeds

- Floor, project, workspace, triage, and audit channels with typed posts. Every instance has a feed of everything it posted. People post anywhere they can see. Agents read their floor, their project, and the workspace channel through `read_board`.

### Memory and the janitor

- Five scopes of atomic claims with supersession, expiry, and a lifecycle; contested claims never reach a model.
- An injection compiler builds a budgeted Working memory block per shift: workspace, floor, project, agent notes, recent summaries, schedule and pacing; usage records its tokens.
- Tools: `remember`, `recall`, `read_board`, `read_memory`. Agent scope activates within budget; floor and project scope activate after curation; workspace scope after admin approval.
- Janitor: one per workspace, memory tools only, runs daily after hours and after every twenty proposals: merge, contest, archive, promote. Contested claims become channel questions.
- Records page: tabs per scope, provenance and supersession chains, approve and archive, budget meters, conflicts queue, janitor log.

### Auditors

- One team per workspace, read tools only: reports, journals, tool calls, artifacts, memory, channels, and a code reader over archived artifacts. They run after working hours.
- Checks: report claims against the journal, fabricated data, failing or missing tests, code quality, copy quality against a workspace standard the admin writes into workspace memory, and whether yesterday's findings were addressed.
- Output: findings grouped into a document per instance, posted to the audit and floor channels, delivered first thing in the next shift, re-verified the following night, escalated to the workspace channel and the next meeting's agenda when ignored.

### Triage

- Reserved Triage floor with its own team, channel, allowance, and page. Alerts preempt working hours.
- Intake: GitHub issues and comments by label or keyword through the native webhook; a generic signed alert endpoint with a normalized shape for PostHog, uptime, and cloud health notices; Gmail through the relay with a classifier turn. Duplicate fingerprints attach to the open alert. PostHog joins the provider registry if its hosted MCP server is reachable at build time.
- Flow: reproduce, post an incident notice to affected floor channels, inject a hold note into affected working memory, fix as a pull request, post a post-mortem with cause, fix, prevention, and the regression test, propose a workspace memory entry, close when confirmed.
- Authority: the Triage floor may open pull requests under a narrow allow-list without per-proposal approval. Merging and deploying need approval inside attended hours. Outside attended hours, after three notification attempts spaced over twenty minutes with no acknowledgement, the triage employee may use the emergency allow-list (merge and deploy tools the admin names) to fix production, must verify the fix, and must file an incident report: the issue, reproduction, the fix, why it acted without permission, side effects and knock-on risks. Every step is journaled; the report goes to the workspace channel and the next meeting.
- Notifications: in-app, browser push, and optional Slack or email connectors; an attempt counts only when at least one channel delivered.
- A global incident strip shows open alerts; affected floors show a lamp.

### Marketplace

- Listings become the unit: one per employee with a current version, visibility (`published`, `hidden`, `retired`), evidence (sample task, sample output, optional link), and usage counts. Instances show update available; upgrade re-checks capabilities and readiness.
- Hiring policy: `anyone`, `admins`, or `approval`. Hiring targets a floor and takes a count.
- Studio: instruction preview including persona and memory placeholders, capability picker from the registry, publish diff against the current version.

### The building

- Lobby: calendar wall with today's shifts and meetings; the elevator.
- Floors: binder on the meeting table (floor memory), notebooks on desks (agent memory), a contested folder and an approvals tray on the lectern, a wall board with task cards and dependency strings, a findings folder on an instance's desk, an amber lamp during incidents, low light outside hours, desk lamps for overnight cheap shifts.
- Top-floor boardroom: attendees ride the elevator and sit when a meeting starts; answers appear as bubbles beside the transcript; the room empties on close.
- Basement records room: shelves per scope with fill from budgets, floor and project binders, task dossiers, the janitor's desk and cart.
- Triage floor: alert board lit per open incident.
- Auditors after hours: distinct look, clipboards, walking the floors; an instance with an open finding has an uneasy idle.
- Activity model additions: `reading_memory`, `remembering`, `filing`, `waiting`, `blocked`, `reviewing_peer`, `preparing`, `presenting`, `answering`, `auditing`, `triaging`, `uneasy`, `off_shift`.
- Replay includes memory, meeting, audit, and triage events.

## 3. How the parts talk

- Convex holds every table and every scheduling input. The scheduler cron calls a pure planner in `convex/lib/schedule.ts` that returns jobs to enqueue; the worker claims them with the existing leases. No service holds state.
- The worker runs shift, prep, answer, wrap-up, curation, audit, and triage turns as ordinary sessions with role-specific tool sets. Tool sets come from the registry plus internal servers: `astra_floor` (post, handoff), `astra_memory` (remember, recall, read_board, read_memory), `astra_audit` (read reports, journals, artifacts), `astra_triage` (alert tools and the allow-lists).
- The gateway serves the internal servers under the same run token, journals every call, and enforces role: a worker instance cannot reach audit or triage tools, an auditor cannot reach provider writes, and emergency tools are exposed only after the gateway checks attended hours and the notification ledger.
- Working memory is compiled by `lib/server/memory.ts` from Convex reads at turn start; the same compiler feeds prep turns and meeting answers with the meeting context added.
- The UI reads through the generated Convex references behind `uiApi`; web routes keep the zod schemas and typed client. New routes: calendar export, meeting transcript export, alert intake, notification acknowledgement, push subscription.
- The office reads the dashboard plus channels and calendar and derives activities from the same pure model that powers replay.

## 4. UI

- Office: lobby with the calendar wall and directory; floor pages with Board, Work, Team, and a Memory binder; the records room; the boardroom; the Triage floor.
- Projects: list, new-project flow with the planner and roadmap timeline, project page with roadmap, channel, milestones, prompts, replan.
- Calendar: week and day, rows per instance, tower rows, meeting scheduling with suggested agenda.
- Meeting: prep reports, transcript with addressed questions, per-question cost, close with confirmable outcomes.
- Employees: instances grouped by version and floor, hire with count, feed, memory notebook, findings.
- Records: scopes, chains, approvals, budgets, conflicts, janitor log.
- Audit: nightly documents per instance, statuses, escalations.
- Triage: incident strip everywhere, floor page with alerts, timeline, reports.
- Settings: Schedule (hours, attended hours, overnight), Plan and budgets (allowance or rates, daily cap, triage allowance), Policies (hiring, audit, triage authority, emergency allow-list, notification channels), Standards (the copy and code standard text).
- Marketplace and Studio as described.
- Mobile: master-detail, bottom sheets, review bar, agenda-list calendar, incident strip.

## 5. Code quality

- ESLint with type-aware rules, react-hooks, and import order in `npm run check`.
- One helper per concern: `lib/text.ts`, `lib/time.ts` (timezone and working-hours math, pure), `convex/lib/` for visibility, budgets, schedule, text limits, and task creation (replacing `work.ts` and parts of `shared.ts`); `components/shared/` for time formatting and layout primitives.
- No untyped objects across boundaries: typed draft input, typed roadmap proposals, typed meeting outcomes; contract type tests for every new query.
- Convex modules by domain: `floors`, `projects`, `schedule`, `calendar`, `meetings`, `channels`, `memory`, `audit`, `triage`, `plan`; services mirror them.
- CSS: tokens and primitives in globals; page rules in directory stylesheets.
- Tests where behavior matters: pure modules (planner, schedule, memory compiler, dependency graph, activity rules, station and label invariants), convex-test per mutation family, runtime harness scenarios, visual suite states, office lab baselines. No snapshot tests of React output.

## 6. Verification

| Layer    | Check                                                                                                                                                                                                                                                                                                                                                |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Types    | `tsc` clean, contract type tests for every new query                                                                                                                                                                                                                                                                                                 |
| Unit     | planner over hours, timezone, caps, preemption, cheap mode; memory compiler ordering and budgets; dependency and milestone graphs; activity rules; station, label, and shelf invariants; roadmap estimates                                                                                                                                           |
| Convex   | memory lifecycle; janitor operations; shifts and reports; calendar and meeting outcomes; findings lifecycle and shift ordering; alerts and dedupe; triage authority under attended and unattended hours; hiring policy and instances; upgrade                                                                                                        |
| Runtime  | harness with a fake clock over one workspace day: shifts with reports, a waiting review shift, a prep turn, a meeting with two answers and a wrap-up, a curation run, an audit pass producing a finding delivered next shift, an alert to a pull request, and an unattended emergency path with three failed notifications                           |
| Web      | smoke suite; visual suite over the fixture at both viewports covering projects, calendar, meeting, records, audit, triage, settings                                                                                                                                                                                                                  |
| 3D       | office lab route with injected activities, hour, seeds, reduced motion, demand frameloop; pixel baselines at one percent tolerance for lobby, floor day, floor night, records room, boardroom, triage floor, after-hours; a performance probe failing above 16 ms median frame time or 400 draw calls at 1440; every baseline change reviewed by eye |
| Security | security suite; review of every new route and tool; role enforcement in the gateway; emergency allow-list gated on attended hours and the notification ledger; untrusted delimiting of every agent- and provider-written string entering a prompt                                                                                                    |
| Docs     | architecture, operations, verification, security updated in the same pass                                                                                                                                                                                                                                                                            |

## 7. Coordination

The primary thread (Fable) owns contracts, integration, verification, and the final review. Implementation subagents run Opus 5 in isolated worktrees with disjoint write scopes. Review subagents run Fable 5.1, read-only.

1. Contracts and tooling: schema, contracts, ui-api aliases, ESLint, floor and project split with a data migration, the office lab route and baseline tooling. Primary thread.
2. Backend, five Opus agents: memory and janitor; schedule, shifts, reports, calendar, plan and capacity; projects, roadmap planner, milestones, dependencies; meetings engine; channels, alerts, notifications, triage intake and authority.
3. Infrastructure, four Opus agents: worker turns and internal tool servers with role enforcement; marketplace and instances; code-quality helpers and CSS consolidation; 3D rooms and props.
4. UI, five Opus agents: projects and roadmap; calendar and boardroom; records, audit, and settings; floors, channels, feeds, triage floor, incident strip; activity model, new figures, replay.
5. Closing, three Opus agents: runtime harness scenarios; performance probe and baselines; docs.
6. Reviews: four Fable reviewers (backend and scheduler, meetings and triage authority, scene against baselines, security), fixes, final verification, push.

## 8. Decisions taken

- Floors and projects are separate; a project spans floors; today's floors migrate in place.
- Instances are the parallelism unit; hiring a count creates named instances.
- Usage stays token-based; cost is a projection from a plan allowance or admin-entered rates.
- Multi-day work is a task with a daily cadence on one persistent session.
- Findings are soft and lead the day; triage may open pull requests under an allow-list; emergency merge and deploy only outside attended hours after three failed notifications, with a mandatory report.
- Fixed schedule defaults with a prominent Schedule section.
- Meetings are text; everyone-questions get short answers; outcomes need confirmation.
- Janitor, auditors, and triage employees are real employees with personas and figures; agents never approve, merge, or change another's work except under the emergency rule.
- Vector recall deferred; tag and keyword search first.
- Baselines are reviewed by a person before acceptance.
