import { describe, expect, it } from 'vitest';
import { createHmac, randomBytes } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import { seal, unseal } from '../lib/server/secrets';
import { publicAddress, approvedMcpUrl } from '../lib/server/network';
import { toolPolicy, checkResourceScope, canonical } from '../lib/server/tool-policy';
import { verifyInboxSignature, inboxPayload } from '../lib/server/inbox-events';
import { sessionConfiguration, sessionUsage } from '../lib/server/agents';
import type { TaskContext, ToolPolicy } from '../services/types';
import { initialTaskInput } from '../services/task-input';

const policies: ToolPolicy[] = [
  { provider: 'github', name: 'get_me', mode: 'read' },
  { provider: 'github', name: 'create_issue', mode: 'write' },
  { provider: 'github', name: 'delete_repository', mode: 'blocked' },
];

describe('credential and integration boundaries', () => {
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
    task: { id: 'task1', model: 'gpt-5.6-terra', prompt: 'Review the pipeline.' },
    project: { id: 'project1', name: 'Growth', brief: 'A user-authored project brief.' },
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
  expect(config.agent?.instructions).not.toContain(context.project!.brief);
  expect(initialTaskInput(context)).toContain(context.project!.brief);
  expect(initialTaskInput(context)).toContain(context.task.prompt);
  expect(initialTaskInput({ task: context.task })).toBe(context.task.prompt);
  expect(config.input).toBeUndefined();
  expect(config.agent?.multi_agent?.enabled).toBe(false);
  expect(config.agent?.tools).toHaveLength(1);
  expect(config.agent?.tools?.[0]).toMatchObject({ allowed_tools: ['get_me'], connection_origin: 'service' });
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
