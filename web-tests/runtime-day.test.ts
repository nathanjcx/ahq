import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server as UpstreamServer } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type OpenAI from 'openai';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { api, internal } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import { internalServerTools, serversFor } from '../lib/server/agents';
import { installBackend, type Backend } from '../lib/server/backend';
import { seal } from '../lib/server/secrets';
import { createGateway } from '../services/gateway/create';
import type { Job, TaskContext } from '../services/types';
import { runJob } from '../services/worker/jobs';
import { createRuntime, type WorkerRuntime } from '../services/worker/state';
import { installTurnRunner, type TurnRunner } from '../services/worker/turns';
import { type Harness, harness, hireOne, identity, publishEmployee, secret, testBackend } from './support';

// The fake provider runs on loopback HTTP, which every production network rule rejects.
process.env.ALLOW_INSECURE_MCP_FOR_TESTS = '1';
process.env.CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString('base64');
process.env.APP_URL = 'https://app.example';
process.env.MAX_TURN_SECONDS = '60';

const subject = 'day-owner';
const upstreamToken = 'day-upstream-token';
const providerTools = ['get_pull_request', 'create_pull_request', 'merge_pull_request'];

/** A Wednesday inside working hours in UTC, so the default nine-to-six schedule is open. */
const WEDNESDAY_10 = Date.parse('2026-09-16T10:00:00.000Z');
const WEDNESDAY_22 = Date.parse('2026-09-16T22:00:00.000Z');
const THURSDAY_10 = Date.parse('2026-09-17T10:00:00.000Z');
const DAY_ONE = '2026-09-16';

interface ToolCall {
  server: string;
  tool: string;
  args: Record<string, unknown>;
}

/** A scripted turn: what the agent would do with its tools, and what it would finally say. */
type Script = (turn: {
  job: Job;
  context: TaskContext;
  input: string;
  call: (server: string, tool: string, args?: Record<string, unknown>) => Promise<unknown>;
  list: (server: string) => Promise<string[]>;
}) => Promise<string>;

