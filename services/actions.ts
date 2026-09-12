import { query, journalMutation } from '../lib/server/backend';
import { connectedMcp } from '../lib/server/mcp';
import { canonical, checkResourceScope, resultObject, toolPolicy } from '../lib/server/tool-policy';
import { toolEvidence } from '../lib/server/audit-mcp';
import { safeError, seal } from '../lib/server/secrets';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { CorrectionDescriptor } from '../lib/contracts';
import type { Job, PrivateConnection, ToolPolicy } from './types';
interface ExecutableAction {
  action: { id: string; tool: string; arguments: string; beforeState?: string; originalActionId?: string };
  connection: PrivateConnection;
  policies: ToolPolicy[];
  task: { id: string; runToken: string };
  original?: { arguments: string; beforeState?: string; afterState?: string; tool: string };
}
/**
 * A compensating write has to know what it is restoring, so the live record is read through the
 * configured read tool and the correction is refused when the version is no longer the one the
 * original write returned. Without this the provider's precondition would reject the write after
 * dispatch, leaving an uncertain outcome instead of a clear refusal. The read is a sealed tool call
 * under the correction's lease, so the audit trail shows exactly what was compared.
 */
async function verifyCorrectionPrecondition(
  client: Client,
  input: {
    runToken: string;
    proposalId: string;
    leaseToken: string;
    connection: PrivateConnection;
    policies: ToolPolicy[];
    rule: CorrectionDescriptor;
    expectedVersion: unknown;
    id: unknown;
  },
) {
  const { rule, connection } = input;
  const policy = toolPolicy(input.policies, connection.provider, rule.readTool);
  if (policy.mode !== 'read' || !connection.allowedTools.includes(rule.readTool))
    throw new Error('Correction requires access to the configured record-reading tool.');
  const args = { [rule.idArgument]: input.id };
  checkResourceScope(connection.resourceScope, args, policy);
  const base = {
    runToken: input.runToken,
    connectionId: connection.id,
    tool: rule.readTool,
    operationId: `precondition:${input.proposalId}`,
    proposalId: input.proposalId,
    leaseToken: input.leaseToken,
    argumentsCiphertext: toolEvidence(args).ciphertext,
  };
  await journalMutation('services/actions:recordToolCall', { ...base, outcome: 'started' });
  const started = Date.now();
  let result;
  try {
    result = await client.callTool({ name: rule.readTool, arguments: args }, undefined, { timeout: 45_000 });
  } catch (error) {
    await journalMutation('services/actions:recordToolCall', {
      ...base,
      outcome: 'failed',
      reason: 'provider_error',
      durationMs: Date.now() - started,
      resultCiphertext: seal({ error: safeError(error) }),
    });
    throw error;
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
  if (result.isError) throw new Error('The record could not be read before correcting it.');
  const version = resultObject(result)[rule.versionField];
  if (version === undefined || canonical(version) !== canonical(input.expectedVersion))
    throw new Error(
      `The record changed after the original action (expected version ${canonical(input.expectedVersion)}, found ${canonical(version)}), so the automatic correction no longer applies. Review it manually.`,
    );
}

export async function executeAction(job: Job) {
  const proposalId = String(job.payload.proposalId);
  let dispatched = 0;
  let audit: Record<string, unknown> | undefined;
  let terminal: Record<string, unknown>;
  let auditResult: unknown;
  try {
    const context = await query<ExecutableAction>('services/actions:actionContext', {
      proposalId,
      leaseToken: job.leaseToken,
    });
    const { action, connection } = context;
    const policy = toolPolicy(context.policies, connection.provider, action.tool);
    if (policy.mode !== 'write') throw new Error('This tool is no longer approved for external writes.');
    let args = JSON.parse(action.arguments) as Record<string, unknown>;
    let before = action.beforeState ? JSON.parse(action.beforeState) : undefined;
    let precondition: { rule: CorrectionDescriptor; expectedVersion: unknown } | undefined;
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
      precondition = { rule, expectedVersion: after[rule.versionField] };
    } else if (policy.correction) {
      const rule = policy.correction;
      if (!before || before[rule.versionField] === undefined)
        throw new Error('The approved action has no captured resource version.');
      args[rule.expectedVersionArgument] = before[rule.versionField];
    }
    checkResourceScope(connection.resourceScope, args, policy);
    // Recheck the lease and grants immediately before dispatch. Never retry a write after an uncertain result.
    const result = await connectedMcp(connection, async (client) => {
      const current = await query<ExecutableAction>('services/actions:actionContext', {
        proposalId,
        leaseToken: job.leaseToken,
      });
      checkResourceScope(
        current.connection.resourceScope,
        args,
        toolPolicy(current.policies, current.connection.provider, action.tool),
      );
      if (precondition)
        await verifyCorrectionPrecondition(client, {
          runToken: current.task.runToken,
          proposalId,
          leaseToken: job.leaseToken,
          connection: current.connection,
          policies: current.policies,
          rule: precondition.rule,
          expectedVersion: precondition.expectedVersion,
          id: args[precondition.rule.idArgument],
        });
      audit = {
        runToken: current.task.runToken,
        connectionId: current.connection.id,
        tool: action.tool,
        operationId: `action:${proposalId}`,
        proposalId,
        leaseToken: job.leaseToken,
        argumentsCiphertext: toolEvidence(args).ciphertext,
      };
      await journalMutation('services/actions:recordToolCall', { ...audit, outcome: 'started' });
      dispatched = Date.now();
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
    auditResult = result;
    terminal = {
      proposalId,
      leaseToken: job.leaseToken,
      status: 'succeeded',
      result:
        serialized.length <= 60_000
          ? serialized
          : 'The provider confirmed success; the response exceeded the journal display limit.',
      ...(afterState ? { afterState } : {}),
    };
  } catch (error) {
    auditResult = { error: safeError(error), outcomeUnknown: Boolean(dispatched) };
    terminal = {
      proposalId,
      leaseToken: job.leaseToken,
      status: dispatched ? 'uncertain' : 'failed',
      result: safeError(error),
    };
  }
  if (audit && dispatched) {
    const evidence = toolEvidence(auditResult);
    await journalMutation('services/actions:recordToolCall', {
      ...audit,
      outcome: terminal.status === 'succeeded' ? 'succeeded' : 'failed',
      ...(terminal.status === 'succeeded' ? {} : { reason: 'provider_error' }),
      durationMs: Date.now() - dispatched,
      resultCiphertext: evidence.ciphertext,
      sha256: evidence.sha256,
    });
  }
  await journalMutation('services/actions:recordActionResult', terminal);
}
