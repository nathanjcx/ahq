import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { approvedMcpUrl, safeFetch } from './network';
import { oauthProvider, type StoredCredential } from './oauth';
import { unseal, seal } from './secrets';
import { mutate } from './backend';
export interface PrivateConnection {
  id: string;
  provider: string;
  serverUrl: string;
  allowedTools: string[];
  resourceScope: string;
  credentialCiphertext: string;
  credentialKeyVersion?: string;
  status: string;
}
export async function withMcp<T>(
  connection: Pick<PrivateConnection, 'provider' | 'serverUrl'>,
  credential: StoredCredential,
  run: (client: Client) => Promise<T>,
  onRefresh?: (value: StoredCredential) => Promise<void>,
): Promise<T> {
  const url = approvedMcpUrl(connection.provider, connection.serverUrl);
  const client = new Client({ name: 'astra-hq', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(url, {
    fetch: safeFetch,
    requestInit: credential.accessToken
      ? { headers: { Authorization: `Bearer ${credential.accessToken}` } }
      : undefined,
    authProvider: credential.oauth
      ? oauthProvider(credential.oauth, async (state) => {
          await onRefresh?.({ oauth: state });
        })
      : undefined,
  });
  try {
    await client.connect(transport);
    return await run(client);
  } finally {
    await client.close().catch(() => {});
  }
}
export async function discoverTools(
  connection: Pick<PrivateConnection, 'provider' | 'serverUrl'>,
  credential: StoredCredential,
): Promise<Tool[]> {
  return withMcp(connection, credential, async (client) => {
    const tools: Tool[] = [];
    let cursor: string | undefined;
    const cursors = new Set<string>();
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined);
      tools.push(...page.tools);
      cursor = page.nextCursor;
      if (cursor) {
        if (cursors.has(cursor) || cursors.size >= 50) throw new Error('MCP tool pagination did not finish');
        cursors.add(cursor);
      }
      if (tools.length > 2000) throw new Error('MCP server returned too many tools');
    } while (cursor);
    return tools;
  });
}
export async function connectedMcp<T>(
  connection: PrivateConnection,
  run: (client: Client) => Promise<T>,
): Promise<T> {
  if (connection.status !== 'connected') throw new Error('Integration is no longer connected');
  const credentials = unseal<StoredCredential>(connection.credentialCiphertext);
  return withMcp(connection, credentials, run, async (refreshed) => {
    await mutate('services:refreshCredential', {
      connectionId: connection.id,
      credentialCiphertext: seal(refreshed),
    });
  });
}
