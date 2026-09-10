# The office tool atlas

The office is a concrete representation of a rigorous agent engine. Each object has a job; each action must be supported by an actual operation or receipt. Optional research, analysis, service lines, and automatic wakeups operate only when configured.

These are product mappings. The live scene animates recorded event categories; controls and inspectors explain the remaining mechanisms. A mapping is never evidence that an operation occurred.

| # | Capability | Technical mechanism | Office object | Visible action | Evidence required |
|---|---|---|---|---|---|
| 1 | An employee at work | Persistent Astra response chain | Personal desk and assignment folder | Opens the assigned brief and continues the same work folder across turns. | Session ID, run ID, response ID, and recorded lifecycle state. |
| 2 | Role charter | Persona and system instructions | Signed role charter beside the nameplate | Uses a chosen purpose, values, voice, decision style, and collaboration style. | Saved configuration revision and the run’s frozen configuration. |
| 3 | Focus time | Configured model reasoning effort | Focus lamp | Shows an observed active run; deeper effort is a setting on the lamp. | Configured effort and provider run status. No invented thoughts. |
| 4 | Scratchpad | Working memory | Scratchpad in the employee’s drawer | Keeps typed temporary working notes when memory is permitted. | Working memory entry, owner, scope, provenance, and expiry. |
| 5 | Work journal | Episodic memory | Dated journal | Files a useful experience for later reference. | Episodic memory entry with source session and retention. |
| 6 | Fact cabinet | Semantic memory | Labeled fact drawers | Files a fact card under its permitted scope. | Semantic memory entry and the successful tool receipt. |
| 7 | Playbook shelf | Procedural memory | Procedures binder | Keeps a reusable method for future assignments. | Procedural memory entry and provenance. |
| 8 | Working agreement | Preference memory | Preference card in the employee’s folder | Remembers how you want work prepared. | User-edited or approved preference entry. |
| 9 | File a memory | memory_remember and durable local persistence | Filing cabinet | Places a new memory card in the configured drawer. | Committed memory record and memory.saved event; proposals stay separate. |
| 10 | In tray for review | Proposed memory | Unfiled card in an approval tray | Offers a memory for your approval before it can be recalled. | memory.proposed event and inactive proposed status. |
| 11 | Look through the index | memory_search | Card index and cabinet drawer | Finds permitted active memories relevant to the task. | Search tool receipt; expired and disallowed memories are excluded. |
| 12 | Remove a memory | memory_forget and retention eviction | Shredder beside the cabinet | Removes the active local memory card and records the removal. | memory.forgotten event. Earlier conversations and exports are separate records. |
| 13 | Private drawer | Employee memory scope | Employee-labeled drawer | Keeps memory available to its owner. | Owner and scope checks on each retrieval. |
| 14 | Assignment folder | Session memory scope | Folder bound to one assignment conversation | Keeps context within its recorded session. | Session ownership and scope checks. |
| 15 | Shared cabinet | Workspace memory scope | Shared reference cabinet | Shares only memories allowed by the employee’s settings. | Explicit workspace scope and permission checks. |
| 16 | Drawer labels and expiry tabs | Retention, entry limits, context limits | Dated dividers and a limited reading stack | Keeps only eligible records and brings a bounded selection to the desk. | Retention checks and configured context/entry limits. |
| 17 | Search the library | workspace_search | Library card catalogue | Looks for relevant passages in selected working copies. | Search receipt tied to an authorized file snapshot. |
| 18 | Read a working copy | workspace_read | Reading desk | Opens the selected document or a bounded passage. | Read receipt for the exact snapshot path and range. |
| 19 | Visitor’s reading pass | Explicit snapshot selection and cloud-sharing consent | Document checkout slip | Only carries documents selected for this run to the reading desk. | Selected snapshot IDs and explicit sharing choice. |
| 20 | Prepare a deliverable | artifact_write | Drafting bench and document printer | Places a completed document in the out tray. | Committed artifact ID, content, session, and tool receipt. |
| 21 | Browse completed work | artifact_list | Deliverable shelf | Looks through the employee’s saved documents. | Owned artifact-list result. |
| 22 | Open a deliverable | artifact_read | Document stand | Reads a previously saved deliverable. | Owned artifact-read receipt. |
| 23 | Hand over a copy | Native artifact export | Document out tray | Hands you a file after you choose its destination. | Actual native export result; saving an artifact alone is not an export. |
| 24 | Find a teammate | office_list_employees | Staff directory | Finds teammates they are allowed to contact. | Permission-filtered employee directory result. |
| 25 | Send an envelope | office_send_message | Outgoing mail tray | Places an addressed envelope in the internal queue. | message.queued event with sender, recipient, and message ID. |
| 26 | Open the inbox | office_read_inbox | Personal inbox tray | Opens messages actually addressed to the employee. | message.delivered event; reading does not imply acknowledgment. |
| 27 | Stamp received | office_acknowledge_message | Received stamp | Stamps one message after explicitly acknowledging it. | message.acknowledged event for that exact message ID. |
| 28 | Desk bell | Configured on-message initiative | Desk bell | Wakes an idle employee only when automatic response is enabled. | Permitted delivery followed by a real session invocation. |
| 29 | Routing slip | Handoff depth and recipient allowlists | Envelope routing slip | Shows who may receive a handoff and how far the chain may continue. | Checked recipient policy and recorded handoff limit. |
| 30 | Office noticeboard | Manager broadcast | Noticeboard | Routes your written direction to employees who accept announcements. | Saved manager message and separate real session dispatches. |
| 31 | Research terminal | Provider web search | Research terminal with a globe marker | Searches external sources only when enabled. | Provider web-search call result; no result is invented. |
| 32 | Analysis bench | Provider code interpreter | Calculator and analysis bench | Runs calculations or data analysis when enabled. | Provider code-interpreter call result and returned output. |
| 33 | Service line | Configured remote MCP tools | Labeled service phone | Uses the selected service line, respecting its approval policy. | Exact remote tool name, requested arguments, approval, and provider receipt. |
| 34 | Decision on your desk | Exact-action tool approval | Manager’s review desk | Brings the exact requested action to you before execution. | Version-bound approval and the resulting tool receipt. |
| 35 | Deliverable review | Human review of completed work | Review folder and approval stamp | Presents the finished output for your judgment. | Exact output version and recorded review decision. |
| 36 | Next-step note | Durable queued manager guidance | Note clipped to the assignment folder | Keeps a new instruction ready for the next turn without discarding current work. | Persisted guidance ID and its later continuation. |
| 37 | Work allowance | Token, tool, turn, and runtime limits | Desk timer and work allowance card | Shows observed consumption against the limits you chose. | Provider usage, local tool receipts, and enforced dispatch bounds. |
| 38 | Stop card | Transport abort and provider cancellation attempt | Stop card on the active folder | Stops local work and shows whether remote cancellation was confirmed. | Cancellation state and any explicit remote uncertainty. |
| 39 | Help flag | Tool or provider failure | Raised help flag | Calls attention to the actual failure with a useful next action. | Failure receipt or provider error, not an inferred emotion. |
| 40 | Office archive | Atomic SQLite persistence | Archive filing cabinet | Files committed work and its audit entry together. | Atomic local write with the corresponding ledger record. |
| 41 | Archive box | Hashed workspace checkpoint | Dated archive box | Preserves the exact recorded office state. | Checkpoint content hash and anchored ledger event. |
| 42 | Office projector | Deterministic historical replay | Projector and time reel | Reconstructs recorded state and events at the selected time. | Fixed recording bounds, recorded frame, checkpoint, and event sequence. |
| 43 | Chain of custody | Hash-chained event ledger | Numbered archive register | Shows which recorded operation caused each visible action. | Sequence, timestamp, previous hash, payload hash, and verification report. |
| 44 | Missing reel marker | Absent frames or legacy unverified history | Explicit gap on the time reel | Shows missing or unverified coverage instead of inventing a scene. | Coverage report, legacy status, and first/last recorded bounds. |
| 45 | Reopen an archive box | Local checkpoint restore | Reopened archive box | Restores local workspace state after preserving the current checkpoint. | Restore record; completed external actions are not undone. |

A tool call begins an action; a successful receipt completes it. A queue receipt shows an envelope waiting; a delivered receipt shows it opened; explicit acknowledgment adds the stamp. A saved database record files a card only after the write succeeds. Historical playback uses the recorded time and data, labels gaps, and never dispatches a tool. Audit hashes establish consistency of local records; they do not prove remote execution independently of the recorded provider receipts.
