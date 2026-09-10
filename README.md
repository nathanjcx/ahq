# Little Office

A desktop office where local agents turn incoming requests into reports, code changes, meeting briefs, and calendar events. The office is an interactive pixel-art scene. Click a worker to inspect its activity and output.

The sources and incoming streams are fictional. Triage and task execution use real Codex through a ChatGPT login. Agents read and write actual local files. Calendar actions affect only the application's local demo calendar; no remote PRs are published or messages sent.

## Incoming-work demo

The office contains 450 historical messages across ten projects, with 30 distinct new messages available for delivery and one deliberate duplicate delivery. The full dataset has 480 unique messages and 84 readable CSV, Markdown, and JSON attachments. Historical messages provide context without automatically starting work.

Deliver an event from the office picker, advance playback, or write a message in the Inbox's incoming-message form. Codex decides whether to ignore it, create a task, attach it to existing work, or wait for missing information or another task. Decisions and reasons appear in the Inbox and Tasks view. New tasks receive temporary worker characters; recurring agents retain their identity. Idle residents welcome new workers at the door, take coffee breaks, and tend plants. Work animations reflect reading, drafting, coding, QA, and scheduling. Reduced motion skips social movement.

Tasks run through Codex against a workspace containing source messages, attachment files, and the exact prerequisite artifacts. Bug fixes use a small local checkout project with Node tests. QA uses a verified copy of its parent fix's workspace, with a file-hash manifest linking the two. Corrections can create linked revisions, completed work can release waiting tasks, and meeting briefs can be refreshed after their inputs change. Source content is evidence rather than privileged agent instructions.

The curated arrivals cover a launch report, cross-provider corroboration, an acknowledgement, QA requested before its fix, a duplicate delivery, meeting preparation, a dinner request with missing details and a calendar conflict, a corrected support count, and an unrelated report request. Additional arrivals exercise nine other projects and informational messages.

This requires internet access and Codex subscription allowance for both intake and execution. There is no canned-output or offline execution mode. The supported work types are document reports, local checkout fixes and QA, meeting briefs, and local calendar events. Web search and external integrations are disabled. Schedules run only while the app is open. Clicking a worker opens its activity and artifacts, not a streamed computer desktop. The board records findings and task handoffs; it is not an autonomous group chat.

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

Use **Deliver** to send the selected fictional arrival, **Deliver next event** to advance once, or Play to deliver the sequence. These controls simulate the incoming stream; the resulting model calls are real. In Inbox, **New incoming message** lets you type a new request without assigning it a task type. The local calendar form creates a demo event and sends it through intake for preparation.

Use Tasks to inspect the intake reason, worker, dependencies, missing details, input artifacts, and finished output. Supply a clarifying message when a task needs information. Reuse its project or issue reference so intake can associate the reply correctly, including across providers.

Reset restores the current fixture set and clears active office history. Existing installations retain their saved state until reset; use reset to load the expanded dataset after updating from V1. Generated files from earlier runs remain on disk.

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

The Electron smoke check requires a graphical session and writes screenshots to `test-results/`. It checks scene clicks, inbox filters, attachment previews, the incoming-message composer, routine editing, board posts, and the calendar without starting model work. Set `OFFICE_EXECUTABLE` to the packaged executable to run the same checks against the distribution.

The authentication check uses an isolated Codex profile to verify the real login URL and cancellation without changing your existing sign-in. It does not start a model turn.

`node scripts/live-smoke.mjs` additionally verifies a real report through an existing ChatGPT login. Use `OFFICE_LIVE_SCENARIO=bug node scripts/live-smoke.mjs` to check a real local patch. It uses subscription allowance and keeps its workspace separate from the application's normal data.

`node scripts/triage-smoke.mjs` delivers the first 16 curated events through real Codex triage and execution. It writes decisions, task state, artifacts, and screenshots under `test-results/`. Set `OFFICE_TRIAGE_LIMIT` to change the number of deliveries, or `OFFICE_TRIAGE_EVENTS` to a comma-separated list of event IDs for a focused check. This uses the existing ChatGPT login and subscription allowance in an isolated temporary office.

`node scripts/calendar-smoke.mjs` checks the local event form, real intake, and generated meeting brief. It also uses Codex allowance.

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
