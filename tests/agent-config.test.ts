import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentConfigSchema, ASTRA_MODEL, defaultAgentConfig, resolveAgentConfig } from '../shared/agent-config';
import { EmployeeSchema, StateSchema } from '../shared/schemas';
import { initialState } from '../src/lib/store';
import { CodexAppServer } from '../runtime/codex';

test('missing employee settings migrate to independent Astra configs without silently accepting invalid saved settings', () => {
  const legacy = structuredClone(initialState());
  for (const employee of legacy.employees) delete employee.agent;
  const migrated = StateSchema.parse(legacy);
  for (const employee of migrated.employees) assert.equal(employee.agent.model, ASTRA_MODEL);
  migrated.employees[0].agent.memory.kinds.length = 0;
  assert.ok(migrated.employees[1].agent.memory.kinds.length > 0);
  const defaults = defaultAgentConfig();
  defaults.tools.integrationIds.push('only-this-instance');
  assert.deepEqual(defaultAgentConfig().tools.integrationIds, []);
  const invalid = { ...legacy.employees[0], agent: { ...defaultAgentConfig(), model: 'gpt-5' } };
  assert.equal(EmployeeSchema.safeParse(invalid).success, false);
  assert.throws(() => resolveAgentConfig(null));
  assert.throws(() => resolveAgentConfig({}));
});

test('Astra model restriction and unknown settings are enforced recursively', () => {
  for (const model of ['', 'gpt-5', 'gpt-6-astra-other', 'auto', ' gpt-6-astra']) {
    assert.equal(AgentConfigSchema.safeParse({ ...defaultAgentConfig(), model }).success, false);
  }
  assert.equal(AgentConfigSchema.safeParse({ ...defaultAgentConfig(), arbitraryTool: true }).success, false);
  assert.equal(AgentConfigSchema.safeParse({ ...defaultAgentConfig(), tools: { ...defaultAgentConfig().tools, shell: true } }).success, false);
  assert.equal(resolveAgentConfig().model, ASTRA_MODEL);
});

test('runtime budgets reject invalid ranges and a run budget smaller than one response', () => {
  const base = defaultAgentConfig();
  const mutations = [
    { maxOutputTokens: 255 }, { maxRunTokens: 1023 }, { maxToolCalls: -1 }, { maxToolCalls: 201 },
    { maxTurns: 0 }, { maxTurns: 1.5 }, { maxRuntimeMinutes: 0 }, { maxRuntimeMinutes: 241 },
    { maxOutputTokens: 20_000, maxRunTokens: 10_000 },
  ];
  for (const limits of mutations) assert.equal(AgentConfigSchema.safeParse({ ...base, limits: { ...base.limits, ...limits } }).success, false);
  assert.equal(AgentConfigSchema.safeParse({ ...base, limits: { ...base.limits, maxToolCalls: 0 } }).success, true);
});

test('memory and communication settings validate types, scopes, duplicate identities and retention bounds', () => {
  const base = defaultAgentConfig();
  for (const memory of [{ kinds: ['invented'] }, { kinds: ['working', 'working'] }, { scopes: ['private'] }, { scopes: ['employee', 'employee'] }, { write: 'unrestricted' }, { retentionDays: 0 }, { maxEntries: 0 }, { maxContextChars: 999 }]) {
    assert.equal(AgentConfigSchema.safeParse({ ...base, memory: { ...base.memory, ...memory } }).success, false);
  }
  for (const communication of [{ teammateIds: ['one', 'one'] }, { maxHandoffs: -1 }, { maxHandoffs: 51 }]) {
    assert.equal(AgentConfigSchema.safeParse({ ...base, communication: { ...base.communication, ...communication } }).success, false);
  }
  assert.equal(AgentConfigSchema.safeParse({ ...base, communication: { ...base.communication, teammateIds: [], maxHandoffs: 0 } }).success, true);
});

test('legacy Codex transport rejects non-Astra selection before requesting a thread', async () => {
  const codex = new CodexAppServer();
  for (const model of ['gpt-5', 'other-provider', 'gpt-6-astra-other']) {
    await assert.rejects(() => codex.runTurn({ cwd: '/unused-test-workspace', model, prompt: 'Never dispatch this test' }), /requires gpt-6-astra/);
  }
});
