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

Open `release/mac-arm64/Astra HQ.app`. The development build is ad-hoc signed for local use; it is not notarized for public distribution. `npm run dev` opens only the renderer preview, without native storage or cloud credentials.

## Set up your office

1. Choose a local database folder when prompted, or keep the application folder. Existing Birth data is imported without deleting its original JSON file.
2. Open **Settings & connections** and add your **Astra / OpenAI API key**. Every employee uses **GPT-6 Astra**; other models are rejected. API usage has separate billing from ChatGPT subscriptions.
3. Create an employee and review **Role, Thinking, Tools, Memory, Communication, and Autonomy**. You choose each setting. Skills describe expertise; actual permissions come from configuration.
4. Give an assignment or send a direct message. Selected file copies are shared only with your explicit choice. Follow real tool receipts, review requests, typed memories, teammate messages, and saved artifacts in the employee workspace.

See [the agent session guide](docs/agent-sessions.md) for configuration, continuity, memory boundaries, and exact execution behavior.

## What is included

- **Office:** Ultra’s original cutaway, camera rotation/zoom, walking and articulated poses, with Birth’s light shell and north-star goal banner.
- **Appearance:** presentation, skin tone, short/long/bald hair, hair color, hats, glasses, and clothing color. Changes persist and appear in the office and portraits. Appearance stays separate from the full agent configuration.
- **Office tools:** a searchable [45-item atlas](docs/office-tool-atlas.md), physical memory drawers, inbox/acknowledgment stamp, drafting bench, research terminal, analysis bench, service phone, and review desk. Real event receipts drive the visible work.
- **Persona:** user-chosen purpose, values, communication, collaboration, and decision style included in actual session instructions.
- **Auditable replay:** fixed recording range, exact-time and event seek, local hash-chain verification, source/session/tool details, and native JSON export. Older records and gaps remain visibly unverified.
- **Timeline:** all workspace changes plus five-minute checkpoints while the desktop process is open; manual checkpoints; scrub and 1×–300× time lapse; durable avatar clock and microphone-level frames. Rollback first saves the current state, restores local workspace data, and keeps the activity journal. Active sessions must be stopped first. Remote actions and exported files cannot be undone or replayed by rollback.
- **Employee workspace:** live session usage and tool receipts, editable typed memory, inbox delivery states, and durable artifact previews/exports.
- **Messages and announcements:** invoke persistent Astra sessions. Guidance queues during active work and preserves conversation continuity. Automatic teammate responses follow explicit permissions and handoff limits. Voice is unavailable in Astra-only mode.
- **Cloud work:** bounded Responses tool loops, durable IDs/requests/receipts, restart recovery, concurrent workers, exact tool approvals, completion review, revisions, and transport cancellation. Sample content is labeled separately.
- **Integrations:** encrypted keys and user-provided HTTPS remote MCP endpoints, selected independently for each employee. Web search and data analysis are explicit tool choices.
- **Activity:** user actions, employee messages, cloud work, reviews, and the original local runtime in one durable journal, filterable and exportable as CSV or JSON.
- **Main backend:** the existing local Codex transport, work queue, reports, bug fixes, meeting briefs, local calendar workflows, routines, and fixture tests remain in `runtime/`. The Activity page exposes the local workflow runtime separately from cloud employees. It uses a local Codex installation and its own ChatGPT sign-in; local jobs are never labeled as cloud sessions.

## Storage and boundaries

SQLite uses main’s `SnapshotStore`, extended with workspace, checkpoint, activity, session, and office-frame tables. All history is retained. The selected folder holds `Astra HQ/office.sqlite`; encrypted credentials and imported file copies remain in the app’s private data directory. Keys never enter React state after saving, workspace history, or exports. API calls run in the Electron main process through a narrow preload bridge; the renderer has no Node access.

Cloud session continuity uses stored response IDs and survives app restarts. A network failure before a create-response acknowledgement can leave an uncertain remote run; continuations retain their request identity for recovery, and uncertainty is reported. Integration connections require valid endpoints and credentials supplied by the user. Direct Gmail, Slack, or calendar OAuth flows are not bundled; compatible remote MCP services provide those connections.

The timeline replays recorded office state and avatar motion, not a remote computer video. No checkpoints are recorded while the application process is quit. Five-minute checkpoints resume on launch. Rollback restores local plans and profiles, never external systems or already completed actions.

## Validation

```sh
npm run check
```

Tests cover session continuity, actual local tool effects in temporary SQLite stores, scoped memory, exact approvals, inbox delivery, cancellation, concurrent work, configuration validation, and file boundaries. Provider responses in the automated suites are controlled fixtures. See [the verification record](docs/validation.md) for live desktop and provider evidence.
