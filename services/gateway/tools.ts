import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js';
import { auditedRead, journalDenied } from '../../lib/server/audit-mcp';
import type { Backend } from '../../lib/server/backend';
import { connectedMcp } from '../../lib/server/mcp';
import { safeError } from '../../lib/server/secrets';
import { checkResourceScope, correctionPolicy, resultObject, toolPolicy } from '../../lib/server/tool-policy';
import type { GatewayContext, PrivateConnection } from '../types';
import { GatewayError, toolFailure, upstreamFailure } from './errors';

export interface GatewayRequest {
  backend: Backend;
  requestId: string;
  runToken: string;
}

const writeNotice = ' This tool prepares an action for human approval. It does not execute until approved.';

const approvalInstruction =
  'Wait for the human decision. This response does not mean the external action succeeded. Do not retry the same proposal or start dependent writes.';

function log(request: GatewayRequest, reason: string) {
  // Reasons and request ids only. Arguments, tokens, and provider content never reach the log.
  console.error(`gateway tool call refused reason=${reason} request=${request.requestId}`);
}

/** The tools an agent may see: the connection grant, the version capability, and a non-blocked policy. */
export function permittedTools(context: GatewayContext, connection: PrivateConnection): string[] {
  const capabilities = context.employeeVersion.capabilities.filter(
    (capability) => capability.provider === connection.provider,
  );
  return connection.allowedTools.filter(
    (tool) =>
      capabilities.some((capability) => capability.tools.includes(tool)) &&
      toolPolicy(context.policies, connection.provider, tool).mode !== 'blocked',
  );
}

