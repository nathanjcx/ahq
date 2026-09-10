# Little Office

A desktop office where local agents turn incoming requests into reports, code changes, meeting briefs, and calendar events. The office is an interactive pixel-art scene. Click a worker to inspect its activity and output.

The sources and incoming streams are fictional. Triage and task execution use real Codex through a ChatGPT login. Agents read and write actual local files. Calendar actions affect only the application's local demo calendar; no remote PRs are published or messages sent.

## Incoming-work demo

The office starts with 26 useful context messages across ten projects. Three CSV-to-PDF report requests lead the arrival picker, followed by the existing task, follow-up, and integration scenarios. Archived acknowledgements, social notices, digests, and other filler have been removed. Historical context does not automatically start work.

Open **Simulate an arrival** to choose and edit a suggested message, write a new message, or create a meeting. Codex decides whether to ignore it, create a task, attach it to existing work, or wait for missing information or another task. Decisions and reasons appear in the Inbox and Tasks view. New tasks receive temporary worker characters; recurring agents retain their identity. Idle residents welcome new workers at the door, take coffee breaks, and tend plants. Work animations reflect reading, drafting, coding, QA, and scheduling. Reduced motion skips social movement.

Tasks run through Codex against a workspace containing source messages, attachment files, and the exact prerequisite artifacts. Bug fixes use a small local checkout project with Node tests. QA uses a verified copy of its parent fix's workspace, with a file-hash manifest linking the two. Corrections can create linked revisions, completed work can release waiting tasks, and meeting briefs can be refreshed after their inputs change. Source content is evidence rather than privileged agent instructions.

Gmail and Slack each include a connected 11-message conversation with file-backed attachments. The full picker offers 18 Gmail and 17 Slack deliveries, including one Slack duplicate.

The curated arrivals cover a launch report, cross-provider corroboration, an acknowledgement, QA requested before its fix, a duplicate delivery, meeting preparation, a dinner request with missing details and a calendar conflict, a corrected support count, and an unrelated report request. Additional arrivals exercise nine other projects and informational messages.

This requires internet access and Codex subscription allowance for both intake and execution. There is no canned-output or offline execution mode. The supported work types are document reports, local checkout fixes and QA, meeting briefs, and local calendar events. External integrations are disabled. The AI news watch fetches public X profiles directly. Schedules run only while the app is open. Clicking a worker opens full streaming agent messages, activity and artifacts. Messages persist per attempt, including failed and cancelled runs. This is not a streamed computer desktop. The board records findings and task handoffs, with scripted coffee-break conversations and reactions to completed artifacts. Posts labeled "Simulated chat" run locally, cost no model usage, and never trigger work or enter agent prompts.

## AI news watch

A paused routine checks ten X accounts every ten minutes when enabled: @OpenAI, @AnthropicAI, @GoogleDeepMind, @xAI, @MistralAI, @huggingface, @sama, @karpathy, @_akhaliq, and @swyx. Run now performs one collection without enabling its schedule. Each collection fetches public profile data locally. If it finds previously unreviewed posts in the window, one offline Codex turn classifies them. Empty checks use no model allowance. No subagents are started.

The first window starts at local midnight. Later collections resume from the last fully checked window; partial coverage keeps the earlier boundary so unseen posts are not skipped. Post IDs prevent duplicates, and their encoded timestamps help reject old URLs presented as current news. Rumors are labeled unconfirmed. Public profile data is a limited timeline: unavailable accounts and partial results stay visible in each report.

Routines show past runs and their artifacts. AI news also has a cumulative, searchable collection with announcement/rumor filters and original post links. Structured results persist in the local SQLite snapshot and each run's `collection.json`; reports are saved beside them. This feature requires ChatGPT sign-in and internet access, but no X API key. It cannot guarantee complete or immediate X coverage.

## Local evidence

The checked-in `demo-data/projects/` directory contains the fictional project records: source CSVs, owner registers, budgets, operations notes, and planning constraints. `demo-data/checkout/` contains the checkout code and tests. Gmail and Slack conversation files and their attachments live under `demo-data/arrivals/`.

Each job receives a local copy of the project corpus plus its delivered message attachments. Future arrival attachments stay out of the workspace until delivered, so agents cannot use a correction or confirmation before it arrives. The original corpus stays unchanged when an agent writes a report or fixes code.

## Run

Use Node.js 22 or newer and npm. Install the Codex CLI separately for ChatGPT sign-in and live execution. Browsing the fictional office remains available without Codex, but triage and work require it. The packaged app includes its Node runtime and dependencies; Codex CLI is currently a separate installation. No API key or .env file is required.

```sh
npm install
npm run dev
```

For a production build:

```sh
npm run build
npm start
```

To create an unpacked desktop distribution:

```sh
npm run package
```

The Linux executable is under `release/linux-unpacked/`. Packaging runs on the current platform. This repository's desktop verification targets Linux.

## ChatGPT connection

Open Settings and select **Sign in with ChatGPT**. Codex opens its browser authentication flow; Little Office updates when authentication completes. An existing local Codex ChatGPT login is recognized automatically. API-key authentication does not unlock subscription mode.

All new work executes with Codex. Leave the model field blank to use the configured Codex default, or supply a model available to your account. Model calls use your ChatGPT account's Codex allowance. The runtime and files are local; inference still requires the hosted service and an internet connection.

Codex owns authentication credentials. Signing out uses Codex's logout operation and affects the shared local Codex login.

## Demo controls

The **Simulate an arrival** panel groups suggested requests and follow-ups. Choose a suggestion to review and edit its source, sender, subject, message, and thread before delivering it. Its evidence attachments and provider identity stay attached. Follow-ups include corrected figures, missing details, and a duplicate delivery. Nothing arrives until you submit it.

