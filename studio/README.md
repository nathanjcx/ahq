# Astra HQ Studio

A visual frontend for a personal AI workforce: an architectural 3D office, a mission map, and a decision workspace that connects your judgment to the team's next assignments.

## Run

Requires Node.js 22.13 or newer.

```sh
cd studio
npm ci
npm run dev
```

Open http://localhost:5180. Studio uses a different port from the desktop application's renderer. The root desktop application and runtime remain unchanged on this branch.

## Walk through the experience

1. Select a person in the office to focus their current assignment; open their profile for personality, skills, and conversation.
2. Switch to **Workstream** to follow research and narrative into your review, then into creative concepts and the launch handoff.
3. Open the launch brief, edit the direction, and inspect the two assignments your approval makes possible.
4. Choose **Approve this version**. The map, assignments, activity, and commitment progress update together. The launch stays in progress at 75%; the handoff still needs work.
5. Edit the approved text to require a fresh review. Request changes to save specific feedback for Maya.
6. Play the mission sequence beneath the office. Stop or restore to recover the workspace from before the demo, including its activity. Reloading an interrupted demo automatically restores that checkpoint.
7. Choose 2, 5, or 15 minutes for a fitting next action without moving the commitment's deadline.
8. Grow the team with four fields: name, job title, personality, and skills. Use Announce, conversations, commitments, and Resources for the supporting flows.

Immersive mode includes keyboard focus containment and Escape to exit. Motion can be paused and respects reduced-motion preferences. The employee list and optional browser navigation tools provide access beyond the 3D canvas.

## Scope

This is an independent interactive frontend prototype. Its Northstar activity and replies are local demo behavior. It does not connect to the sibling desktop runtime, Astra cloud sessions, background execution, or account integrations. Employees, commitments, messages, events, goal, draft, and approved version persist in browser-local storage. Folder previews show names and sizes only; no file contents are uploaded.

## Validate

```sh
npm run typecheck
npm run build
```

Built with React, TypeScript, Three.js, and accessible dialog, sheet, tab, and command primitives. The renderer includes a guarded event connection for asynchronous canvas teardown and pauses rendering while the workstream view is visible.
