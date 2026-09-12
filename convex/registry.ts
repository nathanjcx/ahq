import type { Doc } from './_generated/dataModel';
import type { DbCtx } from './shared';
import type { ProviderConfig, ProviderId, ProviderReadiness, RegistryTool } from '../lib/contracts';
import type { ToolPolicy } from '../services/types';

export const providerIds: ProviderId[] = ['linear', 'slack', 'github', 'google-workspace', 'canva'];

export async function providerConfigFor(ctx: DbCtx, provider: ProviderId) {
  return ctx.db
    .query('providerConfigs')
    .withIndex('by_provider', (q) => q.eq('provider', provider))
    .unique();
}

export async function registryToolsFor(ctx: DbCtx, provider: ProviderId) {
  return ctx.db
    .query('registryTools')
    .withIndex('by_provider', (q) => q.eq('provider', provider))
    .collect();
}

export async function enabledServerUrls(ctx: DbCtx, provider: ProviderId) {
  return (await providerConfigFor(ctx, provider))?.enabledUrls ?? [];
}

export async function assertApprovedServerUrl(ctx: DbCtx, provider: ProviderId, serverUrl: string) {
  let url: URL;
  try {
    url = new URL(serverUrl);
  } catch {
    throw new Error('Invalid MCP server URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('MCP server URL must use HTTPS without embedded credentials');
  const enabled = await enabledServerUrls(ctx, provider);
  if (!enabled.includes(url.toString()) && !enabled.includes(serverUrl))
    throw new Error('This MCP server is not enabled by your administrator');
}

/** Tools a connection may receive: everything discovered that the registry reviewed and did not block. */
export async function grantableTools(ctx: DbCtx, provider: ProviderId, discovered: string[]) {
  const reviewed = new Set(
    (await registryToolsFor(ctx, provider))
      .filter((tool) => tool.mode !== 'blocked')
      .map((tool) => tool.name),
  );
  return discovered.filter((name) => reviewed.has(name));
}

export function toolPolicyOf(row: Doc<'registryTools'>): ToolPolicy {
  return {
    provider: row.provider,
    name: row.name,
    mode: row.mode,
    ...(row.resourceArgument ? { resourceArgument: row.resourceArgument } : {}),
    ...(row.correction ? { correction: row.correction } : {}),
  };
}

export async function policiesFor(ctx: DbCtx, providers: ProviderId[]): Promise<ToolPolicy[]> {
  const policies: ToolPolicy[] = [];
  for (const provider of [...new Set(providers)]) {
    policies.push(...(await registryToolsFor(ctx, provider)).map(toolPolicyOf));
  }
  return policies;
}

export function registryTool(row: Doc<'registryTools'>): RegistryTool {
  return {
    provider: row.provider,
    name: row.name,
    description: row.description,
    mode: row.mode,
    ...(row.resourceArgument ? { resourceArgument: row.resourceArgument } : {}),
    ...(row.correction ? { correction: row.correction } : {}),
    ...(row.annotations ? { annotations: row.annotations } : {}),
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
}

function oauthUrls(config: Doc<'providerConfigs'> | null) {
  if (!config) return [];
  if (config.oauthClients.some((client) => !client.serverUrl)) return [...config.enabledUrls];
  const configured = new Set(config.oauthClients.map((client) => client.serverUrl));
  return config.enabledUrls.filter((url) => configured.has(url));
}

export function providerConfig(provider: ProviderId, config: Doc<'providerConfigs'> | null): ProviderConfig {
  return {
    provider,
    enabledUrls: config?.enabledUrls ?? [],
    oauthClients: (config?.oauthClients ?? []).map((client) => ({
      ...(client.serverUrl ? { serverUrl: client.serverUrl } : {}),
      clientId: client.clientId,
      hasClientSecret: Boolean(client.clientSecretCiphertext),
      ...(client.scopes ? { scopes: client.scopes } : {}),
      ...(client.authorizationUrl ? { authorizationUrl: client.authorizationUrl } : {}),
      ...(client.tokenUrl ? { tokenUrl: client.tokenUrl } : {}),
      ...(client.tokenAuthMethod ? { tokenAuthMethod: client.tokenAuthMethod } : {}),
    })),
    hasInboxSecret: Boolean(config?.inboxSecretCiphertext),
    ...(config ? { updatedAt: config.updatedAt, updatedBy: config.updatedBy } : {}),
  };
}

/** What the Integrations page needs to explain readiness, derived entirely from the configuration tables. */
export async function providerReadiness(ctx: DbCtx): Promise<ProviderReadiness[]> {
  const readiness: ProviderReadiness[] = [];
  for (const provider of providerIds) {
    const config = await providerConfigFor(ctx, provider);
    const tools = await registryToolsFor(ctx, provider);
    readiness.push({
      provider,
      enabledUrls: config?.enabledUrls ?? [],
      oauthUrls: oauthUrls(config),
      reviewedTools: tools.filter((tool) => tool.mode !== 'blocked').length,
      inboxConfigured: Boolean(config?.inboxSecretCiphertext),
    });
  }
  return readiness;
}

const destructive = /(^|[._-])(?:delete|purge|destroy|remove)(?:[._-]|$)/i;

export function isDestructiveName(name: string) {
  return destructive.test(name.replace(/([a-z0-9])([A-Z])/g, '$1_$2'));
}

/** Guards the one table that grants tools to agents. Annotations are hints and never validated as grants. */
export function validateRegistryTool(input: {
  name: string;
  description: string;
  mode: 'read' | 'write' | 'blocked';
  resourceArgument?: string;
  correction?: {
    readTool: string;
    idArgument: string;
    versionField: string;
    expectedVersionArgument: string;
    fields: string[];
  };
}) {
  const name = input.name.trim();
  if (!name || name.length > 200) throw new Error('Tool name is required and limited to 200 characters');
  const description = input.description.trim();
  if (description.length > 2_000) throw new Error('Tool description is too long');
  if (input.mode === 'read' && isDestructiveName(name))
    throw new Error('A destructive tool name cannot be saved as read-only');
  if (input.resourceArgument !== undefined && !input.resourceArgument.trim())
    throw new Error('Resource argument cannot be blank');
  if (input.correction) {
    const { readTool, idArgument, versionField, expectedVersionArgument, fields } = input.correction;
    if (![readTool, idArgument, versionField, expectedVersionArgument].every((value) => value.trim()))
      throw new Error('Every correction descriptor field is required');
    if (!fields.length || fields.some((field) => !field.trim()))
      throw new Error('Correction fields must be non-empty');
  }
  return { name, description };
}