**New incoming message** accepts a blank request without assigning a task type. **New calendar event** creates a local event and sends it through intake for preparation. These actions simulate the incoming stream; the resulting model calls are real. Recent activity and task history remain visible. There are no playback or speed controls.

Use Tasks to inspect the intake reason, worker, dependencies, missing details, input artifacts, and finished output. Supply a clarifying message when a task needs information. Reuse its project or issue reference so intake can associate the reply correctly, including across providers.

**Reset demo data** in the simulation panel restores the current fixture set and clears active office history. Existing installations retain their saved state until reset; use reset to load the expanded dataset after updating from V1. Generated files from earlier runs remain on disk.

Closing the application stops its runtime. Routines do not run while the computer or application is off. Interrupted execution is surfaced for retry on the next launch; dependency waits remain waiting.

## Local browser preview

The desktop app is the primary deliverable. A loopback-only preview is included for visual QA:

```sh
npm run build
npm run preview
```

Open `http://127.0.0.1:4318`. Preview data is separate from desktop data. The preview uses an authenticated local command endpoint and a subscription stream; it is not a hosted service.

## Verification

```sh
npm test
npm run build
node scripts/auth-smoke.mjs
node scripts/smoke.mjs
```

The Electron smoke check requires a graphical session and writes screenshots to `test-results/`. It checks scene clicks, inbox filters, attachment previews, the incoming-message composer, routine editing, board posts, and the calendar without starting model work. It also checks suggestion preview and cancellation. Set `OFFICE_TRIGGER_SMOKE=1` to additionally deliver an edited suggestion through real Codex triage. Set `OFFICE_EXECUTABLE` to the packaged executable to run the same checks against the distribution.

The authentication check uses an isolated Codex profile to verify the real login URL and cancellation without changing your existing sign-in. It does not start a model turn.

`node scripts/live-smoke.mjs` additionally verifies a real report through an existing ChatGPT login. Use `OFFICE_LIVE_SCENARIO=bug node scripts/live-smoke.mjs` to check a real local patch. It uses subscription allowance and keeps its workspace separate from the application's normal data.

`node scripts/triage-smoke.mjs` delivers the first 16 curated events through real Codex triage and execution. It writes decisions, task state, artifacts, and screenshots under `test-results/`. Set `OFFICE_TRIAGE_LIMIT` to change the number of deliveries, or `OFFICE_TRIAGE_EVENTS` to a comma-separated list of event IDs for a focused check. This uses the existing ChatGPT login and subscription allowance in an isolated temporary office.

`node scripts/calendar-smoke.mjs` checks the local event form, real intake, and generated meeting brief. It also uses Codex allowance.

`npx tsx scripts/verify-arrivals.mts` delivers the entire catalog through real Codex and checks that ready tasks finish with actual artifact files. It retains the isolated office, decisions, workspaces, and outputs under `test-results/arrivals-*` for inspection. Set `OFFICE_VERIFY_EVENTS` to comma-separated arrival IDs for a focused run. This uses ChatGPT Codex allowance.

## Structure

| Directory | Responsibility |
| --- | --- |
| `electron/` | Window, narrow preload bridge, runtime process host |
| `runtime/` | SQLite persistence, fixtures, queue, schedules, Codex transport |
| `src/shared/` | Commands and snapshot contracts |
| `src/` | React application and PixiJS office |
| `scripts/` | Development, packaging support, preview, smoke check |

The runtime publishes durable work state and ordered activity. The office derives poses, routes, and workstation animations from that state. Animation timing never controls execution.

Future real integrations should normalize external items into the existing source contract and implement external actions behind the runtime. They should preserve external IDs for deduplication and retain source links on work and artifacts.

## Configuration

| Variable | Purpose |
| --- | --- |
| `CODEX_BIN` | Override the Codex executable path |
| `OFFICE_DATA_DIR` | Override the local runtime data directory |
| `OFFICE_PORT` | Override the browser-preview port |

Desktop state normally lives in Electron's application data directory. No connector OAuth credentials or real inbox data are required for this demo.

## Simulate a message with your own data

Choose **Simulate an arrival → New incoming message**, select any channel, and attach UTF-8 CSV, JSON, Markdown, text, or code files. Each file can be up to 200 KB, with ten files per message. The app copies their contents into the local inbox and the agent's isolated workspace. Binary formats such as PDF and Excel are not supported by this picker.

**Use sales report example** fills a complete request and attaches `demo-data/custom-arrival/sales.csv`. The picker also includes campaign and support CSV report requests across Gmail and Slack. Codex calculates and writes each report, and the app exports a PDF locally. Use **Open PDF** on the completed artifact. Delivering the message starts real Codex triage and execution. Open its task or worker, then **Agent messages** to follow the response live or revisit it after completion. Existing historical runs retain only the activity they originally saved.

Demo action labels appear on suggested arrivals and historical messages. They describe the intended demonstration in the UI and are excluded from the model's message content.


## Meeting preparation

Calendar meetings have timed agendas, named attendees, locations, and decisions to discuss. The sales, campaign-budget, and support reviews include CSV pre-reads and link to their related report requests. Meetings fall on the next business day; focus time and personal commitments remain separate calendar blocks.

Choose **Prepare meeting notes** to send a meeting through real Codex intake and execution. Its evidence includes the meeting agenda, CSV, and related completed reports. The resulting brief contains verified figures, discussion questions, proposed actions, and blank space for decisions made during the meeting. It does not fabricate minutes. **View meeting notes** opens the saved brief and full agent messages. Repeated preparation clicks reuse the same request.