function fakeProvider() {
  const calls: ToolCall[] = [];
  const record = (value: object) => ({
    structuredContent: value as Record<string, unknown>,
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
  });
  const build = () => {
    const mcp = new UpstreamServer({ name: 'fake-forge', version: '1.0.0' }, { capabilities: { tools: {} } });
    mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: providerTools.map((name) => ({
        name,
        description: `${name} on the fake forge.`,
        inputSchema: { type: 'object' as const, properties: {}, additionalProperties: true },
      })),
    }));
    mcp.setRequestHandler(CallToolRequestSchema, async (call) => {
      calls.push({ server: 'forge', tool: call.params.name, args: call.params.arguments ?? {} });
      if (call.params.name === 'create_pull_request') return record({ number: 41, state: 'open' });
      if (call.params.name === 'merge_pull_request') return record({ number: 41, merged: true });
      return record({ number: 41, state: 'open', version: 1 });
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
  return { server, calls };
}

let t: Harness;
let gateway: Server;
let gatewayUrl = '';
let provider: ReturnType<typeof fakeProvider>;
let runtime: WorkerRuntime;
let backend: Backend;

/** One script per job kind; a scenario sets the ones its jobs will hit. */
const scripts = new Map<string, Script>();
/** Every turn input the runner saw, so a scenario can assert what reached the model. */
const inputs: { kind: string; text: string }[] = [];

async function mcpClient(server: string, runToken: string) {
  const client = new Client({ name: 'scripted-agent', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${gatewayUrl}/mcp/${server}`), {
      requestInit: { headers: { Authorization: `Bearer ${runToken}` } },
    }),
  );
  return client;
}

/**
 * The scripted turn runner.
 *
 * The OpenAI client is not reachable from a test, so this stands in for it: it drives the gateway's
 * own MCP endpoints with the run token exactly as an agent's session would, which is what makes the
 * assertions below about Convex effects meaningful rather than mocked.
 */
const scriptedRunner: TurnRunner = {
  async run(_runtime, request) {
    inputs.push({ kind: request.job.kind, text: request.input });
    const script = scripts.get(request.job.kind);
    const call = async (server: string, tool: string, args: Record<string, unknown> = {}) => {
      const client = await mcpClient(server, request.context.runToken);
      try {
        const result = await client.callTool({ name: tool, arguments: args });
        if (result.isError)
          throw new Error(`${server}.${tool} refused: ${JSON.stringify(result.structuredContent)}`);
        return result.structuredContent;
      } finally {
        await client.close().catch(() => {});
      }
    };
    const list = async (server: string) => {
      const client = await mcpClient(server, request.context.runToken);
      try {
        return (await client.listTools()).tools.map((tool) => tool.name);
      } finally {
        await client.close().catch(() => {});
      }
    };
    const text = script
      ? await script({ job: request.job, context: request.context, input: request.input, call, list })
      : '';
    return { text, status: 'completed', usage: { input: 1_200, cached: 0, output: 300 } };
  },
};

const INPUT_KINDS = ['start_task', 'send_message', 'cancel_task'];

/**
 * Every internal server a session advertises is served by the gateway with exactly those tools.
 * The two lists are declared separately — `lib/server/agents.ts` for the session, the server modules
 * for the gateway — and a session that names a tool the gateway does not serve would fail on the
 * first call rather than at startup, so the agreement is asserted here for whatever role is running.
 */
async function assertAdvertisedToolsExist(context: TaskContext) {
  for (const server of serversFor(context.employee.kind, context.task.kind)) {
    if (server === 'floor' && !context.floor) continue;
    const client = await mcpClient(server, context.runToken);
    try {
      const served = (await client.listTools()).tools.map((tool) => tool.name);
      for (const tool of internalServerTools(server)) expect(served).toContain(tool);
    } finally {
      await client.close().catch(() => {});
    }
  }
}

/** Runs the scheduler, then runs every job of the given kinds the way the worker would. */
async function runQueue(kinds: string[]) {
  await t.mutation(internal.services.schedule.tick, {});
  const ran: Job[] = [];
  const skipped = new Set<string>();
  for (let pass = 0; pass < 12; pass++) {
    const claimed = await t.mutation(api.services.queue.claimJobs, {
      secret,
      workerId: 'day-worker',
      limit: 8,
    });
    if (!claimed.length || claimed.every((job) => skipped.has(String(job.id)))) break;
    for (const job of claimed) {
      const asJob = {
        id: job.id,
        kind: job.kind,
        taskId: String(job.taskId),
        payload: (job.payload ?? {}) as Record<string, unknown>,
        leaseToken: job.leaseToken,
        attempts: job.attempts,
      } as Job;
      // A task's own first message is not a turn and has no model here, so it is simply retired;
      // the queue leases one job per task, and a turn behind it would never be reached otherwise.
      if (INPUT_KINDS.includes(job.kind)) {
        await t.mutation(api.services.queue.completeJob, {
          secret,
          jobId: job.id,
          leaseToken: job.leaseToken,
        });
        continue;
      }
      if (!kinds.includes(job.kind)) {
        // Released rather than completed: a turn this scenario is not driving belongs to a later one.
        await t.run(async (ctx) =>
          ctx.db.patch(job.id, {
            state: 'queued',
            leaseOwner: undefined,
            leaseToken: undefined,
            leaseExpiresAt: undefined,
          }),
        );
        skipped.add(String(job.id));
        continue;
      }
      await runJob(runtime, asJob);
      const state = await t.run(async (ctx) => (await ctx.db.get(job.id))?.state);
      if (state !== 'completed')
        throw new Error(
          `${job.kind} did not complete: ${String(await t.run(async (ctx) => (await ctx.db.get(job.id))?.error))}`,
        );
      ran.push(asJob);
    }
  }
  return ran;
}

const rows = <T>(table: string) =>
  t.run(async (ctx) => ctx.db.query(table as 'reports').collect()) as Promise<T[]>;

async function posts() {
  return t.run(async (ctx) => ctx.db.query('posts').collect());
}

let workspaceId = '';
let floorId = '' as Id<'floors'>;
let employeeId = '' as Id<'installations'>;
let secondEmployeeId = '' as Id<'installations'>;
let dailyTaskId = '' as Id<'tasks'>;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(WEDNESDAY_10);
  provider = fakeProvider();
  provider.server.listen(0, '127.0.0.1');
  await once(provider.server, 'listening');
  const upstreamUrl = `http://127.0.0.1:${(provider.server.address() as AddressInfo).port}/mcp`;

  t = harness();
  backend = testBackend(t);
  installBackend(backend);
  installTurnRunner(scriptedRunner);
  const user = t.withIdentity(identity(subject));
  await user.mutation(api.workspace.bootstrap, { name: 'Acme' });

  await t.run(async (ctx) => {
    await ctx.db.insert('providerConfigs', {
      provider: 'github',
      enabledUrls: [upstreamUrl],
      oauthClients: [{ clientId: 'test-client' }],
      updatedBy: 'platform-admin',
      updatedAt: 1,
    });
    for (const tool of providerTools)
      await ctx.db.insert('registryTools', {
        provider: 'github',
        name: tool,
        description: `${tool} on the fake forge`,
        mode: tool === 'get_pull_request' ? 'read' : 'write',
        updatedBy: 'platform-admin',
        updatedAt: 1,
      });
    const workspace = await ctx.db.query('workspaces').first();
    if (!workspace) throw new Error('Expected a workspace');
    workspaceId = workspace._id;
    await ctx.db.insert('connections', {
      workspaceId: workspace._id,
      ownerSubject: subject,
      ownerName: subject,
      visibility: 'workspace',
      visibleToSubjects: [],
      provider: 'github',
      name: 'Fake forge',
      account: 'acme',
      status: 'connected',
      tools: providerTools,
      allowedTools: providerTools,
      resourceScope: '',
      inboxResources: [],
      inboxMode: 'unsupported',
      serverUrl: upstreamUrl,
      credentialCiphertext: seal({
        oauth: {
          nonce: 'nonce',
          subject,
          provider: 'github',
          name: 'Fake forge',
          serverUrl: upstreamUrl,
          createdAt: 1,
          tokens: { access_token: upstreamToken, token_type: 'Bearer' },
        },
      }),
      credentialKeyVersion: 'v1',
      createdAt: 1,
    });
  });

  // Two versions rather than two hires of one: hiring the same version twice returns the instance.
  employeeId = (await hireOne(user, (await publishEmployee(t, { name: 'Builder' })).listingId)).employeeId;
  secondEmployeeId = (await hireOne(user, (await publishEmployee(t, { name: 'Writer' })).listingId))
    .employeeId;
  floorId = (
    await user.mutation(api.floors.create, {
      name: 'Platform',
      brief: 'The floor that owns the runtime.',
      employeeIds: [employeeId, secondEmployeeId],
    })
  ).floorId;

  // The schedule the day is paced against: nine to six UTC, with triage allowed to open a pull
  // request unattended and to merge one only under the emergency rule.
  await user.mutation(api.schedule.updateSettings, {
    timezone: 'UTC',
    workingDays: [1, 2, 3, 4, 5],
    startHour: 9,
    endHour: 18,
    attendedStartHour: 9,
    attendedEndHour: 18,
    overnightPolicy: 'audits_only',
    dailyTokenCap: 0,
    triageAllowance: 0,
    memoryBudgets: { workspace: 2_000, project: 3_000, floor: 4_000, agent: 1_500, summaries: 1_500 },
    hiringPolicy: 'anyone',
    auditPolicy: 'soft',
    triageAllowList: ['create_pull_request'],
    emergencyAllowList: ['merge_pull_request'],
    notificationChannels: ['in_app'],
    plan: 'subscription',
    monthlyAllowance: 0,
    maxConcurrentInstances: 8,
    rates: [],
    standards: 'Every claim in a report names the file it changed.',
  });

  gateway = createGateway({ backend }).listen(0, '127.0.0.1');
  await once(gateway, 'listening');
  gatewayUrl = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`;
  process.env.MCP_GATEWAY_URL = gatewayUrl;
  runtime = createRuntime({} as OpenAI, () => true);
});

afterAll(async () => {
  installTurnRunner(undefined);
  gateway?.close();
  provider?.server.close();
  vi.useRealTimers();
});

it('runs a daily shift that files its report into the record and the channel', async () => {
  const user = t.withIdentity(identity(subject));
  dailyTaskId = (
    await user.mutation(api.tasks.create, {
      employeeId,
      floorId,
      title: 'Ship the gateway',
      prompt: 'Serve the internal tool servers behind the run token.',
      cadence: 'daily',
      deadlineAt: THURSDAY_10 + 86_400_000,
    })
  ).taskId;

  scripts.set('start_shift', async ({ call, context }) => {
    await assertAdvertisedToolsExist(context);
    await call('memory', 'remember', {
      scope: 'self',
      kind: 'decision',
      text: 'The gateway enforces the role, not the session configuration.',
      tags: ['gateway'],
    });
    await call('shift', 'submit_report', {
      done: ['Served the six internal servers.'],
      inProgress: ['Role enforcement on every call.'],
      blockedOn: [],
      next: ['The triage allow-list.'],
      risks: ['The emergency path needs a delivered page to be meaningful.'],
      deadlineConfidence: 0.9,
    });
    return 'Shift finished; report filed.';
  });

  const ran = await runQueue(['start_shift']);
  expect(ran.map((job) => job.kind)).toContain('start_shift');

  const reports = await rows<{ taskId: string; inferred: boolean; deadlineConfidence?: number }>('reports');
  const report = reports.find((row) => row.taskId === dailyTaskId);
  expect(report).toMatchObject({ inferred: false, deadlineConfidence: 0.9 });
  const shifts = await rows<{ taskId: string; kind: string; endedAt?: number }>('shifts');
  expect(shifts.find((row) => row.taskId === dailyTaskId)).toMatchObject({
    kind: 'work',
    endedAt: expect.any(Number),
  });
  expect(
    (await posts()).some(
      (post) => post.kind === 'report' && post.text.includes('Served the six internal servers.'),
    ),
  ).toBe(true);
  // The claim the shift filed is its own notebook, so it is active at once.
  const memories = await rows<{ scope: string; status: string; text: string }>('memories');
  expect(memories.find((row) => row.text.includes('enforces the role'))).toMatchObject({
    scope: 'agent',
    status: 'active',
  });
});

it('infers the report when a shift ends without filing one', async () => {
  const user = t.withIdentity(identity(subject));
  const { taskId } = await user.mutation(api.tasks.create, {
    employeeId: secondEmployeeId,
    floorId,
    title: 'Write the operations guide',
    prompt: 'Document how the runtime is operated.',
    cadence: 'daily',
  });
  scripts.set('start_shift', async () => 'I drafted the deployment section and stopped there.');
  await runQueue(['start_shift']);
  const reports = await rows<{ taskId: string; inferred: boolean; done: string[] }>('reports');
  const inferred = reports.find((row) => row.taskId === taskId);
  expect(inferred?.inferred).toBe(true);
  expect(inferred?.done).toEqual(['I drafted the deployment section and stopped there.']);
  scripts.delete('start_shift');
});

it('runs a waiting task’s review shift, which posts feedback and files no report', async () => {
  const user = t.withIdentity(identity(subject));
  const { taskId } = await user.mutation(api.tasks.create, {
    employeeId: secondEmployeeId,
    floorId,
    title: 'Document the tool servers',
    prompt: 'Write the reference once the gateway lands.',
    cadence: 'daily',
    dependsOn: [dailyTaskId],
  });
  expect(await t.run(async (ctx) => (await ctx.db.get(taskId))?.status)).toBe('waiting');

  let sawDependencyReport = false;
  scripts.set('review_shift', async ({ input, call }) => {
    sawDependencyReport = input.includes('Served the six internal servers.');
    await call('floor', 'floor_post', {
      text: 'The six servers read well; I cannot document the triage allow-list until its shape settles.',
    });
    return 'Reviewed the dependency and posted feedback.';
  });
  await runQueue(['review_shift']);

  expect(sawDependencyReport).toBe(true);
  const shifts = await rows<{ taskId: string; kind: string; reportId?: string; endedAt?: number }>('shifts');
  const review = shifts.find((row) => row.taskId === taskId && row.kind === 'review');
  expect(review).toMatchObject({ endedAt: expect.any(Number) });
  expect(review?.reportId).toBeUndefined();
  expect((await posts()).some((post) => post.text.includes('cannot document the triage allow-list'))).toBe(
    true,
  );
  scripts.delete('review_shift');
});

it('prepares, answers, and wraps up a meeting with a confirmable outcome', async () => {
  const user = t.withIdentity(identity(subject));
  const { entryId } = await user.mutation(api.calendar.createMeeting, {
    title: 'Runtime review',
    startsAt: WEDNESDAY_10 + 40 * 60_000,
    endsAt: WEDNESDAY_10 + 70 * 60_000,
    floorId,
    attendees: [
      { kind: 'employee', id: employeeId, name: 'Builder' },
      { kind: 'employee', id: secondEmployeeId, name: 'Builder 2' },
    ],
    agenda: ['Where the gateway stands', 'What the documentation still needs'],
    purpose: 'Decide whether the runtime is ready for the audit night.',
  });

  scripts.set('meeting_prep', async ({ context }) => `${context.employee.name}: the gateway is serving.`);
  await runQueue(['meeting_prep']);
  const meeting = await t.run(async (ctx) =>
    ctx.db
      .query('meetings')
      .filter((q) => q.eq(q.field('calendarEntryId'), entryId))
      .unique(),
  );
  if (!meeting) throw new Error('Expected a meeting');
  expect(meeting.status).toBe('ready');

  await user.mutation(api.meetings.open, { meetingId: meeting._id });
  scripts.set('meeting_answer', async ({ input }) =>
    input.includes('addressed to you')
      ? 'Role enforcement is in the gateway and re-checked per call.'
      : 'Nothing to add.',
  );
  const addressed = await user.mutation(api.meetings.ask, {
    meetingId: meeting._id,
    text: 'Where is the role enforced?',
    addressedTo: [employeeId],
  });
  await runQueue(['meeting_answer']);
  const everyone = await user.mutation(api.meetings.ask, {
    meetingId: meeting._id,
    text: 'Anything blocking the audit night?',
  });
  await runQueue(['meeting_answer']);

  const turns = await t.run(async (ctx) =>
    ctx.db
      .query('meetingTurns')
      .filter((q) => q.eq(q.field('meetingId'), meeting._id))
      .collect(),
  );
  const answers = turns.filter((turn) => turn.kind === 'answer');
  expect(answers.filter((turn) => turn.inReplyTo === addressed.turnId)).toHaveLength(1);
  expect(answers.filter((turn) => turn.inReplyTo === everyone.turnId)).toHaveLength(2);
  expect(answers.some((turn) => turn.text.includes('re-checked per call'))).toBe(true);

  scripts.set('meeting_wrapup', async ({ context }) =>
    JSON.stringify({
      outcomes: [
        {
          kind: 'deadline',
          payload: JSON.stringify({
            kind: 'deadline',
            taskId: dailyTaskId,
            deadlineAt: THURSDAY_10 + 3 * 86_400_000,
          }),
          text: `${context.employee.name} asks for two more days on the gateway.`,
        },
      ],
    }),
  );
  await user.mutation(api.meetings.close, { meetingId: meeting._id });
  await runQueue(['meeting_wrapup']);
  await user.mutation(api.meetings.finalize, { meetingId: meeting._id });

  const outcome = (
    await t.run(async (ctx) =>
      ctx.db
        .query('meetingTurns')
        .filter((q) => q.eq(q.field('meetingId'), meeting._id))
        .collect(),
    )
  ).find((turn) => turn.kind === 'outcome');
  expect(outcome?.outcome?.status).toBe('proposed');
  await user.mutation(api.meetings.confirmOutcome, { turnId: outcome!._id });
  expect(await t.run(async (ctx) => (await ctx.db.get(dailyTaskId))?.deadlineAt)).toBe(
    THURSDAY_10 + 3 * 86_400_000,
  );
  for (const kind of ['meeting_prep', 'meeting_answer', 'meeting_wrapup']) scripts.delete(kind);
});

it('runs a curation turn that merges two overlapping claims', async () => {
  const claims = await t.run(async (ctx) => {
    const ids = [];
    for (const text of [
      'Deployments go out on Thursday afternoons.',
      'The release train leaves Thursday after lunch.',
    ])
      ids.push(
        await ctx.db.insert('memories', {
          workspaceId: workspaceId as Id<'workspaces'>,
          scope: 'floor',
          scopeId: String(floorId),
          kind: 'procedure',
          text,
          tags: ['release'],
          author: 'agent',
          authorName: 'Builder',
          confidence: 0.7,
          status: 'active',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }),
      );
    return ids;
  });

  scripts.set('curation_run', async ({ call, context }) => {
    await assertAdvertisedToolsExist(context);
    await call('janitor', 'read_memory');
    await call('janitor', 'merge', {
      ids: claims,
      text: 'Releases go out on Thursday afternoon.',
      kind: 'procedure',
      tags: ['release'],
    });
    return 'Merged two claims that said the same thing.';
  });
  vi.setSystemTime(WEDNESDAY_22);
  await runQueue(['curation_run']);

  const memories = await rows<{ _id: string; status: string; text: string; author: string }>('memories');
  expect(memories.find((row) => row.text === 'Releases go out on Thursday afternoon.')).toMatchObject({
    status: 'active',
    author: 'janitor',
  });
  for (const id of claims)
    expect(memories.find((row) => row._id === id)).toMatchObject({ status: 'archived' });
  scripts.delete('curation_run');
});

it('runs the audit night and delivers its finding at the next shift start', async () => {
  scripts.set('audit_run', async ({ context, call }) => {
    await assertAdvertisedToolsExist(context);
    const read = (await call('audit', 'read_reports', { date: DAY_ONE })) as {
      standards: string;
      work: string;
    };
    expect(read.standards).toContain('names the file it changed');
    expect(read.work).toContain('Untrusted context');
    await call('audit', 'read_journal', { taskId: dailyTaskId });
    await call('audit', 'submit_findings', {
      date: DAY_ONE,
      findings: [
        {
          employeeId,
          taskId: dailyTaskId,
          severity: 'medium',
          claim: 'The report claims six servers but names no file.',
          evidence: 'The journal for this task shows no artifact and no file in any message.',
          requiredAction: 'Name the files the six servers live in, or withdraw the claim.',
        },
      ],
    });
    expect(context.employee.kind).toBe('auditor');
    return 'One finding filed.';
  });
  vi.setSystemTime(WEDNESDAY_22 + 30 * 60_000);
  await runQueue(['audit_run', 'curation_run']);

  const findings = await rows<{ _id: string; status: string; claim: string; employeeId: string }>(
    'auditFindings',
  );
  expect(findings).toHaveLength(1);
  expect(findings[0]).toMatchObject({ status: 'open', employeeId });
  expect((await posts()).some((post) => post.kind === 'finding' && post.text.includes('names no file'))).toBe(
    true,
  );

  // The next working day opens with the finding, above the task's own brief.
  inputs.length = 0;
  scripts.set('start_shift', async ({ call }) => {
    await call('shift', 'submit_report', {
      done: [`Named the files for ${findings[0]._id}.`],
      inProgress: [],
      blockedOn: [],
      next: [],
      risks: [],
      deadlineConfidence: 0.9,
    });
    return 'Cleared the finding first.';
  });
  vi.setSystemTime(THURSDAY_10);
  await runQueue(['start_shift']);

  const shiftInput = inputs.find((entry) => entry.kind === 'start_shift');
  expect(shiftInput?.text).toContain('Open findings (clear these before any other work)');
  expect(shiftInput!.text.indexOf('Open findings')).toBeLessThan(
    shiftInput!.text.indexOf('Shift 2026-09-17'),
  );
  expect(shiftInput?.text).toContain('names no file');
  expect((await rows<{ status: string }>('auditFindings')).every((row) => row.status !== 'open')).toBe(true);
  scripts.delete('audit_run');
  scripts.delete('start_shift');
});

it('lets a triage turn open a pull request under the allow-list and nothing more', async () => {
  const alert = await t.mutation(api.services.triage.ingest, {
    secret,
    workspaceId: workspaceId as Id<'workspaces'>,
    source: 'webhook',
    fingerprint: 'uptime:checkout',
    severity: 'critical',
    title: 'Checkout is returning 500s',
    detail: 'The checkout endpoint has failed every probe for six minutes.',
    affectedFloorIds: [floorId],
  });
  scripts.set('triage_run', async ({ call, list }) => {
    const tools = await list('triage');
    expect(tools).toContain('create_pull_request');
    // Attended hours, so the emergency list stays shut even though the tool is granted.
    expect(tools).not.toContain('merge_pull_request');
    await call('triage', 'report_reproduction', {
      text: 'Reproduced: checkout 500s on any cart with a discount code.',
    });
    const opened = (await call('triage', 'create_pull_request', {
      title: 'Guard the discount lookup',
      head: 'fix/discount',
      base: 'main',
    })) as { executed: boolean; emergency: boolean };
    expect(opened).toMatchObject({ executed: true, emergency: false });
    await expect(call('triage', 'merge_pull_request', { number: 41 })).rejects.toThrow(/policy_denied/);
    await call('triage', 'resolve_alert', {
      cause: 'The discount lookup was not guarded against a missing code.',
      fix: 'Guarded it and returned an empty discount.',
      prevention: 'Guard every optional lookup on the checkout path.',
      regressionRef: 'checkout.discount.missing-code',
    });
    return 'Pull request open, post-mortem filed.';
  });
  await runQueue(['triage_run']);

  expect(provider.calls.map((call) => call.tool)).toEqual(['create_pull_request']);
  // An allow-listed triage write executes; it never becomes a proposal a person has to decide.
  expect(await rows<{ tool: string }>('proposals')).toHaveLength(0);
  const calls = await rows<{ tool: string; outcome: string }>('toolCalls');
  expect(
    calls
      .filter((row) => row.tool === 'create_pull_request')
      .map((row) => row.outcome)
      .sort(),
  ).toEqual(['started', 'succeeded']);
  expect(calls.some((row) => row.tool === 'merge_pull_request' && row.outcome === 'denied')).toBe(true);
  expect(
    (await rows<{ _id: string; status: string }>('alerts')).find((row) => row._id === alert.alertId)?.status,
  ).toBe('fixed');
  scripts.delete('triage_run');
});

/** The notifications this workspace has recorded for one alert, oldest first. */
async function ledger(alertId: string) {
  return (
    await t.run(async (ctx) =>
      ctx.db
        .query('notifications')
        .filter((q) => q.eq(q.field('alertId'), alertId))
        .collect(),
    )
  ).sort((a, b) => a.sentAt - b.sentAt);
}

function triageAuthority(runToken: string) {
  return t.query(api.services.triage.authority, { secret, runToken });
}

async function runTokenFor(taskId: string) {
  return String(await t.run(async (ctx) => (await ctx.db.get(taskId as Id<'tasks'>))?.runToken));
}

it('re-pages an unanswered incident on the scheduler’s own clock until three attempts stand', async () => {
  // Outside attended hours, so only the notification ledger stands between the incident and a merge.
  const firstPageAt = WEDNESDAY_22 + 2 * 3_600_000;
  vi.setSystemTime(firstPageAt);
  const alert = await t.mutation(api.services.triage.ingest, {
    secret,
    workspaceId: workspaceId as Id<'workspaces'>,
    source: 'webhook',
    fingerprint: 'uptime:payments',
    severity: 'critical',
    title: 'Payments are down',
    detail: 'Every charge has failed for eleven minutes.',
  });
  if (!alert.taskId) throw new Error('Expected a triage task');
  const runToken = await runTokenFor(String(alert.taskId));

  // The tick sends the first page, and the worker is what delivers it.
  await runQueue(['page_alert']);
  expect((await ledger(alert.alertId)).map((row) => [row.attempt, row.deliveredChannel])).toEqual([
    [1, 'in_app'],
  ]);
  // Nothing pages again inside the re-page interval.
  vi.setSystemTime(firstPageAt + 5 * 60_000);
  await runQueue(['page_alert']);
  expect(await ledger(alert.alertId)).toHaveLength(1);
  vi.setSystemTime(firstPageAt + 8 * 60_000);
  await runQueue(['page_alert']);
  vi.setSystemTime(firstPageAt + 16 * 60_000);
  await runQueue(['page_alert']);
  expect((await ledger(alert.alertId)).map((row) => row.attempt)).toEqual([1, 2, 3]);
  // Three is the whole ledger; a fourth tick adds nothing.
  vi.setSystemTime(firstPageAt + 24 * 60_000);
  await runQueue(['page_alert']);
  expect(await ledger(alert.alertId)).toHaveLength(3);

  // The gate waits for the first attempt to be twenty minutes old, not merely for three attempts.
  vi.setSystemTime(firstPageAt + 16 * 60_000);
  expect(await triageAuthority(runToken)).toMatchObject({ unattendedAttempts: 3, emergency: false });
  vi.setSystemTime(firstPageAt + 24 * 60_000);
  expect(await triageAuthority(runToken)).toMatchObject({ unattendedAttempts: 3, emergency: true });

  // Inside attended hours the same ledger opens nothing.
  vi.setSystemTime(THURSDAY_10);
  expect(await triageAuthority(runToken)).toMatchObject({ attended: true, emergency: false });
  // And nobody is paged while a person is expected to be watching.
  await runQueue(['page_alert']);
  expect(await ledger(alert.alertId)).toHaveLength(3);

  // An acknowledgement spends every page sent before it and shuts the gate again.
  vi.setSystemTime(firstPageAt + 30 * 60_000);
  await t.mutation(api.services.notifications.acknowledgeForSubject, {
    secret,
    subject,
    id: (await ledger(alert.alertId))[0]._id,
  });
  expect(await triageAuthority(runToken)).toMatchObject({ unattendedAttempts: 0, emergency: false });
  // An answered incident is not paged again: a person is on it.
  await runQueue(['page_alert']);
  expect((await ledger(alert.alertId)).map((row) => row.attempt)).toEqual([1, 2, 3]);
  // The incident leaves the board, so later scenarios plan their own alerts and nothing else.
  await t.withIdentity(identity(subject)).mutation(api.triage.dismiss, { alertId: alert.alertId });
});

it('merges under the emergency rule and files the incident report the rule requires', async () => {
  const openedAt = THURSDAY_10 + 12 * 3_600_000;
  vi.setSystemTime(openedAt);
  const alert = await t.mutation(api.services.triage.ingest, {
    secret,
    workspaceId: workspaceId as Id<'workspaces'>,
    source: 'webhook',
    fingerprint: 'uptime:checkout-total',
    severity: 'critical',
    title: 'Order totals are wrong',
    detail: 'Every order since the deploy is short by the discount.',
  });
  if (!alert.taskId) throw new Error('Expected a triage task');
  const runToken = await runTokenFor(String(alert.taskId));
  for (let page = 0; page < 3; page++) {
    vi.setSystemTime(openedAt + page * 8 * 60_000);
    await runQueue(['page_alert']);
  }
  vi.setSystemTime(openedAt + 25 * 60_000);
  expect(await triageAuthority(runToken)).toMatchObject({ emergency: true });

  scripts.set('triage_run', async ({ call, list, input, job }) => {
    // A settled incident from an earlier scenario may still have a run queued; this one is ours.
    if (job.payload.alertId !== alert.alertId) return 'Not this incident.';
    expect(input).toContain('the emergency allow-list is open');
    expect(await list('triage')).toContain('merge_pull_request');
    const merged = (await call('triage', 'merge_pull_request', { number: 41 })) as {
      emergency: boolean;
      instruction?: string;
    };
    expect(merged).toMatchObject({ executed: true, emergency: true });
    expect(merged.instruction).toContain('file_incident_report');
    await call('triage', 'file_incident_report', {
      issue: 'Totals were short by the discount after the deploy.',
      reproduction: 'Any order with a discount code since 21:40.',
      fix: 'Reverted the discount change and merged the revert.',
      reason: 'Three pages went unanswered and money was being lost on every order.',
      sideEffects: 'The discount feature is off until the change is reworked.',
      risks: 'Orders placed in the window are still wrong and need a backfill.',
    });
    return 'Merged the revert under the emergency rule and filed the report.';
  });
  await runQueue(['triage_run']);

  const reports = await t.withIdentity(identity(subject)).query(api.triage.incidentReports, {});
  const filed = reports.find((report) => report.alertId === alert.alertId);
  expect(filed).toMatchObject({ emergency: true, missing: false });
  expect(filed?.text).toContain('Why it acted without permission');
  expect(
    (await posts()).find((post) => post.flag === 'incident' && post.taskId === alert.taskId),
  ).toBeTruthy();
  await t.withIdentity(identity(subject)).mutation(api.triage.dismiss, { alertId: alert.alertId });
  scripts.delete('triage_run');
});

it('files the missing report itself and escalates when an emergency run writes none', async () => {
  const openedAt = THURSDAY_10 + 14 * 3_600_000;
  vi.setSystemTime(openedAt);
  const alert = await t.mutation(api.services.triage.ingest, {
    secret,
    workspaceId: workspaceId as Id<'workspaces'>,
    source: 'webhook',
    fingerprint: 'uptime:sessions',
    severity: 'critical',
    title: 'Sessions are dropping',
    detail: 'Every signed-in request has failed for four minutes.',
  });
  if (!alert.taskId) throw new Error('Expected a triage task');
  for (let page = 0; page < 3; page++) {
    vi.setSystemTime(openedAt + page * 8 * 60_000);
    await runQueue(['page_alert']);
  }
  vi.setSystemTime(openedAt + 25 * 60_000);

  scripts.set('triage_run', async ({ call, job }) => {
    if (job.payload.alertId !== alert.alertId) return 'Not this incident.';
    await call('triage', 'merge_pull_request', { number: 41 });
    return 'Merged and said nothing about it.';
  });
  await runQueue(['triage_run']);

  const placeholder = (
    await t.withIdentity(identity(subject)).query(api.triage.incidentReports, {})
  ).find(
    (report) => report.alertId === alert.alertId,
  );
  expect(placeholder).toMatchObject({ emergency: true, missing: true });
  expect(placeholder?.text).toContain('filed no incident report');
  const escalation = (await posts()).find(
    (post) => post.kind === 'system' && post.text.startsWith('Escalation:'),
  );
  expect(escalation?.text).toContain('filed no incident report');
  await t.withIdentity(identity(subject)).mutation(api.triage.dismiss, { alertId: alert.alertId });
  scripts.delete('triage_run');
});

it('refuses a worker token the audit server and an auditor token a provider write', async () => {
  const workerToken = String(await t.run(async (ctx) => (await ctx.db.get(dailyTaskId))?.runToken));
  const response = await fetch(`${gatewayUrl}/mcp/audit`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${workerToken}`,
      'x-request-id': 'role-1',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({
    error: { code: -32003, data: { reason: 'policy_denied', requestId: 'role-1' } },
  });

  // The auditor's own token reaches no connection at all, so a provider write is not addressable.
  const auditTask = (await t.run(async (ctx) => ctx.db.query('tasks').collect())).find(
    (task) => task.kind === 'audit',
  );
  if (!auditTask) throw new Error('Expected the audit task');
  const context = await t.query(api.services.actions.gatewayContext, {
    secret,
    runToken: auditTask.runToken,
  });
  expect(context.employee.kind).toBe('auditor');
  expect(context.connections).toHaveLength(0);
  const refused = await mcpClient('triage', auditTask.runToken).then(
    () => undefined,
    (error: Error) => error.message,
  );
  expect(refused).toContain('policy_denied');
});
