import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeWorkspace } from '../shared/workspaceMerge';
import { initialState, sampleState } from '../src/lib/store';
import type { AppState } from '../shared/types';

function fixture(): AppState {
  const employee = { ...sampleState().employees[0], sessionId: 'chatgpt-new', status: 'working' as const };
  const commitment = {
    ...sampleState().commitments[0],
    id: 'step',
    ownerId: employee.id,
    status: 'review' as const,
    progress: 90,
  };
  return {
    ...initialState(),
    goal: 'Current goal',
    employees: [employee],
    commitments: [commitment],
    roadmap: {
      id: '4bdbd4a2-9319-4458-98c8-617366e07d31',
      goal: 'Current goal',
      status: 'active',
      message: 'Working',
      createdAt: new Date().toISOString(),
      milestoneIds: ['step'],
      assignments: [
        { commitmentId: 'step', employeeId: employee.id, sessionId: 'chatgpt-new', status: 'assigned' },
      ],
    },
    approvals: [
      {
        ...sampleState().approvals[0],
        id: 'review',
        employeeId: employee.id,
        sessionId: 'chatgpt-new',
        commitmentId: 'step',
        status: 'approved',
        version: 1,
      },
    ],
  };
}
test('late renderer save cannot erase a new roadmap or roll back its session and review', () => {
  const current = fixture();
  const old = {
    ...current,
    goal: 'Old goal',
    roadmap: undefined,
    commitments: [],
    employees: current.employees.map((e) => ({ ...e, name: 'Edited name', sessionId: 'chatgpt-old' })),
    approvals: current.approvals.map((a) => ({ ...a, status: 'pending' as const, commitmentId: undefined })),
  };
  const merged = mergeWorkspace(current, old);
  assert.equal(merged.goal, current.goal);
  assert.deepEqual(merged.roadmap, current.roadmap);
  assert.equal(merged.commitments[0].status, 'review');
  assert.equal(merged.employees[0].name, 'Edited name');
  assert.equal(merged.employees[0].sessionId, 'chatgpt-new');
  assert.equal(merged.approvals[0].status, 'approved');
  assert.equal(merged.approvals[0].commitmentId, 'step');
});
test('editing a dispatched step preserves backend progress and adds new manual milestones to the active graph', () => {
  const current = fixture();
  const edited = {
    ...current,
    commitments: [
      { ...current.commitments[0], title: 'Clearer title', status: 'planned' as const, progress: 0 },
      { ...current.commitments[0], id: 'extra', status: 'planned' as const },
    ],
  };
  const merged = mergeWorkspace(current, edited);
  assert.equal(merged.commitments.find((c) => c.id === 'step')!.title, 'Clearer title');
  assert.equal(merged.commitments.find((c) => c.id === 'step')!.progress, 90);
  assert.deepEqual(merged.roadmap!.milestoneIds, ['step', 'extra']);
});
test('late saves cannot resurrect a stopped session after an explicit retry clears it', () => {
  const stale = fixture();
  const reset = {
    ...stale,
    employees: stale.employees.map((e) => ({ ...e, sessionId: undefined, status: 'ready' as const })),
  };
  assert.equal(mergeWorkspace(reset, stale).employees[0].sessionId, undefined);
});
test('restored review entries cannot regain their old session from a delayed save', () => {
  const stale = fixture();
  const restored = {
    ...stale,
    employees: stale.employees.map((e) => ({ ...e, sessionId: undefined, status: 'ready' as const })),
    approvals: stale.approvals.map((a) => ({ ...a, sessionId: undefined })),
  };
  const merged = mergeWorkspace(restored, stale);
  assert.equal(merged.approvals[0].sessionId, undefined);
});

test('manual assignments retain session progress through stale saves without an AI roadmap', () => {
  const input = fixture();
  const current: AppState = {
    ...input,
    roadmap: undefined,
    commitments: [
      { ...input.commitments[0], sessionId: 'chatgpt-new', assignment: 'The full original request' },
    ],
  };
  const stale: AppState = {
    ...current,
    commitments: [
      {
        ...current.commitments[0],
        title: 'Edited title',
        assignment: undefined,
        sessionId: 'chatgpt-old',
        status: 'planned',
        progress: 0,
      },
    ],
  };
  const task = mergeWorkspace(current, stale).commitments[0];
  assert.equal(task.title, 'Edited title');
  assert.equal(task.assignment, 'The full original request');
  assert.equal(task.sessionId, 'chatgpt-new');
  assert.equal(task.status, 'review');
  assert.equal(task.progress, 90);
  assert.deepEqual(mergeWorkspace(current, { ...stale, commitments: [] }).commitments, current.commitments);
});

test('restored manual tasks cannot reconnect to old sessions through a delayed save', () => {
  const input = fixture();
  const stale: AppState = {
    ...input,
    commitments: [{ ...input.commitments[0], sessionId: 'chatgpt-old', assignment: 'Saved task' }],
  };
  const restored: AppState = { ...stale, commitments: [{ ...stale.commitments[0], sessionId: undefined }] };
  assert.equal(mergeWorkspace(restored, stale).commitments[0].sessionId, undefined);
});
