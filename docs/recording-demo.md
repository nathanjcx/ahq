# Recording the local demo

Open the Electron app and sign in with ChatGPT in Settings. The Meeting, Email and Slack buttons in the demo dock create local notifications. Each starts real Codex triage, then a separate employee session if work is needed. No integration credentials or cloud database are required. Codex must be installed and signed in; bug verification also uses Git. Runs consume your ChatGPT allowance.

Email uses the checked-in sales CSV to produce a report PDF. Meeting uses sales, campaign data and an agenda to produce a brief. Slack copies the checked-in checkout project into a fresh workspace, checks the real fix against the original regression tests, and produces a simulated PR containing the diff. Nothing is published to GitHub.

The dock also accepts a goal. These demo roadmaps create dedicated employees and advance after local deliverables pass checks. Independent steps run concurrently; dependent steps receive the complete text of their predecessors' artifacts. QA receives the exact code from its bug-fix prerequisite. The normal roadmap entry retains manual review.

## Trigger from a recording script

While Electron is open, run:

```sh
node scripts/demo-trigger.mjs email --user-data '/path/to/electron/userData' --key take-1-email
node scripts/demo-trigger.mjs slack --user-data '/path/to/electron/userData' --key take-1-slack
node scripts/demo-trigger.mjs meeting --user-data '/path/to/electron/userData' --key take-1-meeting
node scripts/demo-trigger.mjs state --user-data '/path/to/electron/userData'
```

Use `--connection /path/to/demo-connection.json` instead if convenient. Electron writes that file in its user-data directory on launch and removes it on clean exit. It contains a random localhost port and bearer token. Reusing a key returns the existing notification without starting duplicate work. A new key starts another real run.

The HTTP interface accepts `POST /notifications` with a JSON object containing `kind`, optional `idempotencyKey`, `title`, `content`, and `attachments`. Each attachment is `{name, mediaType, content}` with UTF-8 text. Binary screenshot input is not supported yet. Send `Authorization: Bearer <token>` from the connection file. `GET /state` returns notification histories and sessions. Requests bind to 127.0.0.1 only; browser mutation requests are rejected.

The dock shows backend-triggered arrivals, intake and employee sessions, streamed messages, saved results and local artifacts. Failed notifications can be retried there or through `retry <notification-id>` in the CLI. Interrupted dispatches with an uncertain session ID require inspection instead of automatic retry.

Current verification uses injected provider responses, real local files, real PDF generation, real tests and HTTP requests. It does not establish the quality or reliability of a fresh live Codex response. Rehearse the chosen live scenario before recording. There is no checkpoint/restore or recorded-playback mode yet.
