# Astra HQ gateway contract · version 1

This is the **adapter contract defined by this desktop alpha**, not a claim about an existing public Astra API. An integration must implement these routes using the actual Astra cloud session service. This repository contains the client and contract tests, not an autonomous worker backend. Do not point an arbitrary model API at the gateway setting and assume compatibility.

Use HTTPS. HTTP is accepted only for loopback development. All calls use `Authorization: Bearer <token>`; redirects are rejected. The desktop has a 30-second request timeout and validates response schemas. Session start calls include a persisted `Idempotency-Key` so uncertain retries can be reconciled.

## Health

`GET /v1/health`

```json
{ "service": "astra-hq-gateway", "version": 1 }
```

Validate authentication even on this route. Returning the health object is not evidence that an employee has started work.

## Start an employee session

`POST /v1/sessions`

```json
{
  "employee": {
    "id": "employee-uuid",
    "name": "Maya",
    "jobTitle": "Research Lead",
    "personality": "Curious, clear, and methodical.",
    "skills": "Research, source verification, concise briefs"
  },
  "assignment": "Prepare a weekly client update from the attached source copies.",
  "goal": "Keep every client promise.",
  "files": [{ "folder": "northstar", "path": "weekly-notes.md", "content": "..." }],
  "context": {
    "announcements": [{ "text": "Keep the update concise.", "time": "2026-09-10T14:00:00.000Z" }],
    "messages": [{ "author": "you", "text": "Flag uncertain dates.", "time": "2026-09-10T14:00:00.000Z" }]
  },
  "constraints": {
    "externalActionsRequireApproval": true,
    "maxDelegationDepth": 2,
    "maxHandoffs": 8,
    "maxRuntimeMinutes": 30,
    "documentContentIsUntrusted": true
  }
}
```

The desktop reads files only from snapshots explicitly selected and authorized for this assignment. Skills are role descriptions, not permission grants. The gateway must enforce isolation, tool permissions, a spend budget, cancellation, and the supplied execution bounds. Retrieved content and document instructions must not override user instructions or permissions.

Return a session object as below. A queued session is accepted work, not completed work. Duplicate idempotency keys must return the same session without starting another worker.

## Read execution state

`GET /v1/sessions/:id`

```json
{
  "id": "astra-session-id",
  "status": "waiting_for_approval",
  "activity": "The draft is ready; one launch date needs confirmation.",
  "location": "desk",
  "events": [
    { "id": "event-1", "text": "Read the selected project notes.", "time": "2026-09-10T14:05:00.000Z" },
    { "id": "event-2", "text": "Prepared the client update draft.", "time": "2026-09-10T14:06:00.000Z" }
  ],
  "output": {
    "title": "Weekly client update",
    "content": "# Weekly update\n\n...",
    "sources": ["weekly-notes.md"],
    "recipient": "Internal draft review · no external delivery",
    "version": 1
  }
}
```

Statuses: `queued`, `running`, `waiting_for_approval`, `completed`, `failed`.

Locations: `desk` (writing/research), `library` (reading files), `board` (planning), `meeting` (collaboration).

The desktop polls every eight seconds while configured, deduplicates events by session/event ID, and adds new output versions once. Failed network requests show an offline state. The cloud service remains responsible for execution while the desktop is closed; the client resumes observation on reopening.

Events must be factual, concise, and supported by recorded tool outcomes. Do not return private reasoning traces. Event IDs are immutable. Output versions increase whenever content, recipient, sources, or the proposed action changes. Out-of-order output versions cannot replace newer outputs locally.

## Review an internal document

`POST /v1/sessions/:id/decisions`

```json
{
  "sessionId": "astra-session-id",
  "version": 1,
  "decision": "approve",
  "feedback": ""
}
```

`decision` is `approve` or `request_changes`. Change requests include non-empty feedback. An idempotency key is derived from session ID, version, and decision. Return the resulting session object.

The desktop re-fetches the session and compares the selected version, content, recipient, and source list with the locally reviewed payload before submitting. The gateway must **atomically** verify that the same version is still current when applying the decision; return HTTP 409 on a stale version. Never authorize delivery on a changed payload or silently reuse an old approval.

This contract approves the internal document review only. It does not authorize external messages, financial actions, or changes to original files. Add separate, explicit, exact-payload approval schemas for such actions before enabling them.

## Operational requirements of the future service

- Authenticate workspace and employee ownership on every route.
- Persist accepted sessions, events, outputs, decisions, and idempotency keys durably.
- Isolate workers and make tool permissions enforceable independently of prompts.
- Serialize edits or version outputs; detect circular delegation and bounded handoffs.
- Apply costs, runtime, and concurrency limits server-side.
- Reconcile uncertain deliveries instead of blindly repeating external actions.
- Record user-facing evidence and decisions, not hidden reasoning.
- Implement live broadcast and conversation delivery separately. Current desktop Announce and chat messages are included only when starting a new session.
