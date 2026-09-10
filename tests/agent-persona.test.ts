import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AgentConfigSchema,
  defaultAgentConfig,
  defaultAgentPersona,
  formatAgentPersona,
  resolveAgentConfig,
} from '../shared/agent-config';

test('pre-persona configurations retain all explicit settings and receive independent role charters', () => {
  const { persona: _persona, ...legacy } = defaultAgentConfig();
  legacy.instructions = 'Keep this role instruction';
  legacy.reasoning = 'max';
  legacy.tools.webSearch = true;
  legacy.communication.teammateIds = ['editor'];
  const first = resolveAgentConfig(legacy);
  const second = resolveAgentConfig(legacy);
  assert.deepEqual(first.persona, defaultAgentPersona());
  assert.equal(first.instructions, legacy.instructions);
  assert.equal(first.reasoning, 'max');
  assert.equal(first.tools.webSearch, true);
  assert.deepEqual(first.communication.teammateIds, ['editor']);
  first.persona.values.push('Only the first employee');
  assert.equal(second.persona.values.includes('Only the first employee'), false);
  assert.equal(defaultAgentConfig().persona.values.includes('Only the first employee'), false);
});

test('a provided persona must validate fully instead of silently replacing user choices', () => {
  const config = defaultAgentConfig();
  for (const persona of [
    null,
    {},
    { ...config.persona, unknown: true },
    { ...config.persona, values: [' '] },
    { ...config.persona, purpose: 'x'.repeat(2001) },
    { ...config.persona, values: Array(21).fill('value') },
  ]) {
    assert.equal(AgentConfigSchema.safeParse({ ...config, persona }).success, false);
  }
  const empty = {
    purpose: '',
    values: [],
    communicationStyle: '',
    collaborationStyle: '',
    decisionStyle: '',
  };
  assert.deepEqual(resolveAgentConfig({ ...config, persona: empty }).persona, empty);
});

test('the runtime persona formatter includes all chosen dimensions and preserves permission boundaries', () => {
  const config = defaultAgentConfig();
  config.persona = {
    purpose: 'Deliver a reproducible analysis.',
    values: ['Source accuracy', 'Clear ownership'],
    communicationStyle: 'Give the headline followed by evidence.',
    collaborationStyle: 'Ask the editor to review ambiguous claims.',
    decisionStyle: 'Record alternatives and the reason for the choice.',
  };
  const text = formatAgentPersona(config);
  for (const value of [
    config.persona.purpose,
    ...config.persona.values,
    config.persona.communicationStyle,
    config.persona.collaborationStyle,
    config.persona.decisionStyle,
  ])
    assert.ok(text.includes(value));
  assert.match(text, /does not expand tool permissions, memory access, or run limits/);
  assert.equal(config.tools.webSearch, false);
});
