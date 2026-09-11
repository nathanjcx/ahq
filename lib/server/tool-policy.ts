import { z } from 'zod';
import type { CorrectionKind } from '../contracts';
const readTools: Record<string, Set<string>> = {
  linear: new Set([
    'list_issues',
    'get_issue',
    'list_projects',
    'get_project',
    'list_teams',
    'get_team',
    'list_users',
    'get_user',
    'get_document',
    'list_documents',
    'list_comments',
    'list_cycles',
    'list_issue_statuses',
    'get_issue_status',
    'list_issue_labels',
    'list_project_labels',
    'list_project_statuses',
    'get_project_status',
    'search_documentation',
  ]),
  slack: new Set([
    'slack_search_messages',
    'slack_search_all',
    'slack_read_channel',
    'slack_read_thread',
    'search_messages',
    'search_all',
    'read_channel',
    'read_thread',
  ]),
  github: new Set([
    'search_code',
    'search_repositories',
    'search_issues',
    'search_pull_requests',
    'get_file_contents',
    'get_me',
    'list_branches',
    'list_commits',
    'get_commit',
    'list_pull_requests',
    'pull_request_read',
    'issue_read',
    'get_issue_comments',
    'list_releases',
    'get_latest_release',
  ]),
};
const correctionSchema = z.object({
  readTool: z.string().min(1),
  idArgument: z.string().min(1),
  versionField: z.string().min(1),
  expectedVersionArgument: z.string().min(1),
  fields: z.array(z.string().min(1)).min(1),
});
const policySchema = z.object({
  mode: z.enum(['read', 'write', 'blocked']),
  correction: correctionSchema.optional(),
  resourceArgument: z.string().min(1).optional(),
});
export type ToolPolicy = z.infer<typeof policySchema>;
export function toolPolicy(provider: string, tool: string): ToolPolicy {
  if (/(^|[._])(?:delete|purge|destroy|permanently_delete)(?:[._]|$)/i.test(tool)) return { mode: 'blocked' };
  const overrides = JSON.parse(process.env.MCP_TOOL_POLICIES_JSON || '{}') as Record<string, unknown>;
  if (overrides[`${provider}:${tool}`]) return policySchema.parse(overrides[`${provider}:${tool}`]);
  // Only explicitly reviewed tool names are reads. Server annotations cannot grant execution rights.
  return { mode: readTools[provider]?.has(tool) ? 'read' : 'write' };
}
export function correctionPolicy(policy: ToolPolicy): {
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
export function checkResourceScope(scope: string, args: Record<string, unknown>, policy?: ToolPolicy): void {
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
