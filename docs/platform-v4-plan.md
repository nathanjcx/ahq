# Platform v4 plan: memory, coordination, marketplace, and the building

Written September 12, 2026. This is the implementation contract for one pass that takes the marketplace, floors, memory, and the 3D environment to production quality, with a code-quality and verification uplift alongside. Where this document and the code disagree after the pass, the code is wrong or this document must be updated in the same change.

## Outcomes

1. Employees remember: per task, per employee, per floor, per workspace, curated by a janitor employee, visible and editable by people, bounded by budgets, journaled.
2. Floors coordinate: agents read the board and memory, tasks can depend on tasks, handoffs carry a structured summary and artifacts, the lobby triages into floors.
3. The marketplace is a product: one listing per employee with a current version and an upgrade path, evidence on each listing, workspace hiring policy, a studio that previews what it publishes.
4. The building shows all of it: a records room, notebooks, floor binders, a janitor with a cart, contested folders, dependency strings on the task board, replay that includes memory.
5. The repository is easier to change: shared helpers, ESLint with type-aware rules, fewer ad hoc shapes, tests where behavior matters, a deterministic 3D lab that gates the scene.

## Scope by area

### Memory (new)

- Table `memories`: `workspaceId`, `scope` (`task | agent | floor | workspace`), `scopeId`, `kind` (`fact | decision | preference | procedure | glossary | status`), `text` (≤ 400 chars), `tags`, `sourceTaskId?`, `author` (`agent | person | janitor`), `authorName`, `confidence`, `status` (`proposed | active | contested | archived`), `supersedesId?`, `expiresAt?`, `createdAt`, `updatedAt`. Indexes by scope and status.
- Table `taskSummaries`: `taskId`, `outcome`, `decisions[]`, `openQuestions[]`, `artifactIds[]`, `text`, `createdAt`. Written when a task reaches a terminal state by a wrap-up turn the worker requests from the session (one bounded extra turn) with a fallback summary from the final message when the turn fails.
- Budgets in `workspaceSettings`: tokens per scope with defaults workspace 2,000, floor 4,000, agent 1,500, summaries 1,500. Measured per task in `usage` as `memoryInput`.
- Injection compiler `lib/server/memory.ts`: pure function from active entries and budgets to the ordered "Working memory" block placed after the operating rules and before the task, with an omission note. Unit tested for ordering, budgets, and contested exclusion.
- Gateway tools on an internal `astra_memory` server: `remember(scope: self | floor, kind, text, supersedes?, tags?)` lands as `proposed` (agent scope activates immediately within budget), `recall(query, scope?)` searches active and archived entries by tag and keyword (vector search deferred), `read_board(limit)` and `read_memory(scope)` for floors. Every call journaled as a tool call.
- Janitor: a reserved employee kind `janitor` with no provider capabilities, one per workspace, created on bootstrap. A Convex cron enqueues a `curate` job per workspace per day and after every 20 proposed entries. The worker runs it as a session with only the memory tools plus `merge`, `contest(reason)`, `archive`, `promote(toWorkspace)`. Contested entries post a question to the floor board and are excluded from injection. Promotion to workspace scope requires a workspace admin to accept on the Records page. Janitor runs are bounded per day and journaled.
- Convex: `memory.ts` (list, propose, approve, archive, resolveContest, setBudgets), `services/memory.ts` (compile inputs, tool writes, janitor operations).

### Floors and coordination

- `tasks.dependsOn: Id<'tasks'>[]`: a task waits in `blocked` until its dependencies complete; the worker never starts a blocked task; completion of a dependency releases dependents. Cycle check on write.
- Handoffs carry the source task summary and artifact ids, not the last message.
- Lobby triage: move a task to a floor before it starts, with the brief snapshot taken at the move.
- Board: agents read it; a note can be addressed to an employee, which becomes a small task prompt on accept; contested memory questions are board posts with a resolve action.
- Archived floors expose their still-running tasks.

### Marketplace

- `listings` become the unit: one per draft with `currentVersionId`, `visibility` (`published | hidden | retired`), `evidence` (sample task prompt, sample output excerpt, optional link), and usage counts derived from installations and completed tasks.
- Installations track `versionId` and show "update available"; `upgrade` re-checks capabilities and readiness and re-pins.
- Workspace hiring policy in `workspaceSettings`: `anyone | admins | approval`; approval creates a hire request the admin accepts.
- Studio: instruction preview (the exact instructions block a session would receive, including persona and memory placeholders), capability picker from the registry, publish diff against the current version.

