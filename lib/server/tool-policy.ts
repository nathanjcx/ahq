import type { CorrectionKind, ProviderId } from '../contracts';
import type { ToolPolicy } from '../../services/types';

export type ResolvedPolicy = Pick<ToolPolicy, 'mode' | 'resourceArgument' | 'correction'>;

/** A tool exists for agents only when the administrator's registry has a row for it. */
export function toolPolicy(policies: ToolPolicy[], provider: string, tool: string): ResolvedPolicy {
  const row = policies.find((policy) => policy.provider === (provider as ProviderId) && policy.name === tool);
  if (!row) return { mode: 'blocked' };
  return {
    mode: row.mode,
    ...(row.resourceArgument ? { resourceArgument: row.resourceArgument } : {}),
    ...(row.correction ? { correction: row.correction } : {}),
  };
}

export function correctionPolicy(policy: ResolvedPolicy): {
  correction: CorrectionKind;
  correctionReason: string;
} {
  return policy.correction
    ? {
        correction: 'supported',
        correctionReason:
          'A compensating update restores only the configured fields and requires the original resource version. Notifications and other downstream effects may remain.',
      }
    : {
        correction: 'manual',
        correctionReason:
          'This MCP tool has no verified conditional correction operation. We can prepare a correction task, but cannot automatically undo its effects.',
      };
}

export function validateScope(scope: string): string[] {
  if (!scope.trim()) return [];
  const ids = scope
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length > 100 || ids.some((id) => !/^[-A-Za-z0-9_:/@.]{1,200}$/.test(id)))
    throw new Error(
      'Resource restrictions must be comma-separated exact IDs. Leave blank to use the account’s granted permissions.',
    );
  return ids;
}

export function checkResourceScope(
  scope: string,
  args: Record<string, unknown>,
  policy?: ResolvedPolicy,
): void {
  const ids = validateScope(scope);
  if (!ids.length) return;
  if (!policy?.resourceArgument)
    throw new Error(
      'This tool has no verified resource restriction. Ask the administrator to configure its resource argument, or restrict access in the provider account.',
    );
  const target = args[policy.resourceArgument];
  if (typeof target !== 'string' || !ids.includes(target))
    throw new Error('This request is outside the connection resource restriction.');
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

export function resultObject(result: unknown): Record<string, unknown> {
  const value = result as {
    structuredContent?: Record<string, unknown>;
    content?: { type: string; text?: string }[];
  };
  if (value.structuredContent) return value.structuredContent;
  const text = value.content?.find((c) => c.type === 'text')?.text;
  if (!text) throw new Error('The MCP tool did not return a readable record.');
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('The MCP result is not a record.');
  return parsed;
}
