# Astra HQ

A desktop office for AI employees. Give the team a direction, let employees do the work using your ChatGPT plan, and provide judgment when they bring results back.

This is the combined `main` application: **Ultrabranch’s complete 3D office**, **AHQ-Birth’s light layout and employee flow**, and **main’s SQLite/Codex runtime**. The original studio architecture, furniture, meeting room, lounge, library, articulated avatars, and walking routes are retained in `studio/app/office.tsx` and used directly by the desktop renderer.

## Start

```sh
npm install
npm run dev:desktop
```

On macOS, the development launcher prepares a signed local **Astra HQ.app** in
`release/dev` and opens it through Launch Services. This gives microphone and
Speech Recognition requests the app's own permission descriptions, including when
launched from a terminal or IDE. Use `npm start` to open the already-built renderer.

**Start demo** and **Reset** sit side by side, immediately left of the date.
Start plays a two-minute **Astra HQ Product Launch** walkthrough using the existing
app controls. A persistent guide explains your role as CEO, what each employee
does, how work passes between teammates, and where your approval is needed.
The Office stays central, with time to watch the team and read its chat. A moving
cursor clicks the **! above each employee** to review their work and approve
decisions. Previews open over Office, keeping the people behind the work in view.

The walkthrough hires a Marketing Intern, creates a roadmap, replies to a fictional
Thrive Capital meeting request, prepares a calendar invitation, and reviews sample
work. Marketing offers three photos; the selected second option goes to Engineering
for the prepared landing page. The team celebrates in Office, with seven sample
files available to inspect and download.

**Reset** prepares a fresh sample workspace without starting playback; **Start demo**
plays it again. **Exit demo** restores your live workspace. The walkthrough does
not change live data or send real messages. **Live office** has its own navigation
tab for actual sessions and launch controls. See [the product launch demo](docs/product-launch-demo.md).

Production build and macOS application:

```sh
npm run package
```

Open `release/mac-arm64/Astra HQ.app`. The development build is ad-hoc signed for local use; it is not notarized for public distribution. `npm run dev` opens only the renderer preview, without native storage, microphone transcription, or cloud credentials.

## Set up your office

New workspaces start with an empty office: no employees, assignments, conversations, or reviews. Add your first employee when you are ready. Existing workspaces are preserved; an example office remains available explicitly in Settings.

1. Choose a local database folder when prompted, or keep the application folder. Existing Birth data is imported without deleting its original JSON file.
2. Open the **profile button → ChatGPT account**. Astra HQ reuses an existing ChatGPT/Codex sign-in or opens the official browser login. Employee work uses `gpt-6-astra` through your plan’s Codex allowance. You can optionally save an encrypted OpenAI API key in the profile menu as a credit fallback; it is used only when a ChatGPT session reports a quota or credit limit.
3. Enter the employee’s **Name** and **Job**, then click **Generate personality**. AI writes their working personality through the selected ChatGPT/API connection. Every employee includes **Astra session** internally, and receives a randomly generated avatar. There are no skill or appearance controls in employee creation.
4. Set the **Goal** and choose **Create roadmap & start**. AI builds the milestone graph and automatically delegates available steps to employees. Approving a deliverable unlocks its dependent work. You can also select an employee and choose **Assign task**: the task appears immediately in Roadmap and follows their session through work, your review, and completion. Optional local file copies are shared only when explicitly selected and authorized.

**Optional API access** in Settings enables separately billed hosted sessions, remote MCP tools, and API transcription. It explicitly switches new assignments to API mode; ChatGPT mode never falls back to API billing. An organization-operated gateway remains available under the optional gateway settings. It must implement the contract in `docs/astra-gateway.md`; no gateway is bundled or implied to exist. OpenAI-hosted sessions work directly with a supplied API key.

## What is included

