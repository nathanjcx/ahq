export const providerIds = ['linear', 'slack', 'github', 'google-workspace', 'canva'] as const;
export type ProviderId = (typeof providerIds)[number];
export type RegistryTool = { name: string; description: string; mode: 'read' | 'write' | 'blocked' };

function providerJson(name: string): Record<string, unknown> {
  let raw: unknown;
  try {
    raw = JSON.parse(process.env[name] || '{}');
  } catch {
    throw new Error(`${name} is invalid JSON`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error(`${name} must be an object keyed by provider`);
  for (const key of Object.keys(raw)) {
    if (!providerIds.includes(key as ProviderId)) throw new Error(`${name} has an unknown provider: ${key}`);
  }
  return raw as Record<string, unknown>;
}

/** Reviewed tools an administrator permits per provider. */
export function toolRegistry() {
  const source = providerJson('MCP_TOOL_REGISTRY_JSON');
  return providerIds.map((providerId) => {
    const value = source[providerId];
    if (value === undefined) return { provider: providerId, configured: false, tools: [] as RegistryTool[] };
    if (!Array.isArray(value)) throw new Error(`MCP_TOOL_REGISTRY_JSON.${providerId} must be an array`);
    if (value.length > 2_000) throw new Error(`MCP_TOOL_REGISTRY_JSON.${providerId} has too many tools`);
    const tools = value.map((item, index): RegistryTool => {
      if (!item || typeof item !== 'object' || Array.isArray(item))
        throw new Error(`MCP_TOOL_REGISTRY_JSON.${providerId}[${index}] is invalid`);
      const record = item as Record<string, unknown>;
      if (Object.keys(record).some((key) => key !== 'name' && key !== 'description' && key !== 'mode'))
        throw new Error(`MCP_TOOL_REGISTRY_JSON.${providerId}[${index}] has an unknown field`);
      if (
        typeof record.name !== 'string' ||
        !record.name.trim() ||
        record.name !== record.name.trim() ||
        record.name.length > 200
      )
        throw new Error(`MCP_TOOL_REGISTRY_JSON.${providerId}[${index}].name is invalid`);
      if (
        typeof record.description !== 'string' ||
        !record.description.trim() ||
        record.description !== record.description.trim() ||
        record.description.length > 2_000
      )
        throw new Error(`MCP_TOOL_REGISTRY_JSON.${providerId}[${index}].description is invalid`);
      if (record.mode !== 'read' && record.mode !== 'write' && record.mode !== 'blocked')
        throw new Error(`MCP_TOOL_REGISTRY_JSON.${providerId}[${index}].mode is invalid`);
      return { name: record.name, description: record.description, mode: record.mode };
    });
    if (new Set(tools.map((tool) => tool.name)).size !== tools.length)
      throw new Error(`MCP_TOOL_REGISTRY_JSON.${providerId} has duplicate tool names`);
    return { provider: providerId, configured: true, tools };
  });
}

/** Exact MCP server URLs an administrator admitted per provider. */
export function enabledServerUrls(providerId: string): string[] {
  const value = providerJson('MCP_SERVER_URLS_JSON')[providerId];
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((url) => typeof url !== 'string'))
    throw new Error(`MCP_SERVER_URLS_JSON.${providerId} must be an array of URLs`);
  return value;
}

export function assertApprovedServerUrl(providerId: string, serverUrl: string) {
  let url: URL;
  try {
    url = new URL(serverUrl);
  } catch {
    throw new Error('Invalid MCP server URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('MCP server URL must use HTTPS without embedded credentials');
  if (!enabledServerUrls(providerId).includes(url.toString()))
    throw new Error('This MCP server is not enabled by your administrator');
}

/** Tools a new connection receives: everything discovered that the registry reviewed and did not block. */
export function grantableTools(providerId: string, discovered: string[]): string[] {
  const entry = toolRegistry().find((item) => item.provider === providerId);
  const reviewed = new Set(entry?.tools.filter((tool) => tool.mode !== 'blocked').map((tool) => tool.name));
  return discovered.filter((name) => reviewed.has(name));
}

export type ProviderReadiness = {
  provider: ProviderId;
  enabledUrls: string[];
  reviewedTools: number;
};

/** Convex-side deployment state per provider. Web-side OAuth and webhook state is added by the web service. */
export function providerReadiness(): ProviderReadiness[] {
  const registry = new Map(toolRegistry().map((entry) => [entry.provider, entry]));
  return providerIds.map((provider) => ({
    provider,
    enabledUrls: enabledServerUrls(provider),
    reviewedTools: registry.get(provider)?.tools.filter((tool) => tool.mode !== 'blocked').length ?? 0,
  }));
}
