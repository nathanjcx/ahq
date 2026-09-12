import { randomUUID } from 'node:crypto';
import { journalDenied, toolEvidence } from '../../../lib/server/audit-mcp';
import { connectedMcp } from '../../../lib/server/mcp';
import { safeError, seal } from '../../../lib/server/secrets';
import { checkResourceScope, toolPolicy } from '../../../lib/server/tool-policy';
import type { GatewayContext, PrivateConnection, ToolPolicy } from '../../types';
import { GatewayError, upstreamFailure } from '../errors';
import type { GatewayRequest } from '../tools';
import { requireString, untrusted, type InternalTool } from './shared';

export interface TriageAuthority {
  attended: boolean;
  allowList: string[];
  emergencyAllowList: string[];
  /** Delivered pages nobody has answered since the first of them. */
  unattendedAttempts: number;
  /** Whether the notification ledger and the clock have opened the emergency allow-list. */
  emergency: boolean;
}

interface TriageWriteTarget {
  connections: PrivateConnection[];
  policies: ToolPolicy[];
}

export function authorityQuery(request: GatewayRequest) {
  return request.backend.query<TriageAuthority>('services/triage:authority', {
    runToken: request.runToken,
  });
}

/**
 * The provider tools a triage run may use right now.
 *
 * The ordinary allow-list is always open for a triage task: that is the authority the workspace
 * granted when it named those tools. The emergency list opens only when `services/triage:authority`
 * says the clock and the notification ledger both admit it — outside attended hours, three delivered
 * pages standing unanswered for twenty minutes. Both are recomputed on every call, so a person
 * acknowledging a page between discovery and use closes the emergency list again.
 */
export function admittedTools(authority: TriageAuthority): { tools: string[]; emergency: string[] } {
  const emergency = authority.emergency ? authority.emergencyAllowList : [];
  return { tools: [...new Set([...authority.allowList, ...emergency])], emergency };
}

const reportReproduction: InternalTool = {
  name: 'report_reproduction',
  description:
    'Post what you reproduced to the triage channel and the affected floors: the steps, what you saw, and what it means for the work on those floors.',
  properties: { text: { type: 'string', description: 'The reproduction, in full.' } },
  required: ['text'],
  async run(request, _context, args) {
    await request.backend.mutate('services/channels:postFromAgent', {
      runToken: request.runToken,
      text: requireString(args, 'text'),
    });
    return { posted: true };
  },
};

const resolveAlert: InternalTool = {
  name: 'resolve_alert',
  description:
    'Close the fix with its post-mortem: the cause, the fix, the prevention, and the regression test that would catch it again. This closes the fix, not the incident; a person confirms the incident.',
  properties: {
    cause: { type: 'string', description: 'What actually caused it.' },
    fix: { type: 'string', description: 'What you changed.' },
    prevention: { type: 'string', description: 'What stops it recurring.' },
    regressionRef: { type: 'string', description: 'The regression test that covers it.' },
  },
  required: ['cause', 'fix', 'prevention', 'regressionRef'],
  async run(request, context, args) {
    const result = await request.backend.mutate<{ alertId: string }>('services/triage:resolve', {
      taskId: context.task.id,
      cause: requireString(args, 'cause'),
      fix: requireString(args, 'fix'),
      prevention: requireString(args, 'prevention'),
      regressionRef: requireString(args, 'regressionRef'),
    });
    return {
      ...result,
      status: 'fixed',
      instruction: 'A person confirms the incident is closed. Do not claim it is.',
    };
  },
};

export const triageTools = [reportReproduction, resolveAlert];

/**
 * A provider write a triage run makes directly, without a proposal.
 *
 * This is the one path in the gateway where an agent's write reaches a provider unattended, so every
 * gate is re-checked here rather than trusted from discovery: the tool is still on an admitted
 * list, the connection still grants it, the registry still reviews it as a write, and the resource
 * restriction still holds. Started and terminal outcomes are journaled as ordinary tool calls, so an
 * emergency action reads in the timeline exactly like an approved one.
 */
