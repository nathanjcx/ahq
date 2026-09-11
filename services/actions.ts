import { query, mutate } from '../lib/server/backend';
import { connectedMcp } from '../lib/server/mcp';
import { canonical, checkResourceScope, resultObject, toolPolicy } from '../lib/server/tool-policy';
import { safeError } from '../lib/server/secrets';
import type { PrivateConnection } from '../lib/server/mcp';
import type { Job } from './types';
interface ExecutableAction {
  action: { id: string; tool: string; arguments: string; beforeState?: string; originalActionId?: string };
  connection: PrivateConnection;
  task: { id: string; runToken: string };
  original?: { arguments: string; beforeState?: string; afterState?: string; tool: string };
}
export async function executeAction(job: Job) {
  const proposalId = String(job.payload.proposalId);
  let dispatched = false;
  try {
    const context = await query<ExecutableAction>('services:actionContext', {
      proposalId,
      leaseToken: job.leaseToken,
    });
    const { action, connection } = context;
    const policy = toolPolicy(connection.provider, action.tool);
    if (policy.mode !== 'write') throw new Error('This tool is no longer approved for external writes.');
    let args = JSON.parse(action.arguments) as Record<string, unknown>;
    let before = action.beforeState ? JSON.parse(action.beforeState) : undefined;
    if (action.originalActionId) {
      const rule = policy.correction,
        original = context.original;
      if (!rule || !original?.beforeState || !original.afterState)
        throw new Error('This action requires a manual correction task.');
      const originalArgs = JSON.parse(original.arguments),
        previous = JSON.parse(original.beforeState),
        after = JSON.parse(original.afterState);
      if (after[rule.versionField] === undefined)
        throw new Error('The previous write did not return a version. Automatic correction is unavailable.');
      args = {
        [rule.idArgument]: originalArgs[rule.idArgument],
        [rule.expectedVersionArgument]: after[rule.versionField],
      };
      for (const field of rule.fields) {
        if (!(field in previous)) throw new Error(`Previous field ${field} was not captured.`);
        args[field] = previous[field];
      }
      before = after;
    } else if (policy.correction) {
      const rule = policy.correction;
      if (!before || before[rule.versionField] === undefined)
        throw new Error('The approved action has no captured resource version.');
      args[rule.expectedVersionArgument] = before[rule.versionField];
    }
    checkResourceScope(connection.resourceScope, args, toolPolicy(connection.provider, action.tool));
    // Recheck the lease and grants immediately before dispatch. Never retry a write after an uncertain result.
    const result = await connectedMcp(connection, async (client) => {
      const current = await query<ExecutableAction>('services:actionContext', {
        proposalId,
        leaseToken: job.leaseToken,
      });
      checkResourceScope(
        current.connection.resourceScope,
        args,
        toolPolicy(current.connection.provider, action.tool),
      );
      dispatched = true;
      return client.callTool({ name: action.tool, arguments: args }, undefined, { timeout: 45_000 });
    });
    if (result.isError)
      throw new Error('The MCP server returned an error after dispatch. Check the provider before retrying.');
    let afterState: Record<string, unknown> | undefined;
    if (policy.correction) {
      try {
        afterState = resultObject(result);
      } catch {
        /* A successful write without a version remains a manual correction. */
      }
    }
    const serialized = canonical(result);
    await mutate('services:recordActionResult', {
      proposalId,
      leaseToken: job.leaseToken,
      status: 'succeeded',
      result:
        serialized.length <= 60_000
          ? serialized
          : 'The provider confirmed success; the response exceeded the journal display limit.',
      ...(afterState ? { afterState } : {}),
    });
  } catch (error) {
    await mutate('services:recordActionResult', {
      proposalId,
      leaseToken: job.leaseToken,
      status: dispatched ? 'uncertain' : 'failed',
      result: safeError(error),
    });
  }
}
