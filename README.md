# Astra HQ

Astra HQ is a Next.js application for directing AI employees. The web build uses Clerk organizations for sign-in, Convex for workspace data and live subscriptions, a persistent Node worker for Agents sessions, and an MCP gateway for provider access.

The application starts with an empty workspace, an empty marketplace, and no provider configuration. Bring up the services and configure providers with [the deployment guide](docs/deployment.md).

Organize work into [project floors](docs/project-floors.md), each with a brief and a team of employees. Employees can serve on multiple floors. Tasks keep a copy of their original project context for review.

## Run locally

Install Node 22, copy `.env.example` to `.env.local`, and fill in a development Clerk instance and Convex deployment. Then run:

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

Convex holds all state: workspace data, the job queue, the journal, and the operational configuration every service reads. The browser subscribes to it directly. The worker claims queue jobs and session monitors under Convex leases, so replicas can be added freely. Agents sessions run in an OpenAI hosted environment with network access disabled and subagents disabled, and reach providers only through the gateway with a task-scoped run token. The gateway exposes the intersection of the connection's granted tools, the employee version's capability, and the administrator's tool registry, journals every read, write proposal, and denied attempt, and turns writes into proposals a person decides.

Provider configuration is data, not deployment configuration. A platform administrator sets enabled server URLs, OAuth clients, native inbox secrets, and the tool registry on the Operations page inside the running app. Environment variables cover bootstrap trust and tunables only. Secrets are sealed by the web service before Convex sees them; Convex never holds a plaintext secret or the encryption key.

[Architecture](docs/architecture.md) is the contract every service builds against; read it first.

The available model IDs are `gpt-5.6-luna`, `gpt-5.6-terra`, `gpt-5.6-sol`, and `gpt-6-astra`. The names shown to users are Luna, Terra, Sol, and Astra.

## Demo branch

The pre-migration demo is preserved at commit `110d2ba` on `origin/demo`. Check that branch before changing the deployment branch. The migration does not import its sample records or create an employee automatically.

## Current limits

- Every external write becomes an approval proposal before dispatch. Only the owner of the connection that would execute it, or a workspace owner or admin, can approve, reject, or correct it. A task creator borrowing someone else's shared connection cannot.
- A write is correctable only when its registry row has a correction descriptor naming the read tool, the id and version fields, and the fields to restore. Everything else gets a manual correction task or nothing. A correction restores fields; it does not recall notifications or downstream effects.
- A dispatched write whose result never arrives is recorded as uncertain, not failed, and is never retried automatically. Reconcile it with provider evidence.
- The app records token usage per model and per month, with an optional workspace token cap. It stores no cost estimate and shows none. Upstream OpenAI, Railway, and provider charges are separate.
- A user holds one connection per provider server. Reconnecting the same account on the same server replaces it and resets the allowed tools to every reviewed tool on that server.
- Gmail prepares drafts. There is no send operation.
- Serving other companies through Slack or Google Workspace depends on the vendor review gates listed in [the deployment guide](docs/deployment.md).

## References

- [OpenAI Agents API](https://developers.openai.com/api/docs/guides/agents)
- [Convex with Clerk](https://docs.convex.dev/auth/clerk)
- [Railway Dockerfiles](https://docs.railway.com/builds/dockerfiles)
- [Railway variables](https://docs.railway.com/variables)
