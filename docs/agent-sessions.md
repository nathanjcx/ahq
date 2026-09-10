# Configurable Astra employee sessions

Every employee uses `gpt-6-astra`. The backend rejects other model IDs, including in the legacy local Codex transport. API reasoning choices are low, medium, high, xhigh, and max. Configuration is validated, revisioned, and copied into each run; new manager turns load the employee's latest saved configuration. An in-progress turn retains its configuration snapshot, with local tool permissions also checked against current saved grants.

## User controls

Hiring and editing expose role instructions, reasoning, response/run token limits, turns, tool calls, elapsed time, web search, data analysis, selected file-copy access, artifact writing, individual remote MCP connections, memory kinds/scopes/retention/write mode, message permissions, teammate allowlists, automatic responses, handoff limits, tool approval, and completion review. Profile skills are descriptive and grant no tools. Missing legacy configuration receives visible starter settings; invalid configuration fails instead of silently selecting different permissions.

## Persona and visible work

Each employee has a configurable purpose, values, communication style, collaboration style, and decision style. These fields enter the real run instructions along with role and skills. A persona never grants tools, changes memory access, or expands budgets.

The office reduces recorded operations into deterministic locations, poses, station cues, reactions, and message paths. The wall display counts observed session statuses. Memory proposals occupy a review tray; approved writes use the correct typed drawer. Queue, delivery, and acknowledgment remain separate. The [45-item office tool atlas](office-tool-atlas.md) describes every local tool and the additional engine/control metaphors.

## Execution and continuity

`HostedEmployees` maintains a persisted employee-session index, remote response chain, pending requests, function-call outputs, tool receipts, queued guidance, configuration snapshots, and observed usage. Distinct employees run concurrently. Per-session locks protect tool execution and decisions. Manager guidance arriving during work waits for the next turn without discarding the current response. New assignments can reuse the employee's conversation after a run completes or is stopped. Cancellation aborts local transport immediately and attempts to cancel the remote response; uncertainty is reported explicitly.

Cloud work uses Responses background mode. While the desktop is closed, the provider may finish its current response. Local office tools, inbox wakeups, and follow-up turns resume only when the desktop is running. Token limits use provider-reported usage and bound later dispatches; they are not a prepaid dollar cap and cannot retroactively stop input tokens already consumed by a provider response. Requests carry persistent idempotency keys, but an uncertain provider acknowledgment is not proof that a remote operation never occurred.

## Memory

Working, episodic, semantic, procedural, and preference memory are separate types. Session memory is tied to one session; employee memory belongs to one employee; workspace memory is visible only when sharing is configured. Read-only, proposed, and automatic writes have different effects. Proposed entries remain inactive until the user approves them. Entries retain provenance and expiry; the user can inspect, add, edit, approve, and forget them.

Typed memory, inboxes, artifacts, and mutation receipts are stored in app-owned SQLite data outside workspace rollback history. Forget removes the active local memory entry and its replayable tool result. It does not erase material already included in earlier provider conversation turns, exported artifacts, or other historical records. Changing permissions prevents future tool access; it does not retract content already sent to a provider.

## Tools and communication

Local function tools read only selected file snapshots; they cannot access arbitrary filesystem paths or change source files. Artifact tools create real documents in the app-owned store. Web search, data analysis, and remote MCP tools are enabled individually. Tool review applies to exact requested local or remote actions according to the employee's settings.

Office messages have separate queued, delivered, and acknowledged receipts. Only the acknowledgment tool records acknowledgment. Idle employees wake automatically only when both automatic responses and on-message initiative are enabled. Recipient/sender allowlists and handoff bounds are checked again at delivery. Manager messages and announcements invoke actual sessions; final outputs appear in direct conversations and review items.

## Desktop UI

Each employee has Session, Memory, Inbox, and Artifacts panels. Session metrics display observed usage and tool receipts, never simulated success. Configuration changes show the distinction between the current run revision and the saved next-turn revision. Credentials remain in the encrypted native vault and are not exposed to these panels.

A browser preview shows the design and configuration flow; native storage and real execution require the desktop application. Legacy gateway reads remain available for old sessions, but new configurable employee sessions use the direct Astra connection. Voice transcription is disabled in Astra-only mode because the previous transcription path used a different model.

## Verification

Run `npm run check`. The automated suites exercise temporary SQLite stores and controlled Responses protocol fixtures: typed memory isolation and expiry, exact approvals, restart recovery, mutation deduplication, direct conversations, queued guidance, concurrent employees, cancellation, handoff policies, model rejection, cache preservation, and legacy transport behavior. These tests establish local behavior, not successful live provider execution. Record live provider verification separately in `docs/validation.md`.

## Auditable replay

Workspace checkpoints, visual clock frames, and the append-only event ledger are hashed. Local memory, mailbox, and artifact mutations commit their event records in the same SQLite transaction. Tool events include session/run identity, configuration revision, tool identity, and input/result hashes where available. Raw credentials are excluded. Provider reasoning summaries are distinguished from local tool receipts; private hidden reasoning is not recorded.

Replay reads one historical SQLite slice. It never calls a tool, substitutes current workspace state for missing history, or turns playback into live work. The time range freezes when replay begins. Millisecond seek, event stepping, pause, speed, and an explicit Live action control the projector. Missing frames, old unhashed records, and bounded event tails are disclosed. Local workspace restoration is a separate explicit action and cannot undo provider operations, exports, or the private memory/mailbox/artifact stores.

Use **Archive ledger → Export and verify** for the complete JSON record. Recheck an exported artifact independently:

```sh
npm run audit:verify -- /path/to/Astra-HQ-audit.json
```

The command returns 1 for detected integrity failures, 2 for unreadable/invalid input, and 0 when no corruption is detected. Legacy records remain explicitly unverified even with exit code 0. Hashes establish local consistency; retaining an exported anchor gives you a separate record for later comparison.
