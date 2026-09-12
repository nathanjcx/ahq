# Migration verification

Verified locally on September 11, 2026. Production accounts and provider credentials have not been configured.

## Checks

- `npm run typecheck` passes.
- `npm test` passes all 35 tests. Coverage includes tenant privacy, Clerk organization claims, tool grants, write approvals, cancellation, uncertain outcomes, correction conditions, queue leases, stale turn completion, budget rollover, signed inbox delivery, and project floors.
- The real local Convex backend compiled the schema and functions. Runtime checks exercised organization workspace creation, private draft publication, public listing redaction, hiring, task creation, and cancellation.
- `docker build -t ahq-web-check .` builds the production application. The image starts all three service commands as a non-root user.
- Web, gateway, and worker health endpoints returned HTTP 200. The worker connected to the local Convex subscription. An unauthenticated MCP request returned HTTP 401.
- Playwright passed desktop and mobile navigation against the production Docker web service. It also checked modal focus, Tab wrapping, Escape, focus restoration, browser errors, and mobile viewport width.
- `npm audit --omit=dev` reported zero vulnerabilities.

The code reduction and quality review removed the desktop/demo runtime, obsolete UI, unused dependencies, and redundant branches. It corrected queue races, audit acknowledgement handling, permission revocation, server-side skill hashes, and deployment variable scopes.

## Project floors

The local Convex backend also compiled the project schema and functions. Runtime checks created three project floors, staffed them, and assigned tasks. They verified that editing a project preserves existing task context, archiving blocks new work, restoring permits the floor again, and coworkers cannot read each other's private tasks. Unit checks cover inbox project assignments and correction context after archiving. Session configuration checks confirm that a project brief does not enter privileged employee instructions.

Browser checks exercised floor selection, employee filtering, task creation, saved project context, keyboard staffing selection, failed-save retention, automatic navigation after creation, archive/restore, archived task filtering, and mobile drawer focus and width. Screenshots were inspected across successive desktop and mobile passes. The populated views used a temporary UI fixture with data from the local test workspace. That route and its authentication stubs were removed before the production build.

After fixture removal, `npm run build`, TypeScript, and all 35 tests passed. Both Playwright navigation tests passed against `npm start`, and the web health endpoint returned HTTP 200. The production build's route list contains no QA route.

The reduction pass removed the replaced office layout and unused CSS. The quality pass corrected stale project selection, repeated task submission, archived history access, lobby staffing, keyboard focus, and employee status display. An independent review found no remaining scoped issues.

- [Project floors, desktop](screenshots/floors-desktop.png)
- [Project floors, mobile](screenshots/floors-mobile.png)
- [Floor staffing, desktop](screenshots/floor-staffing-desktop.png)
- [Floor staffing, mobile](screenshots/floor-staffing-mobile.png)

See [project floors](project-floors.md) for behavior and deployment order.

## Visual review

These screenshots show the production build with no connected account or seeded records:

- [Office, desktop](screenshots/office-desktop.png)
- [Office, mobile](screenshots/office-mobile.png)
- [Integrations, desktop](screenshots/integrations-desktop.png)
- [Integrations, mobile](screenshots/integrations-mobile.png)

Marketplace media and admin editing were also reviewed at desktop and mobile sizes using a temporary local fixture. That fixture was removed and is not shipped.

## Checks requiring accounts

Follow [deployment](deployment.md) to configure Convex, Clerk, Railway, storage, OpenAI, and provider clients. Then run its final acceptance steps with test provider records. Live OAuth consent, Agents sessions, provider reads and writes, compensation, cloud artifact storage, and production rollout remain unverified until those accounts are available.

Replay displays the recorded journal. It does not rerun provider actions or recover intermediate events that OpenAI did not persist. Correction requires an explicitly verified conditional MCP operation; otherwise the app creates a manual correction task. Costs are estimates, not invoice guarantees.
