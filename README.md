# Astra HQ

A desktop office for AI employees. Give the team a direction, let employees do the work in Astra cloud sessions, and provide judgment when they bring results back.

This is the combined `main` application: **Ultrabranch’s complete 3D office**, **AHQ-Birth’s light layout and employee flow**, and **main’s SQLite/Codex runtime**. The original studio architecture, furniture, meeting room, lounge, library, articulated avatars, and walking routes are retained in `studio/app/office.tsx` and used directly by the desktop renderer.

## Start

```sh
npm install
npm run dev:desktop
```

Production build and macOS application:

```sh
npm run package
```

Open `release/mac-arm64/Astra HQ.app`. The development build is ad-hoc signed for local use; it is not notarized for public distribution. `npm run dev` opens only the renderer preview, without native storage, microphone transcription, or cloud credentials.

## Set up your office

1. Choose a local database folder when prompted, or keep the application folder. Existing Birth data is imported without deleting its original JSON file.
2. Open **Settings & connections**, add your **Astra / OpenAI API key**, and keep `gpt-6-astra` or choose another model available to your API account. API usage has separate billing from ChatGPT subscriptions.
3. Create an employee with **Name, Job title, Personality, Skills**. Every employee includes **Astra cloud session**. Web search, Data analysis, and connected integrations can be added as skills.
4. Select an employee and give them an assignment. Optional local file copies are shared only when explicitly selected and authorized. Results come back for review.

An organization-operated gateway remains available under the optional gateway settings. It must implement the contract in `docs/astra-gateway.md`; no gateway is bundled or implied to exist. OpenAI-hosted sessions work directly with a supplied API key.

## What is included

- **Office:** Ultra’s original cutaway, camera rotation/zoom, walking and articulated poses, with Birth’s light shell and north-star goal banner.
- **Appearance:** presentation, skin tone, short/long/bald hair, hair color, hats, glasses, and clothing color. Changes persist and appear in the office and portraits. The four-field employee form stays separate.
- **Timeline:** all workspace changes plus five-minute checkpoints while the desktop process is open; manual checkpoints; scrub and 1×–300× time lapse; durable avatar clock and microphone-level frames. Rollback first saves the current state, restores local workspace data, and keeps the activity journal. Active sessions must be stopped first. Remote actions and exported files cannot be undone or replayed by rollback.
- **Announce:** hold with a pointer or Space/Enter, speak, then release. Rendered office speakers respond to microphone levels; avatars stop walking and face the camera. Release transcribes through OpenAI and sends guidance to every employee. Active turns are stopped before replacement turns begin. Delivery failures are reported per employee. Audio is not written to disk.
- **Cloud work:** background Responses API calls, durable remote response IDs, polling/recovery, source links, human review, revisions, and stop controls. The office displays cloud-session badges only for employees with a session. Sample content is labeled separately.
- **Integrations:** encrypted keys and user-provided HTTPS remote MCP endpoints. Selecting an integration name as an employee skill enables it; remote tool calls require an explicit review of the requested action. Built-in Web search and Data analysis use OpenAI-hosted tools.
- **Activity:** user actions, employee messages, cloud work, reviews, and the original local runtime in one durable journal, filterable and exportable as CSV or JSON.
- **Main backend:** the existing local Codex transport, work queue, reports, bug fixes, meeting briefs, local calendar workflows, routines, and fixture tests remain in `runtime/`. The Activity page exposes the local workflow runtime separately from cloud employees. It uses a local Codex installation and its own ChatGPT sign-in; local jobs are never labeled as cloud sessions.

## Storage and boundaries

SQLite uses main’s `SnapshotStore`, extended with workspace, checkpoint, activity, session, and office-frame tables. All history is retained. The selected folder holds `Astra HQ/office.sqlite`; encrypted credentials and imported file copies remain in the app’s private data directory. Keys never enter React state after saving, workspace history, or exports. API calls run in the Electron main process through a narrow preload bridge; the renderer has no Node access.

Cloud session continuity uses stored response IDs and survives app restarts. A network failure before a create-response acknowledgement can leave an uncertain remote run; requests are not automatically retried. Integration connections require valid endpoints and credentials supplied by the user. Direct Gmail, Slack, or calendar OAuth flows are not bundled; compatible remote MCP services provide those connections.

The timeline replays recorded office state and avatar motion, not a remote computer video. No checkpoints are recorded while the application process is quit. Five-minute checkpoints resume on launch. Rollback restores local plans and profiles, never external systems or already completed actions.

## Validation

```sh
npm run check
```

Tests cover the original runtime and file boundaries, plus hosted sessions, credential exclusion, approval continuation, cancellation before announcements, checkpoint persistence, microphone-level replay, and review recovery. Live cloud execution and live transcription require a user-provided API key and are not exercised by the automated tests. See `docs/validation.md` for the desktop verification record.

Implementation references: [OpenAI background mode](https://developers.openai.com/api/docs/guides/background), [file transcription](https://developers.openai.com/api/docs/guides/speech-to-text), [MCP connections and approvals](https://developers.openai.com/api/docs/guides/tools-connectors-mcp), and [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra).
