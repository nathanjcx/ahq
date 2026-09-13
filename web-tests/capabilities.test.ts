import { describe, expect, it } from 'vitest';
import { capabilityGranted } from '../lib/capabilities';

describe('capabilityGranted', () => {
  const gmail = {
    provider: 'google-workspace',
    status: 'connected',
    allowedTools: ['search_threads', 'create_draft'],
  };
  const sheets = {
    provider: 'google-workspace',
    status: 'connected',
    allowedTools: ['get_values', 'update_values'],
  };

  it('unions the connected servers of one provider', () => {
    const capability = { provider: 'google-workspace', tools: ['search_threads', 'get_values'] };
    expect(capabilityGranted(capability, [gmail, sheets])).toBe(true);
    expect(capabilityGranted(capability, [gmail])).toBe(false);
    expect(capabilityGranted(capability, [gmail, { ...sheets, status: 'disconnected' }])).toBe(false);
  });

  it('ignores another provider that happens to name the same tool', () => {
    const slack = { provider: 'slack', status: 'connected', allowedTools: ['search_threads'] };
    expect(capabilityGranted({ provider: 'google-workspace', tools: ['search_threads'] }, [slack])).toBe(
      false,
    );
  });
});
