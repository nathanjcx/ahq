import { randomUUID } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInternalServer, serversFor } from '../../lib/server/agents';
import { backend as processBackend, installBackend, type Backend } from '../../lib/server/backend';
import type { GatewayContext } from '../types';
import { GatewayError, protocolFailure } from './errors';
import { internalMcp, providerServer, type GatewayRequest } from './tools';

const maxBodyBytes = 1_000_000;
const requestIdPattern = /^[A-Za-z0-9._:-]{1,200}$/;
/** How long one health probe stands for. `/health` is public, so it is not a way to drive Convex. */
const healthProbeMs = 10_000;

export interface GatewayOptions {
  /** Defaults to the process backend. An injected backend is installed for the whole process. */
  backend?: Backend;
  requestId?: () => string;
}

function bearer(req: IncomingMessage): string {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maxBodyBytes)
      throw new GatewayError('request_too_large', 'The MCP request body is larger than 1 MB.');
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new GatewayError('malformed_request', 'The MCP request body is not valid JSON.');
  }
}

export function createGateway(options: GatewayOptions = {}) {
  // The lib/server helpers this request path uses (audit journal, credential refresh, provider
  // configuration) call the process backend, so an injected backend becomes the process backend.
  if (options.backend) installBackend(options.backend);
  const backend = options.backend ?? processBackend();
  const nextRequestId = options.requestId ?? (() => randomUUID());

  /**
   * Readiness is one service query that reads no tables: it answers only if Convex is reachable and
   * accepts this process's service secret. A gateway with the wrong secret refuses every real request,
   * so it must fail its healthcheck rather than pass as a process that happens to be listening.
   */
  let probe: { at: number; ready: boolean } | undefined;
  const ready = async () => {
    if (probe && Date.now() - probe.at < healthProbeMs) return probe.ready;
    const result = await backend.query('services/config:policies', { providers: [] }).then(
      () => true,
      () => false,
    );
    probe = { at: Date.now(), ready: result };
    return result;
  };

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const supplied = req.headers['x-request-id'];
    const requestId =
      typeof supplied === 'string' && requestIdPattern.test(supplied) ? supplied : nextRequestId();
    if (!res.headersSent) res.setHeader('x-request-id', requestId);
    if ((req.url || '').split('?')[0] === '/health') {
      const healthy = await ready();
      res.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json' });
      res.end(`{"status":"${healthy ? 'ok' : 'degraded'}","service":"mcp-gateway"}`);
      return;
    }
    try {
      const match = /^\/mcp\/([^/]{1,256})$/.exec((req.url || '').split('?')[0]);
      if (!match) throw new GatewayError('malformed_request', 'Unknown gateway endpoint.');
      // The path segment is only ever compared against this task's own connection ids.
      const target = decodeURIComponent(match[1]);
      const runToken = bearer(req);
      if (!runToken) throw new GatewayError('unauthorized', 'A task run token is required.');
      // Fail closed: an unknown token and an unreachable authorization service are both unauthorized.
      const context = await backend
        .query<GatewayContext | null>('services/actions:gatewayContext', { runToken })
        .catch(() => null);
      if (!context)
        throw new GatewayError('unauthorized', 'This run token does not belong to an active task.');
      const request: GatewayRequest = { backend, requestId, runToken };
      let mcp;
      if (isInternalServer(target)) {
        // Role first: a worker token never reaches audit, triage, or janitor, whatever it asks for.
        if (!serversFor(context.employee.kind, context.task.kind).includes(target))
          throw new GatewayError('policy_denied', 'This employee is not authorized to use those tools.');
        if (target === 'floor' && !context.task.floorId)
          throw new GatewayError('revoked', 'This task is not on a floor, so it has no board.');
        mcp = internalMcp(request, target);
      } else {
        const connection = context.connections.find((candidate) => candidate.id === target);
        if (!connection) throw new GatewayError('revoked', 'That integration is not available to this task.');
        mcp = providerServer(request, context, connection);
      }
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await mcp.connect(transport);
      res.on('close', () => void mcp.close());
      await transport.handleRequest(req, res, await readBody(req));
    } catch (error) {
      const failure = protocolFailure(error, requestId);
      // Reason and request id only: never arguments, tokens, or provider content.
      console.error(`gateway request failed reason=${failure.body.error.data.reason} request=${requestId}`);
      if (res.headersSent) {
        res.end();
        return;
      }
      res.writeHead(failure.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(failure.body));
    }
  };

  return {
    handler,
    listen(port: number, host = '0.0.0.0'): HttpServer {
      return createServer((req, res) => void handler(req, res)).listen(port, host);
    },
  };
}