function jsonResult(value: Record<string, unknown>) {
  return { structuredContent: value, content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
}

function requireString(args: Record<string, unknown>, field: string): string {
  const value = args[field];
  if (typeof value !== 'string' || !value.trim())
    throw new GatewayError('invalid_arguments', `${field} must be a non-empty string.`);
  return value;
}

/** The MCP server one connection exposes: the reviewed provider tools, audited and policy-checked. */
export function providerServer(
  request: GatewayRequest,
  context: GatewayContext,
  connection: PrivateConnection,
): Server {
  const allowed = permittedTools(context, connection);
  const mcp = new Server({ name: 'astra-hq', version: '1.0.0' }, { capabilities: { tools: {} } });
  mcp.setRequestHandler(ListToolsRequestSchema, async () => {
    try {
      return await connectedMcp(connection, async (client) => {
        const tools = [];
        let cursor: string | undefined;
        let pages = 0;
        do {
          const page = await client.listTools(cursor ? { cursor } : undefined);
          for (const tool of page.tools) {
            if (!allowed.includes(tool.name)) continue;
            const write = toolPolicy(context.policies, connection.provider, tool.name).mode === 'write';
            tools.push({
              ...tool,
              description: `${tool.description || tool.name}${write ? writeNotice : ''}`,
            });
          }
          cursor = page.nextCursor;
          if (++pages > 50)
            throw new GatewayError('provider_error', 'The provider did not finish listing its tools.');
        } while (cursor);
        return { tools };
      });
    } catch (error) {
      // Discovery is not a call attempt, so it is never journaled as a denial.
      const failure =
        error instanceof GatewayError
          ? error
          : upstreamFailure(error, 'The integration could not list its tools.');
      log(request, failure.reason);
      throw new McpError(failure.code, failure.message, {
        reason: failure.reason,
        requestId: request.requestId,
      });
    }
  });
  mcp.setRequestHandler(CallToolRequestSchema, async (call) => {
    const tool = call.params.name;
    const args = call.params.arguments || {};
    try {
      const current = await authorize(request, connection, tool, args);
      const policy = toolPolicy(current.policies, current.connection.provider, tool);
      if (policy.mode !== 'write')
        return await auditedRead(request.runToken, current.connection, current.policies, tool, args);
      return jsonResult({
        ...(await propose(request, current.connection, current.policies, tool, args)),
        requestId: request.requestId,
      });
    } catch (error) {
      const failure =
        error instanceof GatewayError
          ? error
          : upstreamFailure(error, 'The integration could not complete the request.');
      log(request, failure.reason);
      return toolFailure(failure, request.requestId);
    }
  });
  return mcp;
}

/**
 * Re-reads authorization at execution time, including grants revoked since discovery. Every refusal
 * here is journaled as a denied call attempt; failures further down journal their own outcome.
 */
async function authorize(
  request: GatewayRequest,
  connection: PrivateConnection,
  tool: string,
  args: Record<string, unknown>,
) {
  try {
    const current = await request.backend
      .query<GatewayContext | null>('services/actions:gatewayContext', { runToken: request.runToken })
      .catch(() => null);
    const active = current?.connections.find(
      (candidate) => candidate.id === connection.id && candidate.allowedTools.includes(tool),
    );
    if (
      !current ||
      !active ||
      !current.employeeVersion.capabilities.some(
        (capability) => capability.provider === active.provider && capability.tools.includes(tool),
      )
    )
      throw new GatewayError('revoked', 'Integration access was revoked.');
    if (!permittedTools(current, active).includes(tool))
      throw new GatewayError('policy_denied', 'This employee is not authorized to use that tool.');
    const policy = toolPolicy(current.policies, active.provider, tool);
    checkResourceScope(active.resourceScope, args, policy);
    if (
      policy.mode === 'write' &&
      policy.correction &&
      !active.allowedTools.includes(policy.correction.readTool)
    )
      throw new GatewayError(
        'policy_denied',
        'Correction requires access to the configured record-reading tool.',
      );
    return { connection: active, policies: current.policies };
  } catch (error) {
    const failure =
      error instanceof GatewayError ? error : new GatewayError('policy_denied', safeError(error));
    await journalDenied(request.runToken, connection.id, tool, args, failure.reason).catch((journalFailure) =>
      log(request, `journal_failed:${safeError(journalFailure)}`),
    );
    throw failure;
  }
}

/** A write never reaches the provider from here: it becomes a proposal a human decides. */
async function propose(
  request: GatewayRequest,
  connection: PrivateConnection,
  policies: GatewayContext['policies'],
  tool: string,
  args: Record<string, unknown>,
) {
  const policy = toolPolicy(policies, connection.provider, tool);
  let beforeState: Record<string, unknown> | undefined;
  if (policy.correction) {
    const rule = policy.correction;
    const before = await auditedRead(request.runToken, connection, policies, rule.readTool, {
      [rule.idArgument]: args[rule.idArgument],
    });
    const record = resultObject(before);
    if (record[rule.versionField] === undefined)
      throw new GatewayError('provider_error', 'The provider did not supply the required record version.');
    beforeState = record;
  }
  const proposal = await request.backend.mutate<{ proposalId: string; status: string }>(
    'services/actions:proposeAction',
    {
      runToken: request.runToken,
      connectionId: connection.id,
      tool,
      arguments: args,
      summary: `${tool.replace(/[._]/g, ' ')} in ${connection.provider}`,
      ...correctionPolicy(policy),
      ...(beforeState ? { beforeState } : {}),
    },
  );
  return {
    code: -32005,
    reason: 'approval_required' as const,
    proposalId: proposal.proposalId,
    status: proposal.status,
    instruction: approvalInstruction,
  };
}

/**
 * The internal floor board. These are not provider tools: no policy row, no proposal, no upstream
 * call. They are journaled as task events because a tool call requires a connection.
 */
export function floorServer(request: GatewayRequest, taskId: string): Server {
  const mcp = new Server({ name: 'astra-hq-floor', version: '1.0.0' }, { capabilities: { tools: {} } });
  mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'floor_post',
        description: 'Post a short note on this floor board. Use it when you finish a milestone.',
        inputSchema: {
          type: 'object' as const,
          properties: { text: { type: 'string', description: 'The note to post.' } },
          required: ['text'],
          additionalProperties: false,
        },
      },
      {
        name: 'floor_handoff',
        description:
          'Request a handoff to another employee on this floor. A person accepts or declines it; requesting is not accepting.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            toEmployeeId: { type: 'string', description: 'The employee id to hand off to.' },
            brief: { type: 'string', description: 'What the next employee should do.' },
          },
          required: ['toEmployeeId', 'brief'],
          additionalProperties: false,
        },
      },
    ],
  }));
  mcp.setRequestHandler(CallToolRequestSchema, async (call) => {
    const args = call.params.arguments || {};
    try {
      if (call.params.name === 'floor_post') {
        await request.backend.mutate('services/floors:post', {
          runToken: request.runToken,
          text: requireString(args, 'text'),
        });
        await journalFloorEvent(request, taskId, 'floor.post', 'Posted a note on the floor board.');
        return jsonResult({ posted: true, requestId: request.requestId });
      }
      if (call.params.name === 'floor_handoff') {
        await request.backend.mutate('services/floors:requestHandoff', {
          runToken: request.runToken,
          toEmployeeId: requireString(args, 'toEmployeeId'),
          brief: requireString(args, 'brief'),
        });
        await journalFloorEvent(request, taskId, 'floor.handoff', 'Requested a handoff on the floor board.');
        return jsonResult({
          requested: true,
          status: 'pending',
          instruction: 'A person decides this handoff. Do not claim it was accepted and do not wait for it.',
          requestId: request.requestId,
        });
      }
      throw new GatewayError('policy_denied', 'That floor tool does not exist.');
    } catch (error) {
      // The only failures are authorization and shape: not on a floor, unknown employee, bad text.
      const failure =
        error instanceof GatewayError ? error : new GatewayError('policy_denied', safeError(error));
      log(request, failure.reason);
      return toolFailure(failure, request.requestId);
    }
  });
  return mcp;
}

async function journalFloorEvent(request: GatewayRequest, taskId: string, type: string, text: string) {
  await request.backend.journalMutation('services/sessions:recordEvents', {
    taskId,
    events: [{ externalId: `${type}:${randomUUID()}`, type, text, createdAt: Date.now() }],
  });
}
