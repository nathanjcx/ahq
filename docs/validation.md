# Astra HQ validation record

## Current agent office build — September 10, 2026

The agent office implementation is on branch `codex/office-agent-replay`.

### Automated verification

- `npm run check`: **110 passed, 0 failed**, followed by successful TypeScript, renderer, and desktop bundles.
- Four deterministic office-presence tests cover fixed-time poses, no invented work for real employees, typed filing after the corresponding tool receipt, proposals remaining separate, distinct queued/delivered/acknowledged states, late-recorded events, and failures.
- Eight audit/store tests cover canonical event hashes, stable identities, atomic data-plus-event writes, durable reopen, checkpoint anchors, missing history, timestamp isolation, truncation, tampering, deleted tails, modified frames, and legacy migration.
- Three replay-clock tests cover every supported playback speed, fixed endpoints, event stepping, timestamp collisions, stale responses, and unavailable-state behavior.
- Persona tests cover migration without changing explicit choices, independent defaults, schema rejection, and all five user-chosen persona dimensions in runtime instructions.
- Existing runtime, permission, cancellation, cache-recovery, direct-message, and artifact suites remain included.

### Live provider execution

Using the connection supplied by the user through native Settings, the **Astra Lab** employee ran real `gpt-6-astra` sessions. The encrypted key was not read or exported.

1. Proposed a semantic employee memory, then listed the actual staff directory. The proposed memory was inactive until approved through its Memory panel.
2. Continued the same persistent session, recalled the approved memory, saved a real artifact, and queued an internal message to Maya. Exact artifact/message permission requests were reviewed. The final result correctly distinguished queued from delivered.
3. Maya used a separate real session to read that message and explicitly acknowledge it. The result reported delivery at 17:46:56 UTC and acknowledgment at 17:47:03 UTC. No reply was sent.
4. After installing the audited build, Astra Lab proposed one episodic memory: `Office audit verification: amber-62`. Its exact ID was `70dc2f48-a927-47b9-bd97-eb2b6e1a87fb`. Event 18 recorded the proposal; event 19 recorded the completed memory tool call. Approving the memory created distinct **event 28, memory.saved**, with user provenance, episodic type, employee scope, content hash, and the persistent session ID.
5. The final verification report was approved. These small test records remain local and inspectable.

The first three steps occurred before the new hash ledger existed. They remain legacy evidence; they were not retroactively certified.

### Native UI and audit export

- Inspected the rendered cutaway office, physical memory cabinet with five labeled drawers, inbox/receipt station, research/analysis/drafting/service objects, and the searchable 45-entry tool atlas.
- Opened event 28 from the real activity feed. Replay selected **2026-09-10 18:06:50.217 UTC** exactly and showed the episodic filing event. Historical editing controls were disabled and the selected checkpoint/frame timestamps were visible.
- Started playback from that event at 60×. It stopped at the captured endpoint **18:07:09.771 UTC**, stayed paused, and did not switch to live.
- Corrected an inherited CSS selector that stretched the replay badge over the canvas; reloaded and visually confirmed the full office remained visible in replay.
- Native **Export and verify** saved `Astra-HQ-audit-2026-09-10.json`. An independent CLI recheck found **28 valid ledger events, 8 verified checkpoints, 22 verified frames, 0 integrity issues**.
- The same export contains **48 legacy checkpoints and 351 legacy frames**. They are explicitly unverified, so the overall archive is not labeled fully verified. Verification establishes local hash consistency, not external attestation or protection against replacement of an entire local archive.

### Scope of this verification

The browser preview has no native SQLite or provider connection; use the desktop app for real execution and replay. Provider web search, code interpreter, and MCP receipts have protocol-fixture coverage but were not called live during this pass. Voice remains unavailable in Astra-only mode. The 45-item atlas covers both animated event categories and mechanisms explained through concrete controls/inspectors; it is not a claim that every optional integration ran.

## Earlier integrated-main baseline

The following record predates the current agent office implementation. Its 38-test count, four-field employee editor, and missing-API-key limitation describe that earlier build only.

Verified on macOS / Apple Silicon on September 10, 2026.

## Automated and build checks

- Birth's gateway, file-copy, approval, and workspace tests are retained.
- Main's queue, scheduler, scenario, cancellation, authentication-race, and Codex transport tests are retained.
- Added tests for SQLite checkpoint/history persistence and reopen, hosted Responses requests and recovery, credential exclusion from saved sessions, MCP approval continuation, cancellation before broadcast guidance, recorded microphone-level/pose replay, stale-review recovery, and safe CSV export.
- Final `npm run check`: 38 tests passed, 0 failed.
- TypeScript, Vite renderer, Electron preload/main bundles, and an ad-hoc signed macOS application build successfully.
- Ultra's Architecture, Parquet, Desk, Chair, Laptop, Plant, and Framing functions were compared with `origin/Ultrabranch` after normalizing TypeScript/JSX formatting through esbuild. All match. Appearance, speaker animation, and deterministic replay extend the avatar/scene functions without changing those room and furniture functions.

## Native desktop verification

- Packaged `Astra HQ.app` launches and renders Ultra's full 3D office inside the light Birth shell, including the goal banner and all four room links.
- First-run local storage prompt opens the native folder picker. Cancel preserves the existing database.
- New employee dialog has exactly Name, Job title, Personality, and Skills; Astra cloud session is included. Appearance controls expose presentation, hair, hat, glasses, skin tone, hair color, and clothing color separately.
- A real five-minute checkpoint was confirmed in the native SQLite history.
- Manual checkpoint increments recorded-state count. A temporary goal edit was saved; scrubbing to a previous checkpoint and confirming restore returned the original goal. The restore created a before-rollback checkpoint, retained the activity history, and left employees ready for new direction.
- Activity includes original local source-brief activity, labeled examples, the temporary goal edit, and the restore event. Native CSV export completed and its file was parsed: 23 activity rows, including the goal and rollback records.
- Main's local runtime loads its persisted workflows/artifacts through the new bridge. Native startup exposed a CLI discovery/config compatibility issue; the launcher was corrected to discover the installed desktop Codex binary and provide valid inert transports for disabled MCP servers. A real read-only app-server initialization/account check then succeeded with the existing ChatGPT sign-in. The final packaged app also displayed Account: signed-in and enabled its local Codex control. No model turn or paid work was started for this check.

## Not exercised with live credentials

No OpenAI API key or integration token was supplied. Hosted session execution, live transcription, and remote integration actions were tested with deterministic transport responses, not with a billed external session. The implementation uses the documented OpenAI APIs and reports missing credentials and service failures; it does not simulate successful cloud execution. Physical microphone input and end-to-end voice broadcast must be exercised after the user grants microphone permission and supplies an API key.

The local database created during verification preserves the prior Birth workspace and its source brief. No original imported files were modified. The original Birth JSON remains in the application data directory as a migration backup. Temporary verification goal edits remain in the audit journal by design; the current goal was restored.
