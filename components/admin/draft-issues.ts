import type { AdminDraft, AdminToolRegistry } from '@/lib/ui-api';
import { providerName } from '../shared/format';

export type EditorDraft = AdminDraft & { id: string };

/** Everything that must be fixed before a draft can be published. */
export function draftPublishIssues(draft: EditorDraft, registry: AdminToolRegistry) {
  const issues: string[] = [];
  if (!draft.name.trim() || !draft.role.trim() || !draft.description.trim() || !draft.category.trim())
    issues.push('Complete the public listing.');
  if (!draft.instructions.trim()) issues.push('Add private instructions.');
  if (new Set(draft.capabilities.map((item) => item.provider)).size !== draft.capabilities.length)
    issues.push('Use one capability row per MCP provider.');
  for (const capability of draft.capabilities) {
    const providerRegistry = registry.find((item) => item.provider === capability.provider);
    if (!providerRegistry?.configured) {
      issues.push(`Configure ${providerName(capability.provider)} in the tool registry.`);
      continue;
    }
    if (!capability.tools.length)
      issues.push(`Choose at least one ${providerName(capability.provider)} tool.`);
    const known = new Set(
      providerRegistry.tools.filter((tool) => tool.mode !== 'blocked').map((tool) => tool.name),
    );
    if (capability.tools.some((tool) => !known.has(tool)))
      issues.push(`Review unavailable ${providerName(capability.provider)} tools.`);
  }
  if (draft.skills.some((skill) => !skill.name.trim() || !skill.version.trim() || !skill.content.trim()))
    issues.push('Complete every private skill.');
  if (draft.media.some((item) => !item.url.trim() || !item.alt.trim()))
    issues.push('Complete every gallery item.');
  return [...new Set(issues)];
}

export function editorRowId() {
  return crypto.randomUUID();
}

export async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
