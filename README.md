# Little Office

A desktop office where local agents turn incoming requests into reports, code changes, meeting briefs, and calendar events. The office is an interactive pixel-art scene. Click a worker to inspect its activity and output.

This V1 uses fictional Gmail, Google Calendar, iMessage, Slack, Discord, Linear, and Asana data. It includes deterministic demo execution and live execution through a locally installed Codex CLI signed in with ChatGPT. External calendar changes and PR publication are simulated in both modes.

## Run

Use Node.js 22 or newer and npm. Install the Codex CLI separately for ChatGPT sign-in and live execution. The demo remains available when Codex is missing.

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

Select **Live** in Settings to execute work with Codex. Leave the model field blank to use the configured Codex default, or supply a model available to your account. Model calls use your ChatGPT account's Codex allowance. The runtime and files are local; inference still requires the hosted service and an internet connection.

Codex owns authentication credentials. Signing out uses Codex's logout operation and affects the shared local Codex login.

## Demo

Start in Demo mode. Use Play to introduce the scenarios in sequence, Next to introduce one at a time, or choose an individual scenario. Speed controls demo pacing. Reset restores the fictional office and removes demo-generated work from its active state.

The scenarios cover a requested report, a checkout bug, meeting preparation, dinner scheduling, and recurring QA. Source items link to work; work links to activity and finished artifacts. The bulletin board records findings and handoffs. Routines can run manually, on an interval, or daily while the application is open.

Closing the application stops its runtime. Routines do not run while the computer or application is off. Interrupted work is surfaced for retry on the next launch.

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

The Electron smoke check requires a graphical session and writes screenshots to `test-results/`.

The authentication check uses an isolated Codex profile to verify the real login URL and cancellation without changing your existing sign-in. It does not start a model turn.

`node scripts/live-smoke.mjs` additionally verifies a real report through an existing ChatGPT login. It uses subscription allowance and keeps its workspace separate from the application's normal data.

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
