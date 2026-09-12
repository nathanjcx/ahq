import { describe, expect, it } from 'vitest';
import { api } from '../convex/_generated/api';
import { configureProvider, githubUrl, harness, identity, secret, type Harness } from './support';

async function connect(t: Harness, subject: string, tools: string[]) {
  return t.mutation(api.services.integrations.connectIntegration, {
    secret,
    authSubject: subject,
    provider: 'github',
    name: 'GitHub',
    account: 'GitHub',
    ownerName: subject,
    tools,
    serverUrl: githubUrl,
    credentialCiphertext: 'encrypted-token',
    credentialKeyVersion: 'v1',
  });
}

async function githubWorkspace(t: Harness) {
  await configureProvider(t, {
    provider: 'github',
    enabledUrls: [githubUrl],
    oauthClients: [{ clientId: 'github-client' }],
    tools: [
      { name: 'issue_read', mode: 'read' },
      { name: 'create_issue', mode: 'write' },
      { name: 'delete_repo', mode: 'blocked' },
    ],
  });
}

describe('integration grants and inbox routing', () => {
  it('grants only reviewed, unblocked tools and refuses a server with none', async () => {
    const t = harness();
    await githubWorkspace(t);
    await t.withIdentity(identity('user-a')).mutation(api.workspace.bootstrap, { name: 'Acme' });
    await expect(connect(t, 'user-a', ['unreviewed_tool'])).rejects.toThrow('reviewed tool registry');
    await connect(t, 'user-a', ['issue_read', 'create_issue', 'delete_repo', 'unreviewed_tool']);
    const dashboard = await t.withIdentity(identity('user-a')).query(api.workspace.dashboard, {});
    expect(dashboard.connections[0].allowedTools).toEqual(['issue_read', 'create_issue']);
    expect(dashboard.connections[0].tools).toEqual(['issue_read', 'create_issue']);
    expect(dashboard.connections[0]).toMatchObject({
      isOwner: true,
      visibility: 'private',
      ownerName: 'user-a',
    });
    const readiness = await t.withIdentity(identity('user-a')).query(api.integrations.readiness, {});
    expect(readiness.find((entry) => entry.provider === 'github')).toEqual({
      provider: 'github',
      enabledUrls: [githubUrl],
      oauthUrls: [githubUrl],
      reviewedTools: 2,
      inboxConfigured: false,
    });
  });

  it('keeps a narrowed tool list when the owner reconnects', async () => {
    const t = harness();
    await githubWorkspace(t);
    const a = t.withIdentity(identity('user-a'));
    await a.mutation(api.workspace.bootstrap, { name: 'Acme' });
    const { connectionId } = await connect(t, 'user-a', ['issue_read', 'create_issue']);
    await a.mutation(api.integrations.updateAccess, {
      connectionId,
      allowedTools: ['issue_read'],
      resourceScope: '',
      inboxResources: '',
    });
    const again = await connect(t, 'user-a', ['issue_read', 'create_issue']);
    expect(again.connectionId).toBe(connectionId);
    const [connection] = (await a.query(api.workspace.dashboard, {})).connections;
    expect(connection.allowedTools).toEqual(['issue_read']);
    expect(connection.tools).toEqual(['issue_read', 'create_issue']);
  });

  it('delivers a provider event only to connections following that resource', async () => {
    const t = harness();
    await githubWorkspace(t);
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
    const first = await t.mutation(api.services.inbox.ingestInboxByResource, {
      secret,
      provider: 'github',
      resourceIds: ['123', 'acme/repo'],
      items: [item],
    });
    const again = await t.mutation(api.services.inbox.ingestInboxByResource, {
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

  it('shows a shared connection and its inbox to the members it names', async () => {
    const t = harness();
    await githubWorkspace(t);
    const owner = t.withIdentity(identity('owner', 'acme'));
    const colleague = t.withIdentity(identity('colleague', 'acme'));
    await owner.mutation(api.workspace.bootstrap, { name: 'Acme' });
    const { connectionId } = await t.mutation(api.services.integrations.connectIntegration, {
      secret,
      authSubject: 'owner',
      authOrgId: 'acme',
      provider: 'github',
      name: 'GitHub',
      account: 'GitHub',
      ownerName: 'Owner',
      tools: ['issue_read'],
      serverUrl: githubUrl,
      credentialCiphertext: 'encrypted-token',
      credentialKeyVersion: 'v1',
    });
    await t.mutation(api.services.inbox.ingestInbox, {
      secret,
      connectionId,
      items: [{ externalId: 'issue-1', title: 'New issue', preview: 'Review it.', createdAt: 1 }],
    });
    expect((await colleague.query(api.workspace.dashboard, {})).connections).toEqual([]);
    expect((await colleague.query(api.workspace.dashboard, {})).inbox).toEqual([]);
    await expect(
      colleague.mutation(api.integrations.setSharing, {
        connectionId,
        visibility: 'workspace',
        visibleToSubjects: [],
      }),
    ).rejects.toThrow('Connection not found');
    await owner.mutation(api.integrations.setSharing, {
      connectionId,
      visibility: 'members',
      visibleToSubjects: ['colleague', 'colleague'],
    });
    const shared = await colleague.query(api.workspace.dashboard, {});
    expect(shared.connections[0]).toMatchObject({
      id: connectionId,
      isOwner: false,
      visibility: 'members',
      visibleToSubjects: ['colleague'],
    });
    expect(shared.inbox).toHaveLength(1);
  });
});
