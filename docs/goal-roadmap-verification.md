# Goal creation and execution verification

Verified locally on 2026-09-10, on `pablo-updates`, using the desktop app's existing ChatGPT connection and `gpt-6-astra` employee sessions.

## Behavior changed

- Roadmap generation uses low reasoning effort for the structured planning call, concise goal-specific milestones, exact roster IDs, capability context, and one bounded validation repair. Employee reasoning settings are unchanged.
- Independent tasks can start concurrently, with at most four starts per scheduler pass. Durable claims precede every dispatch. Explicit manager-selected owners remain fixed; an unclaimed AI-selected owner can yield to an available employee with equal or better role fit.
- Completion notifications refresh the workspace promptly. Polls coalesce, and a completion arriving during a refresh requests a follow-up instead of being lost.
- Revisions wait for persisted worker completion; concurrent requests cannot create duplicate worker turns.
- Downstream assignments carry matching task, producer, session, review/version, and SHA-256 review-content references. Included excerpts have their own hashes and truncation flags. Original files are not represented as shared.
- The roadmap displays observed planning time, started sessions, work in progress, pending reviews, and approved milestones.

## Live evidence

The initial baseline attempt failed before generation because an inherited HTTP tool configuration was being merged with a stdio override. The transport fix preserves each server's transport type while disabling inherited tools. A real app-server initialization and account read succeeded afterward.

### Launch-kit run

Roadmap: `77200411-d3f0-4813-bb31-6eeb959713c8`.

- Goal saved at `19:11:33.381Z`; validated roadmap persisted at `19:11:45.314Z`: **11.933 seconds**.
- Exactly three requested milestones, existing employee owners, two independent drafts, and one dependent handoff.
- Jules and Leo started real sessions 18 milliseconds apart. The first dispatch was confirmed 67 milliseconds after the roadmap was persisted.
- Independently inspected local files: the brief contains exactly 150 whitespace-separated words; the checklist contains exactly five actionable checks with evidence and pass criteria.
- Approving only the brief left the handoff planned. Approving the checklist at `19:13:06.586Z` caused Oliver's dispatch confirmation at `19:13:06.648Z`.
- Oliver produced the local handoff using the approved texts. Its brief and checklist match those reviewed texts; absent original files were disclosed.
- The roadmap became complete only after the third review was approved. Three sessions and three approved outputs are retained.

Local machine-readable evidence: `output/goal-verification/first-live-run.json`.

### Arithmetic and provenance run

Roadmap: `b6c76b2e-7ee9-4ea8-9ff2-5f40043db087`.

- Goal saved at `19:16:20.640Z`; validated roadmap persisted at `19:16:32.740Z`: **12.100 seconds**.
- Exactly three tasks. Existing Astra Lab and Leo sessions independently produced `17 + 23 + 41 = 81` and `(8 + 10 + 18) / 3 = 12`.
- Independent arithmetic checks agree. The saved calculation-file SHA-256 values match the employee reports.
- The combined report started automatically after both approvals, with the new provenance context.
- Independently recomputed all **nine** SHA-256 file hashes in the resulting manifest. All match. Both prerequisite task/session/review/version/producer references match the saved workspace records, and both reproduced review texts exactly match the approved database content and hashes.
- The final report preserves the distinction between available local sum files and inaccessible original mean files. Its calculation and review-text verification are complete; the inaccessible originals remain explicitly unverified by that employee.
- After approving the verified report, the roadmap shows three completed tasks, three approved outputs, and zero active sessions.

Local evidence: `output/goal-verification/arithmetic-live-run.json` and `output/goal-verification/arithmetic-audit/audit-report.md`. Together the two live runs produced **six** real task sessions and six approved deliverables. Evidence exports exclude account identities and credentials.

## Automated validation

`npm test`: **171 passed, zero failed**. Coverage includes schema/graph repair, ownership, parallel starts, durable claims, failed/uncertain dispatch, dependency approvals, stale session protection, completion persistence, concurrent revisions, refresh coalescing, transport isolation, and provenance hash/truncation behavior.

TypeScript, Vite, and the desktop build pass. `git diff --check` passes.

## Scope

These are real local desktop runs, not simulated sessions. They verify this connection and these goals; the optional API mode was not exercised live. No before/after speed ratio is claimed because the baseline failed before model generation. Review-text hashes establish content identity; they do not independently attest inaccessible original files or product launch readiness. The test goals performed local file work and no external publication or messaging.
