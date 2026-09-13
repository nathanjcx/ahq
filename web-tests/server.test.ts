import { createHmac, randomBytes } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { sessionConfiguration, sessionUsage } from '../lib/server/agents';
import { verifyInboxSignature, inboxPayload } from '../lib/server/inbox-events';
import { publicAddress, approvedMcpUrl } from '../lib/server/network';
import { credentialForServer } from '../lib/server/oauth';
import { seal, unseal } from '../lib/server/secrets';
import { toolPolicy, checkResourceScope, canonical } from '../lib/server/tool-policy';
import { initialTaskInput } from '../services/task-input';
import type { TaskContext, ToolPolicy } from '../services/types';

const policies: ToolPolicy[] = [
  { provider: 'github', name: 'get_me', mode: 'read' },
  { provider: 'github', name: 'create_issue', mode: 'write' },
  { provider: 'github', name: 'delete_repository', mode: 'blocked' },
];

describe('credential and integration boundaries', () => {
  it('addresses a reused grant to the next product server without the first server’s discovery', () => {
    const credential = {
      oauth: {
        nonce: 'n',
        subject: 'user',
        provider: 'google-workspace' as const,
        name: 'Google Workspace Gmail',
        serverUrl: 'https://gmailmcp.googleapis.com/mcp/v1',
        queue: ['https://drivemcp.googleapis.com/mcp/v1'],
        createdAt: 1,
        discovery: {
          resourceMetadataUrl: 'https://gmailmcp.googleapis.com/.well-known/oauth-protected-resource',
        },
        tokens: { access_token: 'a', token_type: 'bearer', refresh_token: 'r' },
      },
    };
    const drive = credentialForServer(
      credential,
      'https://drivemcp.googleapis.com/mcp/v1',
      'Google Workspace Drive',
    );
    expect(drive.oauth).toMatchObject({
      serverUrl: 'https://drivemcp.googleapis.com/mcp/v1',
      name: 'Google Workspace Drive',
      tokens: credential.oauth.tokens,
    });
    expect(drive.oauth).not.toHaveProperty('discovery');
    expect(drive.oauth).not.toHaveProperty('queue');
    expect(credential.oauth.discovery).toBeDefined();
  });

  it('encrypts secrets with authenticated randomized encryption', () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    const input = { accessToken: 'private-value' },
      encoded = seal(input);
    expect(encoded).not.toContain('private-value');
    expect(encoded).not.toBe(seal(input));
    expect(unseal(encoded)).toEqual(input);
    const parts = encoded.split('.');
    parts[1] = Buffer.alloc(16).toString('base64url');
    expect(() => unseal(parts.join('.'))).toThrow();
  });
  it('rejects local, metadata, mapped and reserved destinations', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '169.254.169.254',
      '192.168.1.2',
      '::1',
      '::ffff:127.0.0.1',
      'fc00::1',
      '100.64.0.1',
      '0.0.0.0',
    ])
      expect(publicAddress(address)).toBe(false);
    expect(publicAddress('8.8.8.8')).toBe(true);
    expect(() => approvedMcpUrl('slack', 'https://evil.example/mcp')).toThrow();
    expect(() => approvedMcpUrl('slack', 'http://mcp.slack.com/mcp')).toThrow();
    expect(approvedMcpUrl('slack', 'https://mcp.slack.com/mcp').hostname).toBe('mcp.slack.com');
  });
  it('grants only tools the administrator registered, and nothing else', () => {
    expect(toolPolicy(policies, 'github', 'get_me').mode).toBe('read');
    expect(toolPolicy(policies, 'github', 'create_issue').mode).toBe('write');
    expect(toolPolicy(policies, 'github', 'delete_repository').mode).toBe('blocked');
    expect(toolPolicy(policies, 'github', 'unknownOperation').mode).toBe('blocked');
    expect(toolPolicy(policies, 'linear', 'get_me').mode).toBe('blocked');
  });
  it('rejects searches and different resources on restricted grants', () => {
    expect(() => checkResourceScope('allowed', { query: 'everything' })).toThrow();
    expect(() => checkResourceScope('allowed', { id: 'denied' })).toThrow();
    expect(() =>
      checkResourceScope('allowed', { id: 'allowed' }, { mode: 'read', resourceArgument: 'id' }),
    ).not.toThrow();
  });
  it('signs timestamp and exact body and rejects stale or changed deliveries', () => {
    const body = '{"items":[]}',
      secret = 'test-secret',
      timestamp = '1800000000';
    const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
    expect(() => verifyInboxSignature(body, timestamp, signature, secret, 1800000000000)).not.toThrow();
    expect(() => verifyInboxSignature(body + ' ', timestamp, signature, secret, 1800000000000)).toThrow();
    expect(() => verifyInboxSignature(body, timestamp, signature, secret, 1800000900000)).toThrow();
    expect(() =>
      inboxPayload.parse({
        items: [
          { externalId: '1', title: 'title', preview: '', createdAt: 1, sourceUrl: 'javascript:alert(1)' },
        ],
      }),
    ).toThrow();
  });
});
it('canonicalizes nested arguments for action deduplication', () => {
  expect(canonical({ b: 2, a: { z: 1, c: [2, 1] } })).toBe(canonical({ a: { c: [2, 1], z: 1 }, b: 2 }));
});
it('builds an isolated hosted session with only the employee/tool grant intersection', () => {
  process.env.MCP_GATEWAY_URL = 'https://gateway.example';
  const context = {
    task: { id: 'task1', kind: 'work', model: 'gpt-5.6-terra', prompt: 'Review the pipeline.' },
    floor: { id: 'project1', name: 'Growth', brief: 'A user-authored floor brief.' },
    employee: { id: 'employee1', name: 'Analyst', kind: 'worker' },
    employeeVersion: {
      id: 'version1',
      instructions: 'Private instructions',
      skills: [{ name: 'Task notes', content: 'Private skill' }],
      capabilities: [{ provider: 'github', tools: ['get_me', 'create_issue'], optional: false }],
    },
    connections: [
      {
        id: 'connection1',
        provider: 'github',
        allowedTools: ['get_me', 'delete_repository'],
        status: 'connected',
      },
    ],
    policies,
    runToken: 'private-run-token',
  } as TaskContext;
  const config = sessionConfiguration(context);
  expect(config.agent?.instructions).not.toContain(context.floor!.brief);
  expect(initialTaskInput(context)).toContain(context.floor!.brief);
  expect(initialTaskInput(context)).toContain(context.task.prompt);
  expect(initialTaskInput({ task: context.task })).toBe(context.task.prompt);
  expect(config.input).toBeUndefined();
  expect(config.agent?.multi_agent?.enabled).toBe(false);
  // The provider grant, plus the three internal servers a worker's own task reaches.
  expect(config.agent?.tools).toHaveLength(4);
  expect(config.agent?.tools?.[0]).toMatchObject({ allowed_tools: ['get_me'], connection_origin: 'service' });
  expect(config.agent?.tools?.flatMap((tool) => ('server_label' in tool ? [tool.server_label] : []))).toEqual(
    ['github_connection1', 'astra_memory', 'astra_floor', 'astra_shift'],
  );
  expect(config.agent?.tools?.[2]).toMatchObject({
    server_label: 'astra_floor',
    allowed_tools: ['floor_post', 'floor_handoff'],
    required: false,
    transport: { server_url: 'https://gateway.example/mcp/floor' },
  });
  expect(config.agent?.instructions).toContain('never claim a handoff was accepted');
  expect(config.agent?.instructions).not.toContain('generate_image');
  expect(config.environment).not.toHaveProperty('packages');
  // A workshop adds the studio server with only the tools it names, installs its libraries, and
  // tells the employee what it can make.
  const studio = sessionConfiguration({
    ...context,
    employeeVersion: {
      ...context.employeeVersion,
      workshop: {
        tools: ['generate_image'],
        libraries: ['reportlab', 'pillow'],
        deliverables: ['pdf', 'image'],
      },
    },
  });
  expect(studio.agent?.tools?.flatMap((tool) => ('server_label' in tool ? [tool.server_label] : []))).toEqual(
    ['github_connection1', 'astra_memory', 'astra_floor', 'astra_shift', 'astra_studio'],
  );
  expect(studio.agent?.tools?.[4]).toMatchObject({ allowed_tools: ['generate_image'], required: false });
  expect(studio.environment).toMatchObject({ packages: { python: ['reportlab', 'pillow'] } });
  expect(studio.agent?.instructions).toContain('reportlab (PDF documents)');
  expect(studio.agent?.instructions).toContain('call generate_image');
  expect(
    sessionConfiguration({ ...context, floor: undefined }).agent?.tools?.some(
      (tool) => 'server_label' in tool && tool.server_label === 'astra_floor',
    ),
  ).toBe(false);
  if (config.environment.type !== 'openai_hosted') throw new Error('Expected hosted environment');
  expect(config.environment.network?.access).toBe('disabled');
  const archive = config.environment.plugins![0].source;
  const files = unzipSync(Buffer.from(archive.data, 'base64'));
  expect(strFromU8(files['employee/skills/skill-1/SKILL.md'])).toContain('Private skill');
  expect(Object.keys(files).some((name) => name.includes('mcp.json'))).toBe(false);
});
it('reports token usage without pricing it', () => {
  expect(
    sessionUsage({
      input_tokens: 1_000_000,
      output_tokens: 100_000,
      total_tokens: 1_100_000,
      input_tokens_details: { cached_tokens: 500_000 },
      output_tokens_details: { reasoning_tokens: 0 },
    }),
  ).toEqual({ input: 1_000_000, cached: 500_000, output: 100_000 });
});