### Building

- A basement records room: shelves per scope with fill from budget usage, floor binders, task dossiers, the janitor's desk. Reached from the directory and from any binder.
- On floors: a binder on the meeting table (floor memory), a notebook on each desk (agent memory), a red-tabbed folder on the lectern for contested entries, strings between task cards on the wall board for dependencies, the janitor's cart appearing during curation runs.
- Activity model additions: `reading_memory` at session start, `remembering` on a memory write, `filing` for the janitor, `blocked` for a task waiting on dependencies.
- Replay includes memory reads and writes.

### Time: working hours, deadlines, multi-day work

- `workspaceSettings.schedule`: timezone, working days, start and end hour, overnight policy (`off | audits_only | cheap`), a daily token cap, and per-employee minimum and overnight models.
- Tasks gain `cadence` (`once | daily`), `deadlineAt?`, and `dependsOn`. A daily task is a multi-day assignment: on each working day inside hours, the scheduler enqueues one shift; the session persists across shifts, so the employee keeps its own context, and working memory is refreshed at every shift start.
- A shift ends with a structured progress report (`reports`: done, in progress, blocked on, next, risks, confidence on the deadline), posted to the floor channel and stored for auditors and meetings. A task that ends its shift without a report gets one generated from its journal, marked as inferred.
- Waiting: a task whose dependency is unfinished sits in `waiting`. Once per working day, or when the dependency posts a milestone report, the waiting employee gets a bounded review shift that reads the dependency's latest report and artifacts and posts feedback to the channel. Feedback is advice; it changes nothing.
- Pacing: the working memory block carries a schedule section: deadline, working hours left before it, next meeting and its agenda, and a pacing note computed from the employee's own last report (ahead, on track, behind). The operating rules tell the employee to document what cannot be finished and to prepare it for the meeting when behind.
- Overnight `cheap` mode: shifts outside working hours run on the overnight model with a smaller step budget and a mandatory checkpoint report every step, so slow, careful progress is the default and nothing large lands unreviewed.
- Scheduler: a Convex cron every five minutes runs the shift planner per workspace: due shifts, review shifts, audits, curation, meeting preparation, subject to the daily token cap and worker slots. Everything it enqueues is an ordinary job with a lease.

### Calendar and meetings

- `calendarEntries`: `kind` (`deadline | meeting | audit | shift`), time, duration, floor, task, attendees (employees and people), agenda items, status. Deadlines and shifts are derived from tasks and the schedule; meetings are created by people.
- Calendar page: week and day views with every employee as a row, shifts as blocks, deadlines as markers, meetings as events. Employee detail and floor pages show their slice. Mobile: agenda list.
- Scheduling a meeting: pick time, floor, attendees, a purpose line. The app suggests agenda items from work due before the meeting: open tasks with deadlines before it, latest reports flagged behind, contested memory, open audit findings, unresolved triage. The person edits and confirms.
- Preparation: at a configurable lead (default 60 minutes of working time), each attendee runs a bounded prep turn producing a written report against the agenda. Reports are stored and shown before the meeting starts.
- The boardroom: a meeting session opened by a person. The user types questions, addressed to one attendee or to everyone. Each addressed employee answers in one bounded turn with the meeting context, its report, its memory, and the transcript so far; answers stream into the transcript. Everyone-questions ask for short answers. The user closes the meeting; a wrap-up turn per attendee proposes action items and follow-ups; the user confirms which become tasks, deadlines, or a next meeting, and the calendar updates. Nothing is created without confirmation.
- Cost is visible in the meeting: tokens so far and per question.

### Channels

- The floor board becomes the floor channel. A workspace channel, a triage channel, and an audit channel are added. Posts carry a `kind`: note, report, feedback, alert, finding, decision, system.
- Every employee has a feed of everything it posted anywhere; the employee page shows it. Every person can post to any channel they can see.
- Agents read channels through `read_board` scoped to the channels of their floor plus the workspace channel.

### Auditors

