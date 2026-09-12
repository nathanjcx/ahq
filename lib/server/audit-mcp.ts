import { createHash, randomUUID } from 'node:crypto';
import { connectedMcp } from './mcp';
import { journalMutation, query } from './backend';
import { canonical, checkResourceScope, toolPolicy } from './tool-policy';
import { seal, safeError } from './secrets';
import type { PrivateConnection, TaskContext, ToolPolicy } from '../../services/types';

export function toolEvidence(value: unknown) {
  const serialized = canonical(value),
    sha256 = createHash('sha256').update(serialized).digest('hex');
  return {
    ciphertext: seal(
      Buffer.byteLength(serialized) <= 50_000
        ? value
        : { truncated: true, sha256, bytes: Buffer.byteLength(serialized) },
    ),
    sha256,
  };
}

/** Journals a denied attempt so the timeline shows what the agent tried and why it was refused. */
export async function journalDenied(
  runToken: string,
  connectionId: string,
  tool: string,
  args: unknown,
  reason: string,
) {
  await journalMutation('services/actions:recordToolCall', {
    runToken,
    connectionId,
    tool,
    operationId: `denied:${randomUUID()}`,
    argumentsCiphertext: toolEvidence(args).ciphertext,
    outcome: 'denied',
    reason,
  });
}

export async function auditedRead(
  runToken: string,
  connection: PrivateConnection,
  policies: ToolPolicy[],
  tool: string,
  args: Record<string, unknown>,
) {
  if (toolPolicy(policies, connection.provider, tool).mode !== 'read')
    throw new Error('The configured read tool is not approved as read-only.');
  checkResourceScope(connection.resourceScope, args, toolPolicy(policies, connection.provider, tool));
  const operationId = randomUUID(),
    request = toolEvidence(args);
  const base = {
    runToken,
    connectionId: connection.id,
    tool,
    operationId,
    argumentsCiphertext: request.ciphertext,
  };
  let started = 0;
  let result;
  try {
    result = await connectedMcp(connection, async (client) => {
      const current = await query<Pick<TaskContext, 'connections' | 'policies'>>(
        'services/actions:gatewayContext',
        { runToken },
      );
      const active = current.connections.find((item) => item.id === connection.id);
      if (!active) throw new Error('Connection was revoked');
      checkResourceScope(active.resourceScope, args, toolPolicy(current.policies, active.provider, tool));
      await journalMutation('services/actions:recordToolCall', { ...base, outcome: 'started' });
      started = Date.now();
      return client.callTool({ name: tool, arguments: args }, undefined, { timeout: 45_000 });
    });
  } catch (error) {
    if (started)
      await journalMutation('services/actions:recordToolCall', {
        ...base,
        outcome: 'failed',
        reason: 'provider_error',
        durationMs: Date.now() - started,
        resultCiphertext: seal({ error: safeError(error) }),
      });
    throw new Error('The integration could not complete the read. Check its connection and permissions.');
  }
  const output = toolEvidence(result);
  await journalMutation('services/actions:recordToolCall', {
    ...base,
    outcome: result.isError ? 'failed' : 'succeeded',
    ...(result.isError ? { reason: 'provider_error' } : {}),
    durationMs: Date.now() - started,
    resultCiphertext: output.ciphertext,
    sha256: output.sha256,
  });
  return result;
}
