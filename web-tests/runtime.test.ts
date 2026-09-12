import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server as UpstreamServer } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { makeFunctionReference } from 'convex/server';
import { api } from '../convex/_generated/api';
import type { Backend } from '../lib/server/backend';
import { seal, unseal } from '../lib/server/secrets';
import { executeAction } from '../services/actions';
import { createGateway } from '../services/gateway/create';
import type { Job } from '../services/types';
import { harness, identity, publishEmployee, secret, type Harness } from './support';

// The fake upstream runs on loopback HTTP, which every production network rule rejects.
process.env.ALLOW_INSECURE_MCP_FOR_TESTS = '1';
process.env.CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64');
process.env.APP_URL = 'https://app.example';

const upstreamToken = 'fixed-upstream-token';
const subject = 'owner-user';
const capability = ['get_issue', 'update_issue', 'delete_issue'];

interface Issue {
  id: string;
  version: number;
  title: string;
  state: string;
}

function upstream() {
  const issues = new Map<string, Issue>([
    ['ISSUE-1', { id: 'ISSUE-1', version: 1, title: 'Original title', state: 'open' }],
  ]);
  const record = (value: object) => ({
    structuredContent: value as Record<string, unknown>,
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
  });
  const failure = (text: string) => ({ isError: true, content: [{ type: 'text' as const, text }] });
  const idSchema = { type: 'object' as const, properties: { id: { type: 'string' } }, required: ['id'] };
  const build = () => {
    const mcp = new UpstreamServer(
      { name: 'fake-issues', version: '1.0.0' },
      { capabilities: { tools: {} } },
    );
    mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        { name: 'get_issue', description: 'Read one issue.', inputSchema: idSchema },
        {
          name: 'update_issue',
          description: 'Update one issue.',
          inputSchema: {
            type: 'object' as const,
            properties: {
              id: { type: 'string' },
              expectedVersion: { type: 'number' },
              title: { type: 'string' },
              state: { type: 'string' },
            },
            required: ['id', 'expectedVersion'],
          },
        },
        { name: 'delete_issue', description: 'Delete one issue.', inputSchema: idSchema },
      ],
    }));
    mcp.setRequestHandler(CallToolRequestSchema, async (call) => {
      const args = (call.params.arguments || {}) as Record<string, unknown>;
      const issue = issues.get(String(args.id));
      if (!issue) return failure('No such issue.');
      if (call.params.name === 'get_issue') return record(issue);
      if (call.params.name === 'delete_issue') {
        issues.delete(issue.id);
        return record({ id: issue.id, deleted: true });
      }
      if (call.params.name === 'update_issue') {
        if (args.expectedVersion !== issue.version)
          return failure(`Stale expectedVersion: the issue is at version ${issue.version}.`);
        const next: Issue = {
          ...issue,
          version: issue.version + 1,
          ...(typeof args.title === 'string' ? { title: args.title } : {}),
          ...(typeof args.state === 'string' ? { state: args.state } : {}),
        };
        issues.set(issue.id, next);
        return record(next);
      }
      return failure('Unknown tool.');
    });
    return mcp;
  };
  const server = createServer((req, res) => {
    void (async () => {
      if (req.headers.authorization !== `Bearer ${upstreamToken}`) {
        res.writeHead(401).end();
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      const mcp = build();
      await mcp.connect(transport);
      res.on('close', () => void mcp.close());
      await transport.handleRequest(
        req,
        res,
        chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined,
      );
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500).end();
    });
  });
  return { server, issues };
}

/** Routes the service call names the gateway and executor use into convex-test. */
function testBackend(t: Harness): Backend {
  const run = async <T>(kind: 'query' | 'mutation', name: string, args: Record<string, unknown> = {}) => {
    const reference = makeFunctionReference<'query' & 'mutation'>(name);
    const withSecret = { ...args, secret };
    return (
      kind === 'query' ? t.query(reference, withSecret) : t.mutation(reference, withSecret)
    ) as Promise<T>;
  };
  return {
    query: (name, args) => run('query', name, args),
    mutate: (name, args) => run('mutation', name, args),
    journalMutation: (name, args) => run('mutation', name, args),
  };
}

