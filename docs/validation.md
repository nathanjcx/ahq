# Astra HQ merged desktop validation

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
