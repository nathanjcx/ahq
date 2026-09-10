import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, isState, folderBrief } from '../src/lib/store';
import { applyDecision, applySession } from '../src/lib/workflow';
import type { CloudSession } from '../shared/types';

test('the starter workspace is valid and explicitly marked as a sample', () => {
  const state = initialState();
  assert.equal(isState(state), true);
  assert.equal(state.demo, true);
  assert.equal(
    state.employees.some((e) => e.sessionId),
    false,
  );
  assert.equal(
    state.events.every((e) => e.source === 'example'),
    true,
  );
});
test('malformed stored profiles are rejected before rendering', () => {
  assert.equal(isState({ ...initialState(), employees: [{ name: null }] }), false);
  assert.equal(isState({ ...initialState(), schemaVersion: 8 }), false);
});
test('approval completes its linked promise exactly once and preserves other work', () => {
  const state = initialState();
  const result = applyDecision(state, 'a1', 1, 'approved');
  assert.equal(result.approvals[0].status, 'approved');
  assert.equal(result.commitments[0].status, 'done');
  assert.equal(result.commitments[0].progress, 100);
  assert.deepEqual(result.commitments[1], state.commitments[1]);
  assert.equal(result.events.length, state.events.length + 1);
  assert.throws(() => applyDecision(result, 'a1', 1, 'approved'), /no longer current/);
  assert.equal(state.approvals[0].status, 'pending');
});
test('a stale version cannot authorize a changed deliverable', () => {
  assert.throws(() => applyDecision(initialState(), 'a1', 2, 'approved'), /no longer current/);
});
test('feedback reopens the linked commitment without fabricating cloud execution', () => {
  const state = applyDecision(initialState(), 'a1', 1, 'changes-requested', 'Verify the lead times.');
  assert.equal(state.commitments[0].status, 'in-progress');
  assert.equal(state.commitments[0].nextStep, 'Verify the lead times.');
  assert.equal(state.employees[0].status, 'ready');
  assert.match(state.messages.at(-1)!.text, /Verify the lead times/);
  assert.throws(() => applyDecision(initialState(), 'a1', 1, 'changes-requested'), /include the changes/);
});
const session: CloudSession = {
  id: 'session-1',
  status: 'waiting_for_approval',
  activity: 'The client draft is ready.',
  location: 'desk',
  events: [
    { id: 'event-1', text: 'Prepared a draft from the selected files.', time: new Date().toISOString() },
  ],
  output: {
    title: 'Weekly update',
    content: '# Reviewed facts',
    recipient: 'Internal draft review',
    sources: ['notes.md'],
    version: 1,
  },
};
test('cloud events and outputs are idempotent across polling and restart recovery', () => {
  const one = applySession(initialState(), 'maya', session);
  const two = applySession(JSON.parse(JSON.stringify(one)), 'maya', session);
  assert.deepEqual(two, one);
  assert.equal(two.events.filter((e) => e.id === 'session-1:event-1').length, 1);
  assert.equal(two.approvals.filter((a) => a.sessionId === 'session-1').length, 1);
  assert.equal(two.employees[0].status, 'review');
  assert.equal(two.messages.at(-1)?.text, session.events[0].text);
});
test('a newer output supersedes its pending version; a late old version cannot overwrite it', () => {
  const one = applySession(initialState(), 'maya', session);
  const newer = { ...session, output: { ...session.output!, version: 2, content: '# Revised facts' } };
  const two = applySession(one, 'maya', newer);
  assert.equal(
    two.approvals.find((a) => a.sessionId === 'session-1' && a.version === 1)?.status,
    'changes-requested',
  );
  assert.equal(two.approvals.find((a) => a.sessionId === 'session-1' && a.version === 2)?.status, 'pending');
  const three = applySession(two, 'maya', session);
  assert.equal(three.approvals.filter((a) => a.sessionId === 'session-1').length, 2);
});
test('a local folder brief identifies its source and does not claim AI analysis or upload', () => {
  const brief = folderBrief({
    id: crypto.randomUUID(),
    name: 'Project',
    createdAt: new Date().toISOString(),
    files: [{ path: 'notes.md', size: 22, excerpt: '# The next milestone' }],
    excludedCount: 2,
  });
  assert.match(brief, /source inventory, not an AI-generated analysis/);
  assert.match(brief, /No files have been uploaded/);
  assert.match(brief, /notes.md/);
  assert.match(brief, /The next milestone/);
});

test('duplicate events in one gateway response appear only once', () => {
  const result = applySession(initialState(), 'maya', {
    ...session,
    events: [session.events[0], session.events[0]],
  });
  assert.equal(result.events.filter((e) => e.id === 'session-1:event-1').length, 1);
});

test('final employee replies reach the direct conversation once, including automatic completion', () => {
  const completed: CloudSession = {
    ...session,
    status: 'completed',
    reviewed: true,
    output: { ...session.output!, recipient: 'You' },
  };
  const result = applySession(initialState(), 'maya', completed);
  assert.equal(result.employees[0].status, 'ready');
  assert.equal(
    result.messages.filter(
      (message) => message.channel === 'maya' && message.text === completed.output!.content,
    ).length,
    1,
  );
  assert.equal(result.approvals.find((item) => item.sessionId === session.id)?.status, 'approved');
  assert.deepEqual(applySession(result, 'maya', completed), result);
});

test('tool permission requests stay distinct from employee replies and cancellation clears a pending review', () => {
  const permission: CloudSession = {
    ...session,
    output: { ...session.output!, recipient: 'Astra HQ workspace' },
  };
  const pending = applySession(initialState(), 'maya', permission);
  assert.equal(
    pending.messages.some(
      (message) => message.channel === 'maya' && message.text === permission.output!.content,
    ),
    false,
  );
  assert.equal(pending.approvals.find((item) => item.sessionId === session.id)?.kind, 'decision');
  const cancelled = applySession(pending, 'maya', {
    ...permission,
    status: 'cancelled',
    output: undefined,
    activity: 'Stopped by you',
  });
  assert.equal(cancelled.employees[0].status, 'ready');
  assert.equal(
    cancelled.approvals.find((item) => item.sessionId === session.id)?.status,
    'changes-requested',
  );
});
