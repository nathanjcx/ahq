import type { ProviderId, RegistryTool } from '@/lib/contracts';

export type RegistryByProvider = ReadonlyMap<ProviderId, RegistryTool[]>;

/** The flat registry grouped by provider, which is how the studio reasons about capabilities. */
export function groupRegistryTools(tools: RegistryTool[]): RegistryByProvider {
  const grouped = new Map<ProviderId, RegistryTool[]>();
  for (const tool of tools) {
    const existing = grouped.get(tool.provider);
    if (existing) existing.push(tool);
    else grouped.set(tool.provider, [tool]);
  }
  return grouped;
}
