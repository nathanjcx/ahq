import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceBoardChatter } from '../runtime/board-chatter';
import { initialSnapshot } from '../runtime/fixtures';

test('scripted conversations reply locally without creating work or triage', () => {
  const now = 45_000 * 40 + 44_000;
  const state = initialSnapshot(now);
  const workCount = state.work.length;
  assert.equal(advanceBoardChatter(state, now), true);
  const opening = state.board.at(-1)!;
  assert.equal(opening.simulated, true);
  assert.equal(advanceBoardChatter(state, now + 1000), false);
  assert.equal(advanceBoardChatter(state, now + 8000), true);
  const reply = state.board.at(-1)!;
  assert.equal(reply.replyTo, opening.id);
  assert.notEqual(reply.agentId, opening.agentId);
  assert.equal(advanceBoardChatter(state, now + 16000), false);
  assert.equal(state.work.length, workCount);
  assert.equal(state.triage.length, 0);
  for (let i = 1; i < 100; i++) advanceBoardChatter(state, now + i * 45_000);
  assert.ok(state.board.filter(post => post.kind === 'chatter').length <= 60);
  assert.ok(state.board.some(post => post.id === 'board-welcome-1'));
});

test('colleagues react once to a completed artifact and keep its real link', () => {
  const now = 45_000 * 40;
  const state = initialSnapshot(now);
  state.board.push({ id: 'real-completion', agentId: 'agent-maya', workId: 'work-welcome',
    artifactId: state.artifacts[0].id, kind: 'complete', text: 'Report ready.', timestamp: now - 6000 });
  assert.equal(advanceBoardChatter(state, now), true);
  const post = state.board.at(-1)!;
  assert.equal(post.replyTo, 'real-completion');
  assert.equal(post.artifactId, state.artifacts[0].id);
  assert.notEqual(post.agentId, 'agent-maya');
  assert.equal(post.simulated, true);
  advanceBoardChatter(state, now + 9000);
  assert.equal(state.board.filter(item => item.replyTo === 'real-completion').length, 1);
});