export async function dispatchTriageWrite(
  request: GatewayRequest,
  context: GatewayContext,
  tool: string,
  args: Record<string, unknown>,
) {
  const [authority, target] = await Promise.all([
    authorityQuery(request),
    request.backend.query<TriageWriteTarget>('services/triage:writeConnections', {
      runToken: request.runToken,
    }),
  ]);
  // The connection is resolved before the gates, so a refusal is journaled as a denied call against
  // the integration it was aimed at rather than disappearing into the task's events.
  const connection = target.connections.find((candidate) => candidate.allowedTools.includes(tool));
  if (!connection)
    throw new GatewayError('revoked', 'No connected integration grants that tool to this workspace.');
  const { tools, emergency } = admittedTools(authority);
  try {
    if (!tools.includes(tool))
      throw new GatewayError(
        'policy_denied',
        emergency.length
          ? 'That tool is not on this workspace’s triage allow-list.'
          : 'That tool needs approval, or the emergency allow-list, which is closed while a person can still answer.',
      );
    const policy = toolPolicy(target.policies, connection.provider, tool);
    if (policy.mode !== 'write')
      throw new GatewayError('policy_denied', 'That tool is not reviewed as an external write.');
    checkResourceScope(connection.resourceScope, args, policy);
  } catch (error) {
    const failure =
      error instanceof GatewayError ? error : new GatewayError('policy_denied', safeError(error));
    await journalDenied(request.runToken, connection.id, tool, args, failure.reason).catch(
      (journalFailure: unknown) =>
        console.error(`gateway journal failed reason=${safeError(journalFailure)}`),
    );
    throw failure;
  }
  const base = {
    runToken: request.runToken,
    connectionId: connection.id,
    tool,
    operationId: `triage:${randomUUID()}`,
    argumentsCiphertext: toolEvidence(args).ciphertext,
  };
  await request.backend.journalMutation('services/actions:recordToolCall', {
    ...base,
    outcome: 'started',
  });
  const started = Date.now();
  let result;
  try {
    result = await connectedMcp(connection, (client) =>
      client.callTool({ name: tool, arguments: args }, undefined, { timeout: 45_000 }),
    );
  } catch (error) {
    await request.backend.journalMutation('services/actions:recordToolCall', {
      ...base,
      outcome: 'failed',
      reason: 'provider_error',
      durationMs: Date.now() - started,
      resultCiphertext: seal({ error: safeError(error) }),
    });
    throw error instanceof GatewayError
      ? error
      : upstreamFailure(error, 'The integration could not complete the write.');
  }
  const evidence = toolEvidence(result);
  await request.backend.journalMutation('services/actions:recordToolCall', {
    ...base,
    outcome: result.isError ? 'failed' : 'succeeded',
    ...(result.isError ? { reason: 'provider_error' } : {}),
    durationMs: Date.now() - started,
    resultCiphertext: evidence.ciphertext,
    sha256: evidence.sha256,
  });
  if (result.isError) throw new GatewayError('provider_error', 'The integration refused the write.');
  return {
    executed: true,
    emergency: emergency.includes(tool),
    result: untrusted(result.structuredContent ?? result.content),
    ...(emergency.includes(tool)
      ? {
          instruction:
            'You acted without permission under the emergency rule. Verify the fix, then file the incident report: the issue, the reproduction, the fix, why you acted, and the side effects and knock-on risks.',
        }
      : {}),
  };
}

/** The provider tools the triage server advertises alongside its own, described as what they are. */
export async function triageProviderTools(request: GatewayRequest) {
  const authority = await authorityQuery(request).catch(() => null);
  if (!authority) return [];
  const { tools, emergency } = admittedTools(authority);
  const target = await request.backend
    .query<TriageWriteTarget>('services/triage:writeConnections', { runToken: request.runToken })
    .catch(() => null);
  const granted = new Set(target?.connections.flatMap((connection) => connection.allowedTools) ?? []);
  return tools
    .filter((tool) => granted.has(tool))
    .map((tool) => ({
      name: tool,
      description: emergency.includes(tool)
        ? `${tool.replace(/[._]/g, ' ')}. Emergency authority only: nobody answered three pages, so this executes without approval. Verify the result and file the incident report.`
        : `${tool.replace(/[._]/g, ' ')}. On this workspace’s triage allow-list, so it executes without a proposal. Use it only for this incident.`,
      inputSchema: { type: 'object' as const, additionalProperties: true },
    }));
}
