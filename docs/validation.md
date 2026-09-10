# Local alpha validation

Validated on Apple Silicon macOS, September 10, 2026.

## Automated checks

`npm run check` runs the workflow, snapshot, and gateway-contract tests, then TypeScript and both production builds. Tests cover schema recovery, idempotent events and output versions, duplicate decisions, stale approvals, requested changes, source provenance, secret/path exclusions, symlinks, source immutability, private atomic writes, HTTPS enforcement, credential placement, redirect rejection, and gateway response validation.

Gateway tests use a local test server. They do **not** demonstrate connection to an actual Astra worker service.

## Browser interaction checks

- Created Alex with all four fields and a suggested role profile.
- Edited the profile and verified it survived reload.
- Saved an announcement and verified it reported pending delivery honestly.
- Created a commitment with an owner, recipient, deadline, definition of done, and next step.
- Approved the sample supplier review; its linked commitment completed.
- Requested changes to the sample forecast; the feedback and decision were retained.
- Opened the tentative future view and returned to the office.
- Checked the 390 px mobile layout: document width remained 390 px, and the dialog stayed within the viewport.
- Observed no browser runtime errors after the final scene fixes.

## Packaged macOS checks

- Built and launched the actual Electron app bundle.
- Selected the repository’s fictional `samples/northstar` folder through the native folder picker.
- Verified an isolated copy with two source files and no cloud upload.
- Prepared the source brief and inspected both original source excerpts.
- Exported the resulting Markdown through the native save dialog to `docs/northstar-source-brief.md`.
- Approved the review and restarted the app to check persistence.

The sample data used for checks is fictional. No email, Slack message, financial transaction, cloud upload, or live employee session was performed.
