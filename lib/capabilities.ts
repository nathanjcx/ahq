type Capability = { provider: string; tools: string[] };
type Connection = { provider: string; status: string; allowedTools: string[] };

/**
 * A capability is met when the connected integrations of its provider together grant every tool.
 * A provider with several servers (Google Workspace) spreads its tools over several connections.
 */
export function capabilityGranted(capability: Capability, connections: Connection[]) {
  const granted = new Set(
    connections
      .filter(
        (connection) => connection.provider === capability.provider && connection.status === 'connected',
      )
      .flatMap((connection) => connection.allowedTools),
  );
  return capability.tools.every((tool) => granted.has(tool));
}
