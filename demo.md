# Little Office: 60-second demo

We are launching **Little Office**, the actual 2D app from the `backend` branch. The 3D office builds and launches its smaller cousin. Messages, people and business figures are fictional; Codex sessions, files, screenshots and code changes are real. PRs are simulated and never published.

**The video is 60 seconds; a fresh live run takes longer.** Record the real work, then cut or speed up the waits. Scene gates deliberately prevent the next beat from running before its inputs exist. Do not present saved playback as a fresh live run.

## Shot list

| Video time | Show | Narration / point | Trigger |
|---|---|---|---|
| 0–7s | Little Office launch panel; start the launch | “We're launching Little Office: our AI office, in one fewer dimension.” | `launch start` |
| 7–17s | Roadmap and three workers; briefly open a stream and the 2D product | “One goal becomes parallel work: build the product, write the launch materials, and forecast revenue.” | Automatic after planning |
| 17–29s | Investor email, attached assumptions, original and revised forecast PDF | “An investor finds a competitor. Finance revises the existing forecast, using the new assumptions.” | `launch advance investor` |
| 29–43s | Slack screenshot; coding worker; actual CSS diff and verified simulated PR | “Someone spots a bug. The coding agent fixes the same product, and the app verifies the button works.” | `launch advance bug` |
| 43–53s | Upcoming reporter meeting; generated interview brief and slogans | “A reporter is coming. The team prepares talking points from the updated launch work.” | `launch advance reporter` |
| 53–60s | Completed roadmap; office party | “The launch is ready. The office has earned a break.” | `launch advance celebrate` |

Keep the source arrival, one visible agent action, and the finished artifact in each beat. The forecast check should show six-month revenue falling from **$11,388 to $9,360**. The bug is a disclosed, deliberately staged responsive-CSS regression: “Send first request” disappears at 960px. Its screenshot comes from the actual built app.

## Recording triggers

Open Electron, sign in with ChatGPT, and choose the application storage folder if prompted. The launch panel provides the same controls as the backend. Opening the app does not start the story; **Start the launch** does.

Electron writes `demo-connection.json` in its user-data directory. It contains the localhost port and bearer token. Keep that file out of the video. Pass its path explicitly:

```bash
AHQ_DEMO_CONNECTION="/path/to/demo-connection.json"

# Video beat 0s. This starts real planning and execution.
node scripts/demo-trigger.mjs launch start --connection "$AHQ_DEMO_CONNECTION"

# Inspect scenes, worker sessions and available checkpoints.
node scripts/demo-trigger.mjs launch state --connection "$AHQ_DEMO_CONNECTION"

# Run each only when its scene reports status "ready".
# Video beats 17s, 29s, 43s and 53s; these are editing targets, not sleeps.
node scripts/demo-trigger.mjs launch advance investor --connection "$AHQ_DEMO_CONNECTION"
node scripts/demo-trigger.mjs launch advance bug --connection "$AHQ_DEMO_CONNECTION"
node scripts/demo-trigger.mjs launch advance reporter --connection "$AHQ_DEMO_CONNECTION"
node scripts/demo-trigger.mjs launch advance celebrate --connection "$AHQ_DEMO_CONNECTION"
```

For another automation tool, use `GET /launch` to inspect readiness and `POST /launch` with `{ "action": "advance", "scene": "investor" }` to trigger a beat. Other actions are `start`, `retry` with a scene, and `restore` with a `checkpointId`. Use the port and `Authorization: Bearer <token>` from the connection file. The server binds to localhost; browser-origin mutations are rejected.

## Rehearse and retake

Each completed scene saves a checkpoint. Copy its ID from `launch state`, or select it in the panel:

```bash
node scripts/demo-trigger.mjs launch restore CHECKPOINT_ID --connection "$AHQ_DEMO_CONNECTION"
node scripts/demo-trigger.mjs launch advance investor --connection "$AHQ_DEMO_CONNECTION"

# Retry a failed scene without replaying successful earlier work.
node scripts/demo-trigger.mjs launch retry investor --connection "$AHQ_DEMO_CONNECTION"
```

Restore only after active work has finished or stopped. It retains prior session history and files. Advancing after restore creates a fresh arrival and consumes Codex allowance again; restoring alone does not. For a 60-second recording, rehearse the complete flow once, then use checkpoints to capture individual scenes and trim the waits.

See [recording-demo.md](docs/recording-demo.md) for custom email/Slack/calendar triggers and attachment formats. A complete live Codex rehearsal passed on September 10, 2026; results are below.


## Verified live rehearsal

The packaged Linux Electron app completed all five scenes using the signed-in ChatGPT account and real Codex sessions. The run took about ten minutes, including a product retry after fixing packaging. The 60-second shot list still requires cutting generation waits.

- Launch: real planner, three independent workers, marketing brief, baseline CSV/PDF, and a built preview of the pinned 2D app.
- Investor: real triage and a new finance worker; six-month revenue changed from $11,388 to $9,360. The original CSV stayed byte-identical. Both three-page PDFs were visually inspected.
- Slack: real triage, screenshot input, actual CSS change, and simulated PR. Electron verified the fixed action at 960 × 720 and clicked it to open the composer.
- Reporter: real triage and meeting brief containing the revised figures, tested-fix details, reporter questions, and slogans from the marketing kit.
- Celebration: all scenes completed, the actual UI celebration event fired, confetti appeared, and no agents remained active. Worker messages and artifacts stayed available afterward.

The rehearsal found and fixed two packaging failures: copying source/dependencies out of ASAR and spawning esbuild from inside ASAR. Setup failures now produce visible failed sessions; paused launch dispatches no longer look indefinitely running. Verification also passed 45 targeted tests and the native build/fix test against the packaged archive.

On the rehearsal machine, reopen the completed run with:

```bash
env -u ELECTRON_RUN_AS_NODE ./release/little-office-launch/astra-hq \
  --user-data-dir="$HOME/.local/share/ahq-launch-rehearsal"
```

Use that directory's `demo-connection.json` for CLI triggers. Select **Restore a checkpoint** for retakes; restoring does not start Codex, but advancing an earlier scene does. The completed run has no background generation running.

To repeat the packaged native check after packaging:

```bash
AHQ_PACKAGED_APP="$PWD/release/linux-unpacked/resources/app.asar" \
  npx tsx --test tests/little-office.test.ts
```
