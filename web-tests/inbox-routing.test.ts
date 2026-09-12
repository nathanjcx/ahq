import { beforeEach, describe, expect, it } from 'vitest';
import { convexTest } from 'convex-test';
import { api } from '../convex/_generated/api';
import schema from '../convex/schema';

const modules = import.meta.glob('../convex/**/*.ts');
const secret = 'service-test-secret';
const identity = (subject: string) => ({ subject, tokenIdentifier: `test|${subject}`, issuer: 'test' });

async function connect(t: ReturnType<typeof convexTest>, subject: string, tools: string[]) {
  return t.mutation(api.services.connectIntegration, {
    secret,
    authSubject: subject,
    provider: 'github',
    name: 'GitHub',
    account: 'GitHub',
    tools,
    serverUrl: 'https://api.githubcopilot.com/mcp/',
    credentialCiphertext: 'encrypted-token',
    credentialKeyVersion: 'v1',
  });
}

describe('integration grants and inbox routing', () => {
  beforeEach(() => {
    process.env.AHQ_SERVICE_SECRET = secret;
    process.env.MCP_SERVER_URLS_JSON = JSON.stringify({ github: ['https://api.githubcopilot.com/mcp/'] });
    process.env.MCP_TOOL_REGISTRY_JSON = JSON.stringify({
      github: [
        { name: 'issue_read', description: 'Read an issue', mode: 'read' },
        { name: 'create_issue', description: 'Create an issue', mode: 'write' },
        { name: 'delete_repo', description: 'Delete', mode: 'blocked' },
      ],
    });
  });

  it('grants only reviewed, unblocked tools and refuses a server with none', async () => {
    const t = convexTest(schema, modules);
    await t.withIdentity(identity('user-a')).mutation(api.workspace.bootstrap, { name: 'Acme' });
    await expect(connect(t, 'user-a', ['unreviewed_tool'])).rejects.toThrow('reviewed tool registry');
    await connect(t, 'user-a', ['issue_read', 'create_issue', 'delete_repo', 'unreviewed_tool']);
    const dashboard = await t.withIdentity(identity('user-a')).query(api.workspace.dashboard, {});
    expect(dashboard.connections[0].allowedTools).toEqual(['issue_read', 'create_issue']);
    expect(dashboard.connections[0].tools).toEqual(['issue_read', 'create_issue']);
    const readiness = await t.withIdentity(identity('user-a')).query(api.integrations.readiness, {});
    expect(readiness.find((entry) => entry.provider === 'github')).toEqual({
      provider: 'github',
      enabledUrls: ['https://api.githubcopilot.com/mcp/'],
      reviewedTools: 2,
    });
  });

  it('delivers a provider event only to connections following that resource', async () => {
    const t = convexTest(schema, modules);
    const a = t.withIdentity(identity('user-a'));
    const b = t.withIdentity(identity('user-b'));
    await a.mutation(api.workspace.bootstrap, { name: 'Acme' });
    await b.mutation(api.workspace.bootstrap, { name: 'Beta' });
    const { connectionId } = await connect(t, 'user-a', ['issue_read']);
    await connect(t, 'user-b', ['issue_read']);
    await a.mutation(api.integrations.updateAccess, {
      connectionId,
      allowedTools: ['issue_read'],
      resourceScope: '',
      inboxResources: 'acme/repo, acme/other',
    });
    await expect(
      a.mutation(api.integrations.updateAccess, {
        connectionId,
        allowedTools: ['delete_repo'],
        resourceScope: '',
        inboxResources: '',
      }),
    ).rejects.toThrow('not available');
    const item = { externalId: 'github:1', title: 'Issue opened', preview: 'Body', createdAt: 1 };
    const first = await t.mutation(api.services.ingestInboxByResource, {
      secret,
      provider: 'github',
      resourceIds: ['123', 'acme/repo'],
      items: [item],
    });
    const again = await t.mutation(api.services.ingestInboxByResource, {
      secret,
      provider: 'github',
      resourceIds: ['123', 'acme/repo'],
      items: [item],
    });
    expect(first).toEqual({ delivered: 1 });
    expect(again).toEqual({ delivered: 0 });
    expect((await a.query(api.workspace.dashboard, {})).inbox).toHaveLength(1);
    expect((await b.query(api.workspace.dashboard, {})).inbox).toHaveLength(0);
    expect((await a.query(api.workspace.dashboard, {})).connections[0].inboxMode).toBe('push');
  });
});
