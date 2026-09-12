import { describe, expect, it } from 'vitest';
import { api } from '../convex/_generated/api';
import { adminIdentity, connectLinear, harness, identity, linearUrl, secret } from './support';

describe('operational configuration in Convex', () => {
  it('admits only registered server URLs and reports readiness from the tables', async () => {
    const t = harness();
    const admin = t.withIdentity(adminIdentity);
    await t.withIdentity(identity('user-a')).mutation(api.workspace.bootstrap, { name: 'Acme' });

    await expect(
      admin.mutation(api.admin.setEnabledUrls, {
        provider: 'linear',
        enabledUrls: ['https://mcp.linear.example/'],
      }),
    ).rejects.toThrow('is not a registered linear MCP server');
    await expect(
      t
        .withIdentity(identity('user-a'))
        .mutation(api.admin.setEnabledUrls, { provider: 'linear', enabledUrls: [linearUrl] }),
    ).rejects.toThrow('Platform administrator');
    await admin.mutation(api.admin.setEnabledUrls, { provider: 'linear', enabledUrls: [linearUrl] });

    const notReady = await t.withIdentity(identity('user-a')).query(api.integrations.readiness, {});
    expect(notReady.find((entry) => entry.provider === 'linear')).toEqual({
      provider: 'linear',
      enabledUrls: [linearUrl],
      oauthUrls: [],
      reviewedTools: 0,
      inboxConfigured: false,
    });

    await admin.mutation(api.admin.saveRegistryTool, {
      provider: 'linear',
      name: ' get_issue ',
      description: 'Read one issue',
      mode: 'read',
    });
    await t.mutation(api.services.config.setOAuthClient, {
      secret,
      actorSubject: 'platform-admin',
      provider: 'linear',
      clientId: 'linear-client',
      clientSecretCiphertext: 'sealed-secret',
    });
    await t.mutation(api.services.config.setInboxSecret, {
      secret,
      actorSubject: 'platform-admin',
      provider: 'linear',
      inboxSecretCiphertext: 'sealed-inbox-secret',
    });

    const ready = await t.withIdentity(identity('user-a')).query(api.integrations.readiness, {});
    expect(ready.find((entry) => entry.provider === 'linear')).toEqual({
      provider: 'linear',
      enabledUrls: [linearUrl],
      // The provider default OAuth client covers every enabled URL.
      oauthUrls: [linearUrl],
      reviewedTools: 1,
      inboxConfigured: true,
    });
    const configs = await admin.query(api.admin.providerConfigs, {});
    expect(configs.find((config) => config.provider === 'linear')).toMatchObject({
      enabledUrls: [linearUrl],
      oauthClients: [{ clientId: 'linear-client', hasClientSecret: true }],
      hasInboxSecret: true,
      updatedBy: 'platform-admin',
    });
    expect(JSON.stringify(configs)).not.toContain('sealed-secret');
    expect((await admin.query(api.admin.registryTools, {}))[0]).toMatchObject({
      name: 'get_issue',
      mode: 'read',
      updatedBy: 'platform-admin',
    });

    await t.mutation(api.services.config.setInboxSecret, {
      secret,
      actorSubject: 'platform-admin',
      provider: 'linear',
    });
    await t.mutation(api.services.config.removeOAuthClient, {
      secret,
      actorSubject: 'platform-admin',
      provider: 'linear',
    });
    const cleared = await t.withIdentity(identity('user-a')).query(api.integrations.readiness, {});
    expect(cleared.find((entry) => entry.provider === 'linear')).toMatchObject({
      oauthUrls: [],
      inboxConfigured: false,
    });
  });

  it('serves provider configuration and policies to the services', async () => {
    const t = harness();
    const admin = t.withIdentity(adminIdentity);
    await admin.mutation(api.admin.setEnabledUrls, { provider: 'linear', enabledUrls: [linearUrl] });
    await admin.mutation(api.admin.saveRegistryTool, {
      provider: 'linear',
      name: 'update_issue',
      description: 'Update one issue',
      mode: 'write',
      resourceArgument: 'teamId',
    });
    await admin.mutation(api.admin.saveRegistryTool, {
      provider: 'linear',
      name: 'delete_issue',
      description: 'Delete one issue',
      mode: 'blocked',
    });
    await t.mutation(api.services.config.setOAuthClient, {
      secret,
      actorSubject: 'platform-admin',
      provider: 'linear',
      serverUrl: linearUrl,
      clientId: 'linear-client',
      clientSecretCiphertext: 'sealed-secret',
      scopes: 'read write',
    });
    // An update without a new secret keeps the sealed one.
    await t.mutation(api.services.config.setOAuthClient, {
      secret,
      actorSubject: 'platform-admin',
      provider: 'linear',
      serverUrl: linearUrl,
      clientId: 'rotated-client',
    });

    await expect(t.query(api.services.config.providers, { secret: 'wrong' })).rejects.toThrow(
      'Unauthorized service request',
    );
    const configs = await t.query(api.services.config.providers, { secret });
    expect(configs.find((config) => config.provider === 'linear')).toEqual({
      provider: 'linear',
      enabledUrls: [linearUrl],
      oauthClients: [
        { serverUrl: linearUrl, clientId: 'rotated-client', clientSecretCiphertext: 'sealed-secret' },
      ],
      reviewedTools: 1,
    });
    expect(configs.find((config) => config.provider === 'slack')).toEqual({
      provider: 'slack',
      enabledUrls: [],
      oauthClients: [],
      reviewedTools: 0,
    });
    expect(await t.query(api.services.config.policies, { secret, providers: ['linear'] })).toEqual([
      { provider: 'linear', name: 'update_issue', mode: 'write', resourceArgument: 'teamId' },
      { provider: 'linear', name: 'delete_issue', mode: 'blocked' },
    ]);
  });

  it('keeps a destructive tool name out of the read mode and validates descriptors', async () => {
    const t = harness();
    const admin = t.withIdentity(adminIdentity);
    for (const name of ['delete_repository', 'deleteRepository', 'bulk_purge_records', 'remove-issue'])
      await expect(
        admin.mutation(api.admin.saveRegistryTool, {
          provider: 'github',
          name,
          description: 'Looks harmless.',
          mode: 'read',
        }),
      ).rejects.toThrow('destructive tool name');
    await admin.mutation(api.admin.saveRegistryTool, {
      provider: 'github',
      name: 'delete_repository',
      description: 'Deletes a repository.',
      mode: 'blocked',
    });
    await expect(
      admin.mutation(api.admin.saveRegistryTool, {
        provider: 'github',
        name: 'create_issue',
        description: 'Creates an issue.',
        mode: 'write',
        correction: {
          readTool: 'issue_read',
          idArgument: ' ',
          versionField: 'version',
          expectedVersionArgument: 'expectedVersion',
          fields: ['title'],
        },
      }),
    ).rejects.toThrow('correction descriptor field is required');
    await admin.mutation(api.admin.saveRegistryTool, {
      provider: 'github',
      name: 'create_issue',
      description: 'Creates an issue.',
      mode: 'write',
      resourceArgument: 'repository',
    });
    expect(await admin.query(api.admin.registryTools, {})).toMatchObject([
      { name: 'create_issue', mode: 'write', resourceArgument: 'repository' },
      { name: 'delete_repository', mode: 'blocked' },
    ]);
    await admin.mutation(api.admin.deleteRegistryTool, { provider: 'github', name: 'create_issue' });
    expect(await admin.query(api.admin.registryTools, {})).toHaveLength(1);
  });

  it('imports discovered tools from an administrator connection as blocked entries', async () => {
    const t = harness();
    const admin = t.withIdentity(adminIdentity);
    await admin.mutation(api.workspace.bootstrap, { name: 'Platform' });
    await admin.mutation(api.admin.setEnabledUrls, { provider: 'linear', enabledUrls: [linearUrl] });
    await admin.mutation(api.admin.saveRegistryTool, {
      provider: 'linear',
      name: 'get_issue',
      description: 'Read one issue',
      mode: 'read',
    });
    const { connectionId } = await t.mutation(api.services.integrations.connectIntegration, {
      secret,
      authSubject: 'platform-admin',
      provider: 'linear',
      name: 'Linear',
      account: 'acme',
      ownerName: 'Platform admin',
      serverUrl: linearUrl,
      tools: ['get_issue', 'update_issue', 'delete_issue'],
      toolAnnotations: [{ name: 'delete_issue', destructiveHint: true }],
      credentialCiphertext: 'encrypted-token',
      credentialKeyVersion: 'v1',
    });
    expect(await admin.mutation(api.admin.importDiscoveredTools, { connectionId })).toEqual({ imported: 2 });
    expect(await admin.mutation(api.admin.importDiscoveredTools, { connectionId })).toEqual({ imported: 0 });
    const tools = await admin.query(api.admin.registryTools, {});
    expect(tools.map((tool) => `${tool.name}:${tool.mode}`)).toEqual([
      'delete_issue:blocked',
      'get_issue:read',
      'update_issue:blocked',
    ]);
    expect(tools.find((tool) => tool.name === 'delete_issue')?.annotations).toEqual({
      destructiveHint: true,
    });

    const other = t.withIdentity(identity('user-a'));
    await other.mutation(api.workspace.bootstrap, { name: 'Acme' });
    const foreign = await connectLinear(t, { subject: 'user-a', tools: ['get_issue'] });
    await expect(
      admin.mutation(api.admin.importDiscoveredTools, { connectionId: foreign.connectionId }),
    ).rejects.toThrow('Connection not found');
  });
});
