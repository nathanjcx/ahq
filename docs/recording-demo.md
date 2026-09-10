# Little Office launch demo

Open the Electron app, sign in with ChatGPT, and use the Little Office launch panel. Each action consumes your connected ChatGPT allowance. The app uses local data and files, with no Gmail, Slack or Calendar credentials.

## Play the story

1. **Prepare the launch.** Codex plans three independent assignments: complete the real 2D Little Office starter, create launch messaging, and calculate a six-month financial forecast. Open each employee stream while they work. The product source is pinned to this repository's `backend` branch, with provenance in `demo-data/little-office/fixture-manifest.json`.
2. **Investor email.** A fictional investor reports a competitor. Finance reads the saved original forecast, applies lower growth and higher churn, and creates a revised CSV and PDF. The app checks each output row against the scenario formulas.
3. **Slack bug.** A real screenshot captured from the completed product shows a deliberately staged launch CTA visibility regression. The coding agent works on a copy of that product, reproduces the issue, changes real code and produces a simulated PR. The host independently checks the fix. No GitHub PR is created.
4. **Reporter meeting.** The agent uses the launch messaging, revised forecast and product-fix evidence to write an interview brief with slogans, talking points and likely questions.
5. **Celebrate.** The office celebrates only after the current scene outputs and roadmap are verified complete.

The source messages and business figures are fictional. Agent sessions, files, previews, code changes and verification are real. The product begins as the actual existing Little Office application, not an application generated from scratch.

## Retake a scene

Each completed scene saves a checkpoint. Finish or stop active work before restoring one. Restore keeps original artifacts and session history, returns the scene controls to that point, and gives the next arrival a fresh source key. It does not reuse recorded model output as a live run. Replaying a later scene consumes allowance again; restoring a checkpoint alone does not.

The launch panel links employee streams. Notifications and saved work show the source message, attachments, intake decision, complete saved messages and downloadable artifacts. Earlier takes remain available in history.

## Trigger from a recording script

Electron writes `demo-connection.json` in its user-data directory on launch. Use its path explicitly:

```sh
node scripts/demo-trigger.mjs launch start --connection /path/to/demo-connection.json
node scripts/demo-trigger.mjs launch state --connection /path/to/demo-connection.json
node scripts/demo-trigger.mjs launch advance investor --connection /path/to/demo-connection.json
node scripts/demo-trigger.mjs launch advance bug --connection /path/to/demo-connection.json
node scripts/demo-trigger.mjs launch advance reporter --connection /path/to/demo-connection.json
node scripts/demo-trigger.mjs launch advance celebrate --connection /path/to/demo-connection.json
node scripts/demo-trigger.mjs launch restore CHECKPOINT_ID --connection /path/to/demo-connection.json
node scripts/demo-trigger.mjs launch retry investor --connection /path/to/demo-connection.json
```

The same backend gates apply to UI and script actions. `GET /launch` returns the current story; `POST /launch` accepts `{action, scene?, checkpointId?}`. Send the bearer token from the connection file to the localhost port in that file. Browser mutation requests are rejected.

Independent custom notifications remain under Custom tools. The existing `email`, `slack`, `meeting`, `state` and `retry` CLI commands remain available. `POST /notifications` accepts text attachments and PNG/JPEG attachments using `{name, mediaType, encoding: "base64", content}`. Images are decoded into real files and included directly in the Codex turn.

Codex must be installed and signed in. Git is required for simulated diffs. Frontend compilation uses dependencies shipped with the Electron app; it does not install packages during a demo task.
