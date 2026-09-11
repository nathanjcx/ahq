import { createServer } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { query, mutate } from '../lib/server/backend';
import { connectedMcp } from '../lib/server/mcp';
import { safeError, requiredEnv } from '../lib/server/secrets';
import {
  checkResourceScope,
  toolPolicy,
  correctionPolicy,
  resultObject,
  canonical,
} from '../lib/server/tool-policy';
import { auditedRead } from '../lib/server/audit-mcp';
import type { TaskContext } from './types';
requiredEnv('AHQ_SERVICE_SECRET');
requiredEnv('CREDENTIAL_ENCRYPTION_KEY');
const server = createServer(async (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"status":"ok","service":"mcp-gateway"}');
    return;
  }
  try {
    const match = /^\/mcp\/([a-zA-Z0-9_-]+)$/.exec((req.url || '').split('?')[0]);
    if (!match) {
      res.writeHead(404);
      res.end();
      return;
    }
    const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
    if (!token) {
      res.writeHead(401);
      res.end();
      return;
    }
    const context = await query<TaskContext | null>('services:gatewayContext', { runToken: token });
    const connection = context?.connections.find((c) => c.id === match[1]);
    if (!context || !connection) {
      res.writeHead(403);
      res.end();
      return;
    }
    const capability = context.employeeVersion.capabilities.find((c) => c.provider === connection.provider);
    const allowed = connection.allowedTools.filter(
      (tool) =>
        capability &&
        capability.tools.includes(tool) &&
        toolPolicy(connection.provider, tool).mode !== 'blocked',
    );
    const mcp = new Server({ name: 'astra-hq', version: '1.0.0' }, { capabilities: { tools: {} } });
    mcp.setRequestHandler(ListToolsRequestSchema, async () =>
      connectedMcp(connection, async (client) => {
        let cursor: string | undefined;
        const tools = [];
        let pages = 0;
        do {
          const page = await client.listTools(cursor ? { cursor } : undefined);
          for (const tool of page.tools) {
            if (allowed.includes(tool.name))
              tools.push({
                ...tool,
                description: `${tool.description || tool.name}${toolPolicy(connection.provider, tool.name).mode === 'write' ? ' This tool prepares an action for human approval. It does not execute until approved.' : ''}`,
              });
          }
          cursor = page.nextCursor;
          if (++pages > 50) throw new Error('Too many MCP tool pages');
        } while (cursor);
        return { tools };
      }),
    );
    mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
      const tool = request.params.name,
        args = request.params.arguments || {};
      if (!allowed.includes(tool)) throw new Error('This employee is not authorized to use that tool.');
      // Re-read authorization at execution, including grants revoked since discovery.
      const current = await query<TaskContext | null>('services:gatewayContext', { runToken: token });
      const activeConnection = current?.connections.find(
        (c) => c.id === connection.id && c.allowedTools.includes(tool),
      );
      if (
        !activeConnection ||
        !current?.employeeVersion.capabilities.some(
          (c) => c.provider === connection.provider && c.tools.includes(tool),
        )
      )
        throw new Error('Integration access was revoked.');
      checkResourceScope(activeConnection.resourceScope, args, toolPolicy(activeConnection.provider, tool));
      const policy = toolPolicy(connection.provider, tool);
      if (policy.mode === 'write') {
        let beforeState: Record<string, unknown> | undefined;
        if (policy.correction) {
          const rule = policy.correction;
          if (!connection.allowedTools.includes(rule.readTool))
            throw new Error('Correction requires access to the configured record-reading tool.');
          const before = await auditedRead(token, activeConnection, rule.readTool, {
            [rule.idArgument]: args[rule.idArgument],
          });
          const record = resultObject(before);
          if (record[rule.versionField] === undefined)
            throw new Error('The provider did not supply the required record version.');
          beforeState = record;
        }
        const proposal = await mutate<{ proposalId: string; status: string }>('services:proposeAction', {
          runToken: token,
          connectionId: connection.id,
          tool,
          arguments: args,
          summary: `${tool.replace(/[._]/g, ' ')} in ${connection.provider}`,
          ...correctionPolicy(policy),
          ...(beforeState ? { beforeState } : {}),
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                actionId: proposal.proposalId,
                status: proposal.status,
                instruction:
                  'Wait for the human decision. This response does not mean the external action succeeded. Do not retry the same proposal or start dependent writes.',
              }),
            },
          ],
        };
      }
      return auditedRead(token, activeConnection, tool, args);
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await mcp.connect(transport);
    res.on('close', () => {
      void mcp.close();
    });
    let bytes = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 1_000_000) {
        res.writeHead(413);
        res.end();
        await mcp.close();
        return;
      }
      chunks.push(chunk);
    }
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;
    await transport.handleRequest(req, res, body);
  } catch (error) {
    console.error('Gateway request failed:', safeError(error));
    if (!res.headersSent) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32000,
            message:
              'The MCP request could not be completed. Check task access and integration configuration.',
          },
        }),
      );
    } else res.end();
  }
});
server.listen(Number(process.env.PORT || 4001), '0.0.0.0', () => console.log('MCP gateway listening'));
process.on('SIGTERM', () => server.close());
