# Staff AI

Staff AI, by trystaff, is a Next.js application for directing AI employees. It runs at [app.trystaff.ai](https://app.trystaff.ai). The workspace is a tower: [floors](docs/project-floors.md) are rooms with a brief and a team of hired instances, and [projects](docs/architecture.md#floors-and-projects) are the plans that span them, with milestones, deadlines, and meetings. One instance stands on one floor and runs one shift at a time; a task without a floor belongs to nobody's room and is simply floorless. An employee reaches a provider only through the MCP gateway, which exposes the intersection of the connection's granted tools, the employee version's capability, and the administrator's reviewed tool registry. Every external write becomes a proposal a person decides, every read, proposal and denied attempt is journaled, and a supported write can be corrected afterwards under a recorded version precondition.

The interface is one build for both viewports: an isometric office that animates each employee's real activity from the journal, floors with a board and handoffs, a replay that rebuilds a finished task from its audit timeline, and a review bar that keeps pending approvals in reach. Convex holds the state and streams it to the browser; the worker runs Agents sessions under Convex leases; the web service holds the encryption key and the WorkOS session. [Architecture](docs/architecture.md) is the contract every service builds against, and [security](docs/security.md) holds the threat model, the controls, and the known gaps.

## Run locally

The application starts with an empty workspace, an empty marketplace, and no provider configuration. Install Node 22, copy `.env.example` to `.env.local`, and fill in a development WorkOS environment and Convex deployment. Then run:

```sh
npm ci
npm run dev
```

The full account and hosting setup is in [the deployment guide](docs/deployment.md). Use [the Google Workspace guide](docs/google-workspace-mcp.md) for the preview MCP servers and [the operations guide](docs/operations.md) for day-to-day checks. What is and is not verified is in [verification](docs/verification.md).

## Production shape

Railway runs three services from the same Node 22 Docker image, against one Convex deployment:

| Service | Start command     | Exposure                      | Health endpoint |
| ------- | ----------------- | ----------------------------- | --------------- |
| web     | `npm start`       | public HTTPS                  | `/health`       |
| worker  | `npm run worker`  | private, replica-safe         | `/health`       |
| gateway | `npm run gateway` | public HTTPS, token protected | `/health`       |

Convex holds all state: workspace data, the job queue, the journal, and the operational configuration every service reads. The browser subscribes to it directly. The worker claims queue jobs and session monitors under Convex leases, so replicas can be added freely. Agents sessions run in an OpenAI hosted environment with network access disabled and subagents disabled, and reach providers only through the gateway with a task-scoped run token.

Provider configuration is data, not deployment configuration. A platform administrator sets enabled server URLs, OAuth clients, native inbox secrets, and the tool registry on the Operations page inside the running app. Environment variables cover bootstrap trust and tunables only. Secrets are sealed by the web service before Convex sees them; Convex never holds a plaintext secret or the encryption key.

The available model IDs are `gpt-5.6-luna`, `gpt-5.6-terra`, `gpt-5.6-sol`, and `gpt-6-astra`. The names shown to users are Luna, Terra, Sol, and Astra.

## What an employee can make

An employee reaches integrations through capabilities, and makes files through its **workshop**: the studio tools it may call (`generate_image`, served by the gateway and archived as a file of the task), the Python libraries installed in its hosted environment (a fixed allow list in `lib/contracts/core.ts`: reportlab, python-pptx, python-docx, openpyxl, matplotlib, Pillow, pypdf, pandas, markdown), and the deliverable kinds its listing promises. The session attaches only what the workshop names, the gateway refuses the rest, and the marketplace shows what each employee produces. Design SaaS (Canva, Figma, Gamma, Adobe) gate their MCP servers behind partner allow lists, so a design deliverable is rendered by the employee itself rather than through an integration.

## Repositories and branches

`trystaff/staff-ai` is the production repository; Railway builds `main`. The same history is mirrored to `nathanjcx/ahq`, where `platform-v4` is the working branch. Seed the marketplace with `npx convex run --prod seed:catalog` after a deploy that changes `lib/catalog.ts`; the seed is idempotent.

## Current limits

- Every external write becomes an approval proposal before dispatch. Only the owner of the connection that would execute it, or a workspace owner or admin, can approve, reject, or correct it. A task creator borrowing someone else's shared connection cannot.
- A write is correctable only when its registry row has a correction descriptor naming the read tool, the id and version fields, and the fields to restore. Everything else gets a manual correction task or nothing. A correction restores fields; it does not recall notifications or downstream effects.
- A dispatched write whose result never arrives is recorded as uncertain, not failed, and is never retried automatically. Reconcile it with provider evidence.
- The app records token usage per model and per month, with an optional workspace token cap. It stores no cost estimate and shows none. Upstream OpenAI, Railway, and provider charges are separate.
- A user holds one connection per provider server. Reconnecting the same account on the same server refreshes it: a narrowing the owner made on Manage access is kept, and tools reviewed since are granted.
- A persona sets voice, up to five traits, and a catchphrase. It never widens what an employee may do.
- Rate limits are counted per web instance, and `CREDENTIAL_ENCRYPTION_KEY` has no dual-key reader. The full list is in [security](docs/security.md).
- Gmail prepares drafts. There is no send operation.
- Serving other companies through Slack or Google Workspace depends on the vendor review gates listed in [the deployment guide](docs/deployment.md): Google's Developer Preview enrolment and OAuth verification, and a Slack Marketplace listing. Canva waits on its MCP waitlist.
- A generated image is archived with the task; it does not land in the employee's environment, so an employee composes around it rather than embedding it.
- [Verification](docs/verification.md) lists exactly what is proven live and what is not.

## References

- [OpenAI Agents API](https://developers.openai.com/api/docs/guides/agents)
- [Convex with WorkOS AuthKit](https://docs.convex.dev/auth/authkit)
- [Railway Dockerfiles](https://docs.railway.com/builds/dockerfiles)
- [Railway variables](https://docs.railway.com/variables)
