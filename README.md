# Astra HQ

A warm, visual headquarters for an AI workforce. A macOS desktop foundation built with Electron, React, TypeScript, and an interactive orthographic Three.js office.

**Status: working local alpha.** Employee profiles, commitments, conversations, local folder snapshots, source briefs, document review, and persistence work locally. Real employee execution requires an Astra service implementing the gateway contract in [docs/astra-gateway.md](docs/astra-gateway.md). No Astra API specification or credentials were supplied, so this repository does not pretend to run real cloud agents. Calendar, Gmail, Slack, and project-tool connections are visibly marked as planned.

## Run it

Requires Node.js 22.12+ and npm. Development was verified on Apple Silicon macOS with Node 26.

```sh
npm ci
npm run install:desktop
npm run dev:desktop
```

For the browser preview:

```sh
npm run dev
```

Open `http://127.0.0.1:5173`. Browser mode supports the workspace UI, local persistence, document export, and short text excerpts from selected folders. Full snapshots and cloud connections require the desktop companion.

```sh
npm run check       # Tests, TypeScript, production UI, desktop bundle
npm run package     # Local macOS .app in release/mac-arm64
npm run dist:mac    # Development DMG in release/
```

The development app is ad-hoc signed. Distribution outside your own machine needs your Apple signing and notarization configuration.

## Try a complete local workflow

1. Open **Settings & connections → Add folder**.
2. Select `samples/northstar` from this repository.
3. Open **Prepare brief** on the resulting local copy.
4. Review the actual source excerpts and the checklist of unresolved questions.
5. Approve the review or request changes, then export the Markdown document.
6. Restart AHQ: profiles, context, decisions, and source copies remain available.

The source brief is a deterministic local inventory, clearly labeled as such. It is not a generated client update. With a compatible Astra gateway connected, select an employee, describe the assignment, select source copies, explicitly authorize their upload, and start a cloud session. Returned work appears in the review queue.

## What is included

- Furnished orthographic office with desks, monitors, cabinets, a kitchen, lounge, meeting table, plants, glass partitions, and selectable employees.
- A clearly marked sample scene; one sample walking route. Real employees move to locations reported by cloud execution events.
- Exactly four editable employee profile fields: name, job title, personality, skills. Role-based starter profiles are deterministic templates, not advertised as AI output.
- An overarching goal, Announce, team notes, and individual conversations. Locally authored messages become context for **new** cloud assignments; live bidirectional chat and broadcast acknowledgments are not implemented.
- Commitments with owners, recipients, firm/flexible deadlines, dependencies, definitions of done, and useful next steps. Overdue and dependency states are explainable rules. No statistical confidence is invented.
- Reviewable documents with exact content, sources, recipients, version numbers, approve/request-changes controls, Markdown export, and a decision history.
- Past activity records and tentative future commitments. The past view is a history panel, not a reconstructed 3D replay.
- Native folder selection and versioned local working copies; no automatic mutation of original files.
- Atomic JSON persistence on desktop; schema-validated local storage in the browser. JSON is intentionally the alpha storage layer; SQLite and multi-device synchronization are not implemented.
- A typed Astra gateway adapter with encrypted credentials, session polling, durable start-operation keys, response validation, bounded context uploads, and stale-output checks.
- Responsive mobile layouts, keyboard-accessible lists, search (`⌘K`/`Ctrl+K`), focus-trapped dialogs, reduced motion, and optional sound controls.
- Locally bundled fonts and procedural artwork. No runtime CDN or analytics dependency.

## Local data and permissions

On macOS, application data lives under `~/Library/Application Support/Astra HQ/`:

- `workspace.json`: profiles, assignments, messages, approvals, and history.
- `snapshots/<uuid>/`: source copies and manifests.
- `cloud.json`: gateway endpoint plus a token encrypted with Electron `safeStorage`.
- `operations.json`: idempotency keys for recovering uncertain session starts.

Snapshots allow up to 100 text files, 512 KB per file, 8 MB per copy. Hidden paths, generated directories, symlinks, common credential filenames, private-key content, recognizable credential patterns, binary files, and oversized files are excluded. This is defense in depth; heuristic secret filtering is not a guarantee that every sensitive value is recognized. Review your selection before authorizing cloud sharing.

The Electron renderer is sandboxed, has no Node access, and uses a narrow validated preload bridge. Arbitrary browser permissions, navigation, popups, and remote script execution are blocked. Cloud calls run in the main process; tokens are never returned to the renderer. An isolated file copy is **not** a worker execution sandbox. The real Astra service must enforce worker isolation and action permissions.

Approval does not send emails, contact suppliers, place orders, or modify originals. The current gateway decision contract approves internal document review only. External delivery and file-merge workflows need their own exact-payload approvals before implementation.

## Structure

```text
src/App.tsx                   App navigation, persistence, dialogs, cloud polling
src/components/OfficeScene.tsx Procedural 3D room and employee movement
src/components/Pages.tsx       The six work surfaces and settings
src/lib/store.ts               Sample data, profile templates, source briefs
src/lib/workflow.ts            Idempotent execution and review transitions
shared/                       Types, schemas, file-selection policy
desktop/main.ts               Electron lifecycle and validated IPC
desktop/preload.ts            Narrow desktop bridge
desktop/workspace.ts          Local snapshots and atomic writes
desktop/gateway.ts            Astra gateway client
samples/northstar/            Fictional source files for trying the workflow
tests/                       Workflow, file isolation, gateway contract tests
```

## Next integration milestones

1. Map the documented gateway to the actual Astra cloud API and verify one real selected-folder → employee → deliverable → review workflow.
2. Add authenticated, durable server-side orchestration and genuine session-to-session handoffs. Desktop requests describe bounds; the gateway must enforce them.
3. Add live announcements/messages, cloud reconnection reconciliation, and explicit cancellation.
4. Add scoped OAuth connections and exact-payload delivery approvals.
5. Add richer commitment scheduling, a furniture editor, immutable replay, and multi-device storage.

The supplied product brief and screenshots were treated as product reference material. They are not runtime instructions for employees. Uploaded source content is explicitly classified as untrusted in the gateway request.
