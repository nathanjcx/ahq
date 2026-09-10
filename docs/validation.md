# Astra HQ merged desktop validation

Verified on macOS / Apple Silicon on September 10, 2026.

## Automated and build checks

- Birth's gateway, file-copy, approval, and workspace tests are retained.
- Main's queue, scheduler, scenario, cancellation, authentication-race, and Codex transport tests are retained.
- Added tests for SQLite checkpoint/history persistence and reopen, hosted Responses requests and recovery, credential exclusion from saved sessions, MCP approval continuation, cancellation before broadcast guidance, recorded microphone-level/pose replay, stale-review recovery, and safe CSV export.
- Latest `npm run check`: 46 tests passed, 0 failed.
- TypeScript, Vite renderer, Electron preload/main bundles, and an ad-hoc signed macOS application build successfully.
- Ultra's Architecture, Parquet, Desk, Chair, Laptop, Plant, and Framing functions were compared with `origin/Ultrabranch` after normalizing TypeScript/JSX formatting through esbuild. All match. Appearance, speaker animation, and deterministic replay extend the avatar/scene functions without changing those room and furniture functions.

## Native desktop verification

- Packaged `Astra HQ.app` launches and renders Ultra's full 3D office inside the light Birth shell, including the goal banner and all four room links.
- First-run local storage prompt opens the native folder picker. Cancel preserves the existing database.
- New employee dialog has exactly Name, Job title, Personality, and Skills; Astra session is included. Appearance controls expose presentation, hair, hat, glasses, skin tone, hair color, and clothing color separately.
- A real five-minute checkpoint was confirmed in the native SQLite history.
- Manual checkpoint increments recorded-state count. A temporary goal edit was saved; scrubbing to a previous checkpoint and confirming restore returned the original goal. The restore created a before-rollback checkpoint, retained the activity history, and left employees ready for new direction.
- Activity includes original local source-brief activity, labeled examples, the temporary goal edit, and the restore event. Native CSV export completed and its file was parsed: 23 activity rows, including the goal and rollback records.
- Main's local runtime loads its persisted workflows/artifacts through the new bridge. Native startup exposed a CLI discovery/config compatibility issue; the launcher was corrected to discover the installed desktop Codex binary and provide valid inert transports for disabled MCP servers. A real read-only app-server initialization/account check then succeeded with the existing ChatGPT sign-in. The final packaged app also displayed Account: signed-in and enabled its local Codex control. No model turn or paid work was started for this check.

## Not exercised with live credentials

No OpenAI API key or integration token was supplied. Hosted session execution, live transcription, and remote integration actions were tested with deterministic transport responses, not with a billed external session. The implementation uses the documented OpenAI APIs and reports missing credentials and service failures; it does not simulate successful cloud execution. Physical microphone input and end-to-end voice broadcast must be exercised after the user grants microphone permission and supplies an API key.

The local database created during verification preserves the source brief and prior Birth checkpoints. No original imported files were modified. The original Birth JSON remains in the application data directory as a migration backup. Temporary verification goal edits remain in the audit journal by design; the current goal was restored.

## Empty office default

New workspaces start without employees, assignments, messages, reviews, or example activity. The optional sample remains an explicit Settings action. Existing saved workspaces still load normally. The starter-state test was updated, while workflow and hosted-session tests continue to use the explicit sample fixture. `npm run check` passes all 38 tests and the production build.

The rebuilt macOS app was opened with the local sample employees and example assignments cleared. It displayed zero teammates, an empty 3D office, zero pending reviews, and a disabled voice announcement button. “Create your first employee” opened the four-field form with Astra cloud session included. The imported folder, approved source brief, goal, and historical journal remain intact; both a database copy and a checkpoint were saved before clearing the sample. The app was left open on the empty office.

## ChatGPT plan and office announcement update

- ChatGPT is the default employee provider. The existing account was verified through `account/read`; an actual `gpt-6-astra` employee turn returned “ChatGPT plan connection verified.” and its result was approved. This used a temporary workspace and did not add test employees to the user's office or send user files.
- New tests cover early login completion, rejection of API-key authentication for plan work, persistent thread IDs and revisions, interruption before announcement continuation, cancellation during startup, account changes, and restart recovery. A cancellation race discovered by these tests was fixed to send one interrupt per turn.
- The final check passes 46 tests and the production build, including the native Swift speech helper. PCM WAV conversion is verified for headers, sample rate, stereo downmix, and signed samples. The built speech helper responds to its version check.
- The light grid and giant far-wall megaphone were inspected in a temporary browser preview. Simulated microphone levels of 0 and 0.9 confirmed horn expansion, outward animated waves, and return to rest. The library label was moved below the horn to keep both visible. The preview files were removed afterward.
- ChatGPT voice transcription uses macOS Speech with both `supportsOnDeviceRecognition` and `requiresOnDeviceRecognition` checked/enforced. It requests speech permission and deletes its private temporary WAV after success or failure. Physical microphone input, the permission prompt, and recognition for the user's current language have not been exercised; unsupported on-device speech reports an error and the user can type the announcement. There is no silent fallback to API billing.
- Optional API mode remains available for hosted sessions and remote MCP integrations. ChatGPT mode currently runs local work with external tools/network disabled, and shows this limitation in Settings. Closing Astra HQ stops plan turns; later assignments resume the saved conversation.

The final packaged app was reopened and displayed **ChatGPT plan · Connected** using the existing sign-in, with optional API access collapsed. The office rendered the light grid and high-mounted megaphone, and the two employees created by the user during development remained intact. The packaged speech helper executes successfully and the full app passes `codesign --verify --deep --strict`.