- **Navigation:** Office, Employees, Roadmap, and Files, in that order. Office fits the window without page scrolling; chat and long dialogs scroll internally. The top bar contains the date, Settings, and a profile button that opens a compact ChatGPT sign-in popup. Reviews and activity/export are also available inside Settings.
- **Theme:** bundled Pixelify Sans throughout, light cream/sage panels, square controls, crisp borders, and pixel shadows.
- **Office:** a miniature office app icon and Ultra’s original cutaway, camera rotation/zoom, walking and articulated poses, with Birth’s light shell, north-star goal banner, and light isometric grid backdrop. Room tags are removed. The file cabinet opens your saved folders; employees with active file/storage tasks visit it and open its drawer.
- **Roadmap:** AI turns each new goal into a complete dependency graph with deliverables, suggested dates, owners, status, zoom, and a searchable list. Available employees automatically start ready milestones; approved results become context for dependent steps. Busy employees finish their current sessions first. An empty office can plan before hiring. Pause/resume controls affect new delegation, and stopped steps require an explicit retry. Claims are persisted before dispatch, preventing duplicate work after interruption. Earlier roadmaps remain in storage/history; the graph displays the current goal. Interrupted planning reports an error with a retry option.
- **Chat:** a full chat panel beside the office, with a channel selector for the team, individual employees, and announcements. Includes typed broadcasts, voice transcripts, and delivery receipts. Team/direct notes remain saved context for new assignments.
- **Review:** a floating amber exclamation mark appears above each employee with pending work. Click it or the employee to open the deliverable and choose Yes / No with feedback. When an employee needs a choice, the popup displays their specific options and sends the selected answer back to the same session for another review.
- **Appearance:** randomly generated skin tone, hair/style, hat, glasses, and clothing color persist with each employee and appear in the office and portraits. Appearance editing is removed.
- **Timeline:** a minimal scrubber, Live button, and Beta capsule. Workspace changes and five-minute checkpoints are still recorded while the desktop process is open, along with the avatar clock and microphone levels. Scrub into the past, then select the scene’s replay timestamp to review restoring that checkpoint. Rollback first saves the current state, restores local workspace data, and keeps the activity journal. Active sessions must be stopped first. Remote actions and exported files cannot be undone or replayed by rollback.
- **Announce:** hold with a pointer or Space/Enter, speak, then release. The button sits directly below the office. A giant megaphone floating above the far wall expands with microphone volume and sends out animated sound waves; avatars stop walking and face the camera. In ChatGPT mode, macOS Speech transcribes on-device after microphone/speech permission; on-device support for the system language is required. A private temporary WAV is deleted after transcription, including failure. API mode uses OpenAI transcription. The transcript guides employees; active turns stop before replacement turns begin. Delivery failures are reported per employee.
- If microphone access is declined, Astra HQ opens **System Settings → Privacy & Security → Microphone**. Use the **Reveal Astra HQ in Finder** action below Announce to drag the app into that list, then turn it on and try again.
- **ChatGPT plan work:** official Codex app-server browser sign-in, background employee turns, persistent per-employee conversations, progress, cancellation, result review, and revisions. Tokens remain with Codex. Work runs in an isolated local directory while the app is open; closing the app stops active turns, and new assignments can resume their saved conversation. Office badges and activity exports identify ChatGPT sessions separately. Account changes cannot continue a different account’s session.
- **Cloud work (optional API):** background Responses API calls, durable remote response IDs, polling/recovery, source links, human review, revisions, and stop controls. The office displays cloud-session badges only for employees with a session. Sample content is labeled separately.
- **Integrations:** encrypted keys and user-provided HTTPS remote MCP endpoints. Existing employee integration skills continue to enable their configured tools; remote tool calls require an explicit review of the requested action. Built-in Web search and Data analysis use OpenAI-hosted tools.
- **Activity:** user actions, employee messages, cloud work, reviews, and the original local runtime in one durable journal, filterable and exportable as CSV or JSON.
- **Files:** a local inventory of the SQLite database, saved workspace folders, and generated employee documents. Each item can be shown in Finder, and the storage-folder button opens the containing directory on macOS.
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
