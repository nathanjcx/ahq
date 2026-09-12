import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { internalServerLabel, serversFor, type InternalServer } from '../../../lib/server/agents';
import { safeError } from '../../../lib/server/secrets';
import { untrustedBlock } from '../../../lib/server/untrusted';
import type { GatewayContext } from '../../types';
import { GatewayError, toolFailure } from '../errors';
import type { GatewayRequest } from '../tools';

/** One tool an internal server exposes. `run` returns the value the agent sees. */
export interface InternalTool {
  name: string;
  description: string;
  properties: Record<string, { type: string; description: string; items?: { type: string } }>;
  required?: string[];
  run(
    request: GatewayRequest,
    context: GatewayContext,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
}

export function jsonResult(value: Record<string, unknown>) {
  return { structuredContent: value, content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
}

export function requireString(args: Record<string, unknown>, field: string): string {
  const value = args[field];
  if (typeof value !== 'string' || !value.trim())
    throw new GatewayError('invalid_arguments', `${field} must be a non-empty string.`);
  return value;
}

export function optionalString(args: Record<string, unknown>, field: string): string | undefined {
  const value = args[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new GatewayError('invalid_arguments', `${field} must be a string.`);
  return value;
}

export function stringList(args: Record<string, unknown>, field: string): string[] {
  const value = args[field];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))
    throw new GatewayError('invalid_arguments', `${field} must be an array of strings.`);
  return value as string[];
}

export function boundedNumber(args: Record<string, unknown>, field: string, min: number, max: number) {
  const value = args[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new GatewayError('invalid_arguments', `${field} must be a number.`);
  return Math.max(min, Math.min(max, value));
}

/**
 * Material the model must read as data. Every internal server that hands back a channel post, a
 * report, a memory claim, a journal line, or a provider's own words puts it through this on the way
 * out; see `lib/server/untrusted.ts` for why the runtime is the one place that fences.
 */
export function untrusted(value: unknown) {
  return untrustedBlock(JSON.stringify(value, null, 2));
}

/**
 * An internal tool call is journaled as a task event rather than a `toolCalls` row: that table keys
 * every row to a connection, and these tools have no provider behind them. The reason code from the
 * gateway's failure taxonomy is carried in the event text, as the floor board has always done.
 */
async function journalCall(
  request: GatewayRequest,
  taskId: string,
  server: InternalServer,
  tool: string,
  outcome: 'succeeded' | 'denied',
  reason?: string,
) {
  await request.backend
    .journalMutation('services/sessions:recordEvents', {
      taskId,
      events: [
        {
          externalId: `${server}.${tool}:${randomUUID()}`,
          type: `tool.${internalServerLabel(server)}.${tool}`,
          text:
            outcome === 'succeeded'
              ? `Used ${tool} on ${internalServerLabel(server)}.`
              : `Refused ${tool} on ${internalServerLabel(server)}: ${reason ?? 'policy_denied'}.`,
          createdAt: Date.now(),
        },
      ],
    })
    .catch((error: unknown) =>
      console.error(`gateway journal failed reason=${safeError(error)} request=${request.requestId}`),
    );
}

/** Tools a server discovers at call time rather than declaring: the triage allow-lists. */
interface DynamicTools {
  list(
    request: GatewayRequest,
  ): Promise<{ name: string; description: string; inputSchema: Record<string, unknown> }[]>;
  run(
    request: GatewayRequest,
    context: GatewayContext,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
}

/**
 * Builds one internal MCP server from a tool list.
 *
 * The role is re-read on every request, not only at discovery: `serversFor` is evaluated against the
 * employee kind and task kind the run token resolves to right now, so a token that changes role —
 * or a task that goes terminal — is refused between listing a tool and calling it.
 */
export function internalServer(
  request: GatewayRequest,
  server: InternalServer,
  tools: InternalTool[],
  dynamic?: DynamicTools,
): Server {
  const mcp = new Server({ name: `astra-hq-${server}`, version: '1.0.0' }, { capabilities: { tools: {} } });
  const current = async () => {
    const context = await request.backend
      .query<GatewayContext | null>('services/actions:gatewayContext', { runToken: request.runToken })
      .catch(() => null);
    if (!context) throw new GatewayError('unauthorized', 'This run token does not belong to an active task.');
    if (!serversFor(context.employee.kind, context.task.kind).includes(server))
      throw new GatewayError('policy_denied', 'This employee is not authorized to use those tools.');
    return context;
  };
  mcp.setRequestHandler(ListToolsRequestSchema, async () => {
    await current();
    return {
      tools: [
        ...tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: {
            type: 'object' as const,
            properties: tool.properties,
            required: tool.required ?? [],
            additionalProperties: false,
          },
        })),
        ...(dynamic ? await dynamic.list(request) : []),
      ],
    };
  });
  mcp.setRequestHandler(CallToolRequestSchema, async (call) => {
    const name = call.params.name;
    const args = call.params.arguments || {};
    let taskId = '';
    try {
      const context = await current();
      taskId = context.task.id;
      const tool = tools.find((candidate) => candidate.name === name);
      if (!tool && !dynamic) throw new GatewayError('policy_denied', `${name} is not a tool on this server.`);
      const result = tool
        ? await tool.run(request, context, args)
        : await dynamic!.run(request, context, name, args);
      await journalCall(request, taskId, server, name, 'succeeded');
      return jsonResult({ ...result, requestId: request.requestId });
    } catch (error) {
      const failure =
        error instanceof GatewayError ? error : new GatewayError('policy_denied', safeError(error));
      console.error(`gateway tool call refused reason=${failure.reason} request=${request.requestId}`);
      if (taskId) await journalCall(request, taskId, server, name, 'denied', failure.reason);
      return toolFailure(failure, request.requestId);
    }
  });
  return mcp;
}