- A reserved employee kind `auditor`, distinct look and a stern persona, one team per workspace, running after working hours (`audits_only` allows them overnight). Auditors have read tools only: reports, journals, tool calls, artifacts, memory, channels, and a code-reading tool over archived artifacts. They cannot propose external writes.
- Each audit covers the day's completed shifts and finished tasks: claims in reports against the journal (a claim of passing tests needs a journaled run), evidence of fabricated data, test coverage and failing tests in artifacts, code quality, copy quality against the workspace's standard (a workspace memory entry the admin writes), and whether yesterday's findings were addressed.
- Output: `auditFindings` with severity, evidence links, and required actions, grouped into an audit document per employee, posted to the audit channel and to the floor channel, and delivered as the first item of that employee's next shift. Unaddressed findings escalate to the workspace channel and to the next meeting's agenda. Auditors verify remediation the following night.
- Finding policy is a workspace setting: `soft` (findings lead the next shift) or `hard` (the next shift only works on findings until they are cleared).

### Triage

- A reserved floor `Triage` with its own channel and a team of triage employees. Alerts create triage tasks that preempt working hours and the daily cap up to a triage allowance.
- Intake: `alerts` table fed by three signed sources. GitHub issues and comments through the existing native webhook when a label or keyword matches the workspace's triage rules. A generic signed alert endpoint for monitors such as PostHog alerts, uptime checks, and cloud health notices, with a normalized shape (source, title, severity, url, fingerprint). Gmail through the existing relay with a classifier turn that decides whether a message reports a failure. Duplicate fingerprints attach to the open alert instead of creating a new one.
- Flow: an open alert becomes a triage task; the triage employee reproduces, then posts an ongoing-incident notice to every affected floor channel (matched by repository or provider resource) and a hold note enters those employees' working memory. Fixes go through the normal proposal path as pull requests. Resolution posts a post-mortem to the affected channels with cause, fix, and how to avoid it, proposes a workspace memory entry, and links the regression test in the pull request. The alert closes when the person confirms.
- A global incident strip shows open alerts everywhere; the Triage floor page lists them with status and the responsible employee.
- PostHog joins the provider registry as an MCP provider if its hosted server is reachable at implementation time; otherwise PostHog reaches the app through the generic alert endpoint only.

### Building, additions for this pass

- A boardroom on the top floor: attendee figures ride the elevator and sit at the table when a meeting starts; answers appear as bubbles beside the transcript panel; the room empties when the meeting closes.
- A calendar wall in the lobby showing today's shifts and meetings.
- Auditors walk the floors after hours with a clipboard; an employee with an open finding shows an uneasy idle; findings are a folder on that employee's desk.
- The Triage floor has an alert board that lights per open incident; affected floors show an amber lamp while an incident is open.
- Working hours are visible: outside hours the lights are low, overnight cheap shifts show the employee at a desk lamp, audits show the auditors moving, and everything else is still.
- Activity model additions: `preparing`, `presenting`, `answering`, `waiting`, `reviewing_peer`, `auditing`, `triaging`, `uneasy`, `off_shift`.

### Hierarchy

Tower: auditors and the janitor, running after hours and reporting to the workspace channel. Triage floor: incident work with a preemption allowance. Project floors: staffed employees on daily shifts. People: owners and admins set schedule, budgets, policies, and confirm everything that changes the calendar or creates work; members run and review. Agents never approve, never merge, never change each other's work; they advise in channels and escalate through reports and findings.

### Code quality

- ESLint (typescript-eslint type-aware, react-hooks, import order) with `npm run lint` in `check`.
- Shared helpers: one `lib/text.ts` for clipping and normalizing, one `convex/lib/` for visibility, budgets, and text limits (replacing scattered copies in `shared.ts` and `work.ts`), one `components/shared/time.ts`.
- Convex module naming: `work.ts` becomes `convex/lib/tasks.ts`; `services/context.ts` split by concern.
- Typed everything at the boundary: no `Record<string, unknown>` crossing from UI to Convex (draft editor gets a typed input), no `any` in non-test code.
- CSS: finish moving page rules into directory stylesheets; `globals.css` holds tokens and primitives only.
- Tests: pure modules get unit tests, Convex gets convex-test per new mutation family, the runtime harness gains memory tools and a janitor run, the visual suite gains the records room and coordination states, the office lab gains pixel baselines. No snapshot tests of React output.

## Verification

Every workstream ships with its checks; integration reruns all of them.

