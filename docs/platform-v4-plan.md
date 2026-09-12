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

The primary thread (Fable) owns contracts, integration, verification, and the final review. Implementation subagents run Opus 5 in isolated worktrees with disjoint write scopes. Review subagents run Fable 5.1 and are read-only: one adversarial review of the memory and coordination backend, one of the 3D scene against the baselines, one security review of the whole diff.

Phases, each ending with a merge into the integration branch and a full verification run:

1. Contracts and tooling: schema, contracts, ui-api aliases, ESLint, the office lab route and baseline tooling. Primary thread.
2. Parallel: memory and coordination backend; marketplace backend; 3D records room and props; code-quality helpers and CSS consolidation. Four Opus agents.
3. Parallel: Records page and memory UI; marketplace UI and studio; floors coordination UI; activity model, janitor figure, replay. Four Opus agents.
4. Parallel: janitor worker job and runtime harness extension; performance probe and baselines; docs. Three Opus agents.
5. Reviews: three Fable reviewers, fixes by the primary thread or a short Opus follow-up, final verification, push.

## Decisions taken in this plan

- Memory is atomic claims with supersession, never documents; conflicts never reach a model.
- The janitor is an employee with a persona and a figure, so its work is visible and journaled like everyone else's.
- Vector recall is deferred; tag and keyword search first.
- Task summaries come from a bounded wrap-up turn, so they cost tokens; the fallback is the final message.
- Workspace memory is admin-approved only.
- Baselines are reviewed by a person before acceptance; the tolerance catches regressions, the eye catches ugliness.
