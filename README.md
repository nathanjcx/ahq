# Astra HQ

A desktop office for AI employees. Give the team a direction, let employees do the work using your ChatGPT plan, and provide judgment when they bring results back.

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

New workspaces start with an empty office: no employees, assignments, conversations, or reviews. Add your first employee when you are ready. Existing workspaces are preserved; an example office remains available explicitly in Settings.

1. Choose a local database folder when prompted, or keep the application folder. Existing Birth data is imported without deleting its original JSON file.
2. Open the **Settings gear → ChatGPT plan**. Astra HQ reuses an existing ChatGPT/Codex sign-in or opens the official browser login. Employee work uses `gpt-6-astra` through your plan’s Codex allowance, without an API key. Install the ChatGPT/Codex desktop app or Codex CLI if it is unavailable.
3. Create an employee with **Name, Job title, Personality, Skills**. Every employee includes **Astra session**. ChatGPT mode supports supplied context and local file work; Web search and remote MCP integrations use the optional API mode.
4. Select an employee and give them an assignment. Optional local file copies are shared only when explicitly selected and authorized. Results come back for review.

**Optional API access** in Settings enables separately billed hosted sessions, remote MCP tools, and API transcription. It explicitly switches new assignments to API mode; ChatGPT mode never falls back to API billing. An organization-operated gateway remains available under the optional gateway settings. It must implement the contract in `docs/astra-gateway.md`; no gateway is bundled or implied to exist. OpenAI-hosted sessions work directly with a supplied API key.

## What is included

- **Navigation:** Office, Chat, Employees, and Roadmap, in that order. Settings/ChatGPT login, activity/export, and reviews stay available in the top bar.
- **Office:** Ultra’s original cutaway, camera rotation/zoom, walking and articulated poses, with Birth’s light shell, north-star goal banner, and light isometric grid backdrop. Room tags are removed. The file cabinet opens your saved folders; employees with active file/storage tasks visit it and open its drawer.
- **Roadmap:** an interactive dependency graph leading to your goal, with owner, date, status, progress, zoom, and a searchable list. Create and edit milestones, select their prerequisites, and prevent circular dependencies. Milestones can be planned before hiring employees.
- **Chat:** team and employee conversations plus an Announcements channel for typed broadcasts, voice transcripts, and delivery receipts.
- **Appearance:** presentation, skin tone, short/long/bald hair, hair color, hats, glasses, and clothing color. Changes persist and appear in the office and portraits. The four-field employee form stays separate.
- **Timeline:** all workspace changes plus five-minute checkpoints while the desktop process is open; manual checkpoints; scrub and 1×–300× time lapse; durable avatar clock and microphone-level frames. Rollback first saves the current state, restores local workspace data, and keeps the activity journal. Active sessions must be stopped first. Remote actions and exported files cannot be undone or replayed by rollback.
- **Announce:** hold with a pointer or Space/Enter, speak, then release. The button sits directly below the office. A giant megaphone floating above the far wall expands with microphone volume and sends out animated sound waves; avatars stop walking and face the camera. In ChatGPT mode, macOS Speech transcribes on-device after microphone/speech permission; on-device support for the system language is required. A private temporary WAV is deleted after transcription, including failure. API mode uses OpenAI transcription. The transcript guides employees; active turns stop before replacement turns begin. Delivery failures are reported per employee.
- **ChatGPT plan work:** official Codex app-server browser sign-in, background employee turns, persistent per-employee conversations, progress, cancellation, result review, and revisions. Tokens remain with Codex. Work runs in an isolated local directory while the app is open; closing the app stops active turns, and new assignments can resume their saved conversation. Office badges and activity exports identify ChatGPT sessions separately. Account changes cannot continue a different account’s session.
- **Cloud work (optional API):** background Responses API calls, durable remote response IDs, polling/recovery, source links, human review, revisions, and stop controls. The office displays cloud-session badges only for employees with a session. Sample content is labeled separately.
- **Integrations:** encrypted keys and user-provided HTTPS remote MCP endpoints. Selecting an integration name as an employee skill enables it; remote tool calls require an explicit review of the requested action. Built-in Web search and Data analysis use OpenAI-hosted tools.
- **Activity:** user actions, employee messages, cloud work, reviews, and the original local runtime in one durable journal, filterable and exportable as CSV or JSON.
- **Main backend:** the existing local Codex transport, work queue, reports, bug fixes, meeting briefs, local calendar workflows, routines, and fixture tests remain in `runtime/`. The Activity page exposes the local workflow runtime separately from cloud employees. It uses a local Codex installation and its own ChatGPT sign-in; local jobs are never labeled as cloud sessions.

## Storage and boundaries

SQLite uses main’s `SnapshotStore`, extended with workspace, checkpoint, activity, session, and office-frame tables. All history is retained. The selected folder holds `Astra HQ/office.sqlite`; encrypted credentials and imported file copies remain in the app’s private data directory. Keys never enter React state after saving, workspace history, or exports. Account operations and API calls run in the Electron main process through a narrow preload bridge; the renderer has no Node access.

Cloud session continuity uses stored response IDs and survives app restarts. A network failure before a create-response acknowledgement can leave an uncertain remote run; requests are not automatically retried. Integration connections require valid endpoints and credentials supplied by the user. Direct Gmail, Slack, or calendar OAuth flows are not bundled; compatible remote MCP services provide those connections.

The timeline replays recorded office state and avatar motion, not a remote computer video. No checkpoints are recorded while the application process is quit. Five-minute checkpoints resume on launch. Rollback restores local plans and profiles, never external systems or already completed actions.

## Validation

```sh
npm run check
```

Tests cover the original runtime and file boundaries, ChatGPT login races and API-login rejection, persistent employee conversations, cancellation during startup, revisions, hosted sessions, credentials, checkpoint persistence, microphone-level replay, PCM audio conversion, milestone dependency validation, and review recovery. A real ChatGPT-plan assignment and approval were verified. Physical microphone and on-device speech permission remain a first-use user check. See `docs/validation.md` for the desktop verification record.

macOS packaging also compiles the Speech helper with Xcode Command Line Tools.

Implementation references: [Codex app server](https://learn.chatgpt.com/docs/app-server), [ChatGPT authentication](https://learn.chatgpt.com/docs/auth), [on-device speech](https://developer.apple.com/documentation/speech/sfspeechrecognitionrequest/requiresondevicerecognition), [OpenAI background mode](https://developers.openai.com/api/docs/guides/background), [file transcription](https://developers.openai.com/api/docs/guides/speech-to-text), [MCP connections and approvals](https://developers.openai.com/api/docs/guides/tools-connectors-mcp), and [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra).