| Layer    | Check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Types    | `tsc` clean, contract type tests for every new query                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Unit     | vitest: memory compiler, budgets, dependency graph, activity rules, station and label invariants, records shelf layout                                                                                                                                                                                                                                                                                                                                                                                       |
| Convex   | convex-test: memory lifecycle, janitor operations, dependencies, handoff summary, hiring policy, upgrade                                                                                                                                                                                                                                                                                                                                                                                                     |
| Runtime  | harness: agent `remember` and `recall` through the real gateway, a janitor session against a fake model that emits scripted tool calls, dependency release by the worker                                                                                                                                                                                                                                                                                                                                     |
| Web      | smoke suite; visual suite over the fixture at both viewports including Records, Marketplace v2, dependencies, contested queue                                                                                                                                                                                                                                                                                                                                                                                |
| 3D       | the office lab: a committed, guarded route that renders the scene with injected activities, hour, seeds, reduced motion and `frameloop: demand`, producing deterministic frames; pixel-diff baselines with a 1% tolerance for lobby, floor day, floor night, records room, janitor run, replay; a performance probe that samples frame time and `renderer.info` draw calls in Playwright and fails above 16 ms median or 400 draw calls at 1440; every baseline change reviewed by eye before it is accepted |
| Security | the security suite plus a review pass on new routes and tools; memory text is untrusted at injection and delimited; janitor has no provider tools; records page respects task and floor visibility                                                                                                                                                                                                                                                                                                           |
| Docs     | architecture, operations, verification, security updated in the same pass                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## Coordination

The primary thread (Fable) owns contracts, integration, verification, and the final review. Implementation subagents run Opus 5 in isolated worktrees with disjoint write scopes. Review subagents run Fable 5.1 and are read-only: adversarial reviews of the memory and coordination backend, of the scheduler and meeting engine, of the 3D scene against the baselines, and one security review of the whole diff.

Phases, each ending with a merge into the integration branch and a full verification run:

1. Contracts and tooling: schema, contracts, ui-api aliases, ESLint, the office lab route and baseline tooling. Primary thread.
2. Parallel backend: memory and coordination; scheduler, shifts, reports, and calendar; meetings engine; marketplace; channels, alerts, and triage intake. Five Opus agents.
3. Parallel infrastructure: worker shifts, prep and meeting turns, janitor and auditor runs; gateway tools for memory, channels, and audit reading; code-quality helpers and CSS consolidation; 3D rooms and props (records room, boardroom, triage board, calendar wall). Four Opus agents.
4. Parallel UI: Records and memory; Calendar and boardroom; marketplace and studio; floors, channels, employee feed, incident strip, Triage floor; activity model, figures for janitor, auditors, and triage, replay. Five Opus agents.
5. Parallel closing: runtime harness extensions (memory tools, a scripted janitor, an auditor pass, a meeting Q&A, a shift with a report, an alert to resolution); performance probe and baselines; docs. Three Opus agents.
6. Reviews: four Fable reviewers, fixes by the primary thread or short Opus follow-ups, final verification, push.

Verification additions for this pass: scheduler decisions are a pure module with unit tests over hours, timezone, caps, and preemption; the runtime harness drives a full day for one workspace with a fake clock; the visual suite covers the calendar, a meeting with a transcript, an audit finding on a desk, an open incident, and the building at night; the office lab has baselines for the boardroom, the lobby calendar wall, and the after-hours floor.

## Decisions taken in this plan

- Memory is atomic claims with supersession, never documents; conflicts never reach a model.
- The janitor, auditors, and triage employees are real employees with personas and figures, so their work is visible and journaled like everyone else's.
- Vector recall is deferred; tag and keyword search first.
- Task summaries and shift reports come from bounded wrap-up turns, so they cost tokens; the fallback is a journal-derived report marked as inferred.
- Workspace memory is admin-approved only.
- Multi-day work is a task with a daily cadence and one persistent session, not a new object.
- Meetings are text; each question is answered by the addressed employees in parallel with a short-answer rule for everyone-questions; every meeting outcome needs a person's confirmation before it becomes work.
- Auditors and triage employees never approve, never merge, and never change another employee's work.
- Overnight defaults to audits only; cheap overnight work is opt-in per workspace.
- A daily token cap joins the monthly cap, with a separate triage allowance.
- Baselines are reviewed by a person before acceptance; the tolerance catches regressions, the eye catches ugliness.

## Open questions

1. Audit findings policy default: `soft` or `hard`.
2. Whether triage employees may open pull requests without a per-proposal approval, under a narrow allow-list for the Triage floor, or must wait for approval like everyone else.
3. Whether the default working hours and overnight policy should come from the workspace admin at bootstrap (a short setup step) or from fixed defaults (nine to six local, audits only) that the admin can change later.
