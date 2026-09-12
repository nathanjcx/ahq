# Astra HQ

Astra HQ is moving from the Electron demo to a Next.js web application. The web build uses Clerk organizations for sign-in, Convex for workspace data and live subscriptions, a persistent Node worker for Agents sessions, and an MCP gateway for provider access.

This checkout contains the migration work. It is not a production deployment record. No production credentials or customer data belong in the repository, and the deployment procedure does not seed demo records.

## Run locally

Install Node 22, copy `.env.example` to `.env.local`, and fill in a development Clerk instance and Convex deployment. Then run:

```sh
npm ci
npm run dev
```

The full account and hosting setup is in [the deployment guide](docs/deployment.md). Use [the Google Workspace guide](docs/google-workspace-mcp.md) for the preview MCP servers and [the operations guide](docs/operations.md) for day-to-day checks.

## Production shape

Railway runs three services from the same Node 22 Docker image:

| Service | Start command     | Exposure                       | Health endpoint |
| ------- | ----------------- | ------------------------------ | --------------- |
| web     | `npm start`       | public HTTPS                   | `/`             |
| worker  | `npm run worker`  | private                        | `/health`       |
| gateway | `npm run gateway` | public HTTPS, bearer protected | `/health`       |

The web UI subscribes to Convex over its WebSocket connection. The worker consumes the Convex queue and reads Agents session events over SSE. The Agents session runs in an OpenAI hosted environment with network access disabled. MCP calls go through the application gateway using a short-lived task token. Subagents are disabled in the session configuration. Provider access is admitted by the Convex URL registry and employee capabilities are admitted by the separately reviewed tool registry; the browser never receives credentials or private employee instructions.

The available model IDs are `gpt-5.6-luna`, `gpt-5.6-terra`, `gpt-5.6-sol`, and `gpt-6-astra`. The names shown to users are Luna, Terra, Sol, and Astra.

## Demo branch

Keep the pre-migration demo at commit `110d2ba` on `origin/demo`. Check that branch before changing the deployment branch. The migration does not import its sample records or create an employee automatically.

## Current limits

External writes create an approval proposal before dispatch. A rejected proposal stops dependent work. A timeout can leave an external result uncertain and needs provider reconciliation. Correction is provider and tool specific, so the UI must not describe every action as undoable. Gmail support prepares drafts; it does not send mail.

The cost shown by the app is a reservation or estimate. It is not an invoice. OpenAI model and hosted-session charges are separate from Railway compute, storage, and network charges, and from any provider charges.

## References

- [OpenAI Agents API](https://developers.openai.com/api/docs/guides/agents)
- [Convex with Clerk](https://docs.convex.dev/auth/clerk)
- [Railway Dockerfiles](https://docs.railway.com/builds/dockerfiles)
- [Railway variables](https://docs.railway.com/variables)