async function mcpClient(url: string, token: string) {
  const client = new Client({ name: 'test-agent', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

let fake: ReturnType<typeof upstream>;
let gateway: Server;
let t: Harness;
let client: Client;
let gatewayUrl = '';
let connectionId = '';
let taskId = '';
let runToken = '';
let firstProposalId = '';

/** Claims queue jobs until the approved action is claimed, then runs it like the worker does. */
async function runApprovedAction() {
  for (let attempt = 0; attempt < 6; attempt++) {
    const [job] = await t.mutation(api.services.queue.claimJobs, {
      secret,
      workerId: 'worker-1',
      limit: 1,
    });
    if (!job) throw new Error('Expected a queued job');
    if (job.kind !== 'execute_action') {
      await t.mutation(api.services.queue.completeJob, {
        secret,
        jobId: job.id,
        leaseToken: job.leaseToken,
      });
      continue;
    }
    await executeAction({
      id: job.id,
      kind: 'execute_action',
      taskId: String(job.taskId),
      payload: job.payload as Record<string, unknown>,
      leaseToken: job.leaseToken,
      attempts: job.attempts,
    } satisfies Job);
    return;
  }
  throw new Error('Expected an execute_action job');
}

async function approveAndRun(proposalId: string) {
  await t.withIdentity(identity(subject)).mutation(api.actions.decide, {
    proposalId: proposalId as never,
    approved: true,
  });
  await runApprovedAction();
}

async function proposal(proposalId: string) {
  return t.run(async (ctx) => ctx.db.get(proposalId as never) as Promise<Record<string, unknown> | null>);
}

async function toolCalls() {
  const timeline = await t.query(api.services.actions.auditTimeline, {
    secret,
    taskId: taskId as never,
    authSubject: subject,
  });
  return timeline.toolCalls;
}

beforeAll(async () => {
  fake = upstream();
  fake.server.listen(0, '127.0.0.1');
  await once(fake.server, 'listening');
  const upstreamUrl = `http://127.0.0.1:${(fake.server.address() as AddressInfo).port}/mcp`;

  t = harness();
  const user = t.withIdentity(identity(subject));
  await user.mutation(api.workspace.bootstrap, { name: 'Acme' });
  // Seeded directly: the production paths require HTTPS and a registry URL, and should keep doing so.
  await t.run(async (ctx) => {
    await ctx.db.insert('providerConfigs', {
      provider: 'linear',
      enabledUrls: [upstreamUrl],
      oauthClients: [{ clientId: 'test-client' }],
      updatedBy: 'platform-admin',
      updatedAt: 1,
    });
    const tools = [
      { name: 'get_issue', mode: 'read' as const },
      {
        name: 'update_issue',
        mode: 'write' as const,
        resourceArgument: 'id',
        correction: {
          readTool: 'get_issue',
          idArgument: 'id',
          versionField: 'version',
          expectedVersionArgument: 'expectedVersion',
          fields: ['title', 'state'],
        },
      },
      // Reviewed as a write first, then blocked below: an employee can hold a grant an
      // administrator later withdraws, and the gateway must stop honouring it.
      { name: 'delete_issue', mode: 'write' as const },
    ];
    for (const tool of tools)
      await ctx.db.insert('registryTools', {
        provider: 'linear',
        ...tool,
        description: `${tool.name} on the fake server`,
        updatedBy: 'platform-admin',
        updatedAt: 1,
      });
    const workspace = await ctx.db.query('workspaces').first();
    if (!workspace) throw new Error('Expected a workspace');
    connectionId = await ctx.db.insert('connections', {
      workspaceId: workspace._id,
      ownerSubject: subject,
      ownerName: subject,
      visibility: 'private',
      visibleToSubjects: [],
      provider: 'linear',
      name: 'Fake issues',
      account: 'acme',
      status: 'connected',
      tools: capability,
      allowedTools: capability,
      resourceScope: '',
      inboxResources: [],
      inboxMode: 'unsupported',
      serverUrl: upstreamUrl,
      credentialCiphertext: seal({
        oauth: {
          nonce: 'nonce',
          subject,
          provider: 'linear',
          name: 'Fake issues',
          serverUrl: upstreamUrl,
          createdAt: 1,
          tokens: { access_token: upstreamToken, token_type: 'Bearer' },
        },
      }),
      credentialKeyVersion: 'v1',
      createdAt: 1,
    });
  });
  const { versionId } = await publishEmployee(t, {
    capabilities: [{ provider: 'linear', tools: capability, optional: false }],
  });
  const { employeeId } = await user.mutation(api.marketplace.hire, { versionId });
  await t.run(async (ctx) => {
    const rows = await ctx.db.query('registryTools').collect();
    const blocked = rows.find((tool) => tool.name === 'delete_issue');
    if (blocked) await ctx.db.patch(blocked._id, { mode: 'blocked' });
  });
  const created = await user.mutation(api.tasks.create, {
    employeeId,
    title: 'Rename ISSUE-1',
    prompt: 'Rename ISSUE-1 and close it.',
  });
  taskId = created.taskId;
  const [start] = await t.mutation(api.services.queue.claimJobs, {
    secret,
    workerId: 'worker-1',
    limit: 1,
  });
  await t.mutation(api.services.queue.completeJob, {
    secret,
    jobId: start.id,
    leaseToken: start.leaseToken,
  });
  runToken = String((await t.run(async (ctx) => ctx.db.get(created.taskId)))?.runToken);

  gateway = createGateway({ backend: testBackend(t) }).listen(0, '127.0.0.1');
  await once(gateway, 'listening');
  gatewayUrl = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`;
  client = await mcpClient(`${gatewayUrl}/mcp/${encodeURIComponent(connectionId)}`, runToken);
});

afterAll(async () => {
  await client?.close().catch(() => {});
  gateway?.close();
  fake?.server.close();
});

it('exposes only the reviewed tools inside the capability', async () => {
  const { tools } = await client.listTools();
  expect(tools.map((tool) => tool.name).sort()).toEqual(['get_issue', 'update_issue']);
  expect(tools.find((tool) => tool.name === 'update_issue')?.description).toContain('human approval');
});

it('journals a read with its duration', async () => {
  const result = await client.callTool({ name: 'get_issue', arguments: { id: 'ISSUE-1' } });
  expect(result.isError).toBeFalsy();
  expect(result.structuredContent).toMatchObject({ id: 'ISSUE-1', version: 1, title: 'Original title' });
  const reads = (await toolCalls()).filter((call) => call.tool === 'get_issue');
  expect(reads.map((call) => call.outcome).sort()).toEqual(['started', 'succeeded']);
  const succeeded = reads.find((call) => call.outcome === 'succeeded');
  expect(succeeded?.durationMs).toBeGreaterThanOrEqual(0);
  expect(unseal(succeeded!.argumentsCiphertext)).toEqual({ id: 'ISSUE-1' });
});

it('refuses a blocked tool and journals the denial', async () => {
  const result = await client.callTool({ name: 'delete_issue', arguments: { id: 'ISSUE-1' } });
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toMatchObject({
    code: -32003,
    reason: 'policy_denied',
    retryable: false,
  });
  const denied = (await toolCalls()).find((call) => call.tool === 'delete_issue');
  expect(denied).toMatchObject({ outcome: 'denied', reason: 'policy_denied' });
  expect(fake.issues.has('ISSUE-1')).toBe(true);
});

it('turns a write into a pending proposal with the record captured', async () => {
  const result = await client.callTool({
    name: 'update_issue',
    arguments: { id: 'ISSUE-1', title: 'Renamed', state: 'closed' },
  });
  expect(result.isError).toBeFalsy();
  const content = result.structuredContent as Record<string, unknown>;
  expect(content).toMatchObject({ code: -32005, reason: 'approval_required', status: 'pending' });
  expect(String(content.instruction)).toContain('does not mean the external action succeeded');
  firstProposalId = String(content.proposalId);
  expect(await proposal(firstProposalId)).toMatchObject({
    status: 'pending',
    beforeState: JSON.stringify({ id: 'ISSUE-1', state: 'open', title: 'Original title', version: 1 }),
  });
  // The proposal is not the action: the provider still holds the original record.
  expect(fake.issues.get('ISSUE-1')).toMatchObject({ version: 1, title: 'Original title' });
});

it('rejects an unknown run token with a JSON-RPC unauthorized error', async () => {
  const response = await fetch(`${gatewayUrl}/mcp/${encodeURIComponent(connectionId)}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: 'Bearer stale-run-token',
      'x-request-id': 'probe-1',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  expect(response.status).toBe(401);
  expect(response.headers.get('x-request-id')).toBe('probe-1');
  expect(await response.json()).toMatchObject({
    error: { code: -32001, data: { reason: 'unauthorized', requestId: 'probe-1' } },
  });
});

it('rejects a malformed body', async () => {
  const response = await fetch(`${gatewayUrl}/mcp/${encodeURIComponent(connectionId)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${runToken}` },
    body: '{not json',
  });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({
    error: { code: -32700, data: { reason: 'malformed_request' } },
  });
});

it('executes the approved write against the provider', async () => {
  await approveAndRun(firstProposalId);
  expect(fake.issues.get('ISSUE-1')).toMatchObject({ version: 2, title: 'Renamed', state: 'closed' });
  expect(await proposal(firstProposalId)).toMatchObject({
    status: 'succeeded',
    afterState: JSON.stringify({ id: 'ISSUE-1', state: 'closed', title: 'Renamed', version: 2 }),
  });
  const write = (await toolCalls()).filter((call) => call.tool === 'update_issue');
  expect(write.map((call) => call.outcome).sort()).toEqual(['started', 'succeeded']);
  expect(unseal(write[0].argumentsCiphertext)).toEqual({
    id: 'ISSUE-1',
    title: 'Renamed',
    state: 'closed',
    expectedVersion: 1,
  });
});

it('restores the record through a correction and refuses a second one', async () => {
  const user = t.withIdentity(identity(subject));
  const correction = await user.mutation(api.actions.requestCorrection, {
    proposalId: firstProposalId as never,
  });
  if (correction.kind !== 'proposal') throw new Error('Expected an automatic correction proposal');
  await approveAndRun(correction.proposalId);
  expect(fake.issues.get('ISSUE-1')).toMatchObject({ version: 3, title: 'Original title', state: 'open' });
  expect(await proposal(correction.proposalId)).toMatchObject({ status: 'succeeded' });
  expect(await proposal(firstProposalId)).toMatchObject({ status: 'corrected' });
  await expect(
    user.mutation(api.actions.requestCorrection, { proposalId: firstProposalId as never }),
  ).rejects.toThrow(/successful action/);
});

it('fails a correction whose record moved on instead of leaving it uncertain', async () => {
  const write = await client.callTool({
    name: 'update_issue',
    arguments: { id: 'ISSUE-1', title: 'Second rename', state: 'closed' },
  });
  const secondId = String((write.structuredContent as Record<string, unknown>).proposalId);
  await approveAndRun(secondId);
  expect(fake.issues.get('ISSUE-1')).toMatchObject({ version: 4, title: 'Second rename' });
  const user = t.withIdentity(identity(subject));
  const correction = await user.mutation(api.actions.requestCorrection, { proposalId: secondId as never });
  if (correction.kind !== 'proposal') throw new Error('Expected an automatic correction proposal');
  // Somebody else edits the record between approval and execution.
  const current = fake.issues.get('ISSUE-1')!;
  fake.issues.set('ISSUE-1', { ...current, version: 9, title: 'Edited by someone else' });
  await approveAndRun(correction.proposalId);
  expect(await proposal(correction.proposalId)).toMatchObject({
    status: 'failed',
    result: expect.stringContaining('no longer applies'),
  });
  expect(fake.issues.get('ISSUE-1')).toMatchObject({ version: 9, title: 'Edited by someone else' });
});

it('shows the whole operation in the audit timeline', async () => {
  const timeline = await t.query(api.services.actions.auditTimeline, {
    secret,
    taskId: taskId as never,
    authSubject: subject,
  });
  expect(timeline.toolCalls.some((call) => call.tool === 'get_issue' && call.outcome === 'succeeded')).toBe(
    true,
  );
  expect(
    timeline.toolCalls.some((call) => call.outcome === 'denied' && call.reason === 'policy_denied'),
  ).toBe(true);
  const original = timeline.proposals.find((entry) => entry.id === firstProposalId);
  expect(original?.transitions.map((transition) => transition.to)).toEqual([
    'pending',
    'approved',
    'executing',
    'succeeded',
    'corrected',
  ]);
  expect(timeline.proposals.filter((entry) => entry.summary.startsWith('Correct:'))).toHaveLength(2);
  expect(
    timeline.toolCalls.some(
      (call) => call.operationId.startsWith('precondition:') && call.outcome === 'succeeded',
    ),
  ).toBe(true);
});
