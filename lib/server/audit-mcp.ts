import { createHash, randomUUID } from 'node:crypto';
import { connectedMcp, type PrivateConnection } from './mcp';
import { mutate } from './backend';
import { canonical, checkResourceScope, toolPolicy } from './tool-policy';
import { seal, safeError } from './secrets';
function evidence(value: unknown) {
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
export async function auditedRead(
  runToken: string,
  connection: PrivateConnection,
  tool: string,
  args: Record<string, unknown>,
) {
  if (toolPolicy(connection.provider, tool).mode !== 'read')
    throw new Error('The configured read tool is not approved as read-only.');
  checkResourceScope(connection.resourceScope, args, toolPolicy(connection.provider, tool));
  const operationId = randomUUID(),
    request = evidence(args);
  const base = {
    runToken,
    connectionId: connection.id,
    tool,
    operationId,
    argumentsCiphertext: request.ciphertext,
  };
  await mutate('services:recordToolCall', { ...base, outcome: 'started' });
  try {
    const result = await connectedMcp(connection, (client) =>
      client.callTool({ name: tool, arguments: args }, undefined, { timeout: 45_000 }),
    );
    const output = evidence(result);
    await mutate('services:recordToolCall', {
      ...base,
      outcome: result.isError ? 'failed' : 'succeeded',
      resultCiphertext: output.ciphertext,
      sha256: output.sha256,
    });
    return result;
  } catch (error) {
    await mutate('services:recordToolCall', {
      ...base,
      outcome: 'failed',
      resultCiphertext: seal({ error: safeError(error) }),
    });
    throw new Error('The integration could not complete the read. Check its connection and permissions.');
  }
}
