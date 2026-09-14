import { describe, expect, it } from 'vitest';
import type { ActionProposal, Task } from '../lib/contracts';
import { buildThreads } from '../lib/work';

const now = new Date('2026-09-14T15:00:00Z').getTime();
function task(over: Partial<Task>): Task {
  return {
    id: 't1',
    employeeId: 'e1',
    employeeName: 'Elena',
    createdBy: 'u',
    createdByName: 'Spencer',
    isOwner: true,
    visibility: 'private',
    title: 'Flyer',
    prompt: 'Make a flyer',
    status: 'running',
    createdAt: now - 60_000,
    updatedAt: now - 30_000,
    model: 'gpt-5.6-terra',
    ...over,
  };
}
const proposal: ActionProposal = {
  id: 'p1',
  taskId: 't1',
  connectionId: 'c1',
  employeeName: 'Elena',
  provider: 'google-workspace',
  tool: 'create_draft',
  arguments: '{}',
  summary: 'Create a draft',
  status: 'pending',
  correction: 'manual',
  correctionReason: '',
  createdAt: now,
  canDecide: true,
};

describe('the work stream', () => {
  it('puts approvals, questions, and incidents first, then running, waiting, and done', () => {
    const threads = buildThreads({
      tasks: [
        task({ id: 't1' }),
        task({
          id: 't2',
          status: 'needs_input',
          updatedAt: now - 10_000,
          question: { text: 'Which price goes on it?', askedAt: now },
        }),
        task({ id: 't3', status: 'queued' }),
        task({ id: 't4', status: 'waiting' }),
        task({ id: 't5', status: 'completed', updatedAt: now - 1000 }),
        task({ id: 't6', status: 'completed', updatedAt: now - 2 * 86_400_000 }),
        task({ id: 't7', kind: 'meeting' }),
      ],
      proposals: [proposal],
      handoffs: [],
      alerts: [],
      now,
    });
    expect(threads.map((thread) => [thread.id, thread.group, thread.label])).toEqual([
      ['task:t2', 'needs', 'Question for you'],
      ['task:t1', 'needs', 'Approval'],
      ['task:t3', 'running', 'Starting'],
      ['task:t4', 'waiting', 'Waiting on a task'],
      ['task:t5', 'done', 'Done'],
    ]);
  });

  it('lists a pending handoff and an open incident as things that need a person', () => {
    const threads = buildThreads({
      tasks: [],
      proposals: [],
      handoffs: [
        {
          id: 'h1',
          floorId: 'f',
          floorName: 'Launch',
          fromName: 'Dana',
          toEmployeeId: 'e2',
          toEmployeeName: 'Bruno',
          brief: 'Take it on',
          createdAt: now,
        },
      ],
      alerts: [
        {
          id: 'a1',
          source: 'github',
          fingerprint: 'x',
          severity: 'high',
          title: 'Checkout down',
          detail: 'timeouts',
          status: 'open',
          affectedFloorIds: [],
          occurrences: 3,
          paging: { attempts: 0, delivered: 0, acknowledged: false },
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'a2',
          source: 'github',
          fingerprint: 'y',
          severity: 'low',
          title: 'Old',
          detail: '',
          status: 'closed',
          affectedFloorIds: [],
          occurrences: 1,
          paging: { attempts: 0, delivered: 0, acknowledged: false },
          createdAt: now,
          updatedAt: now,
        },
      ] as never,
      now,
    });
    expect(threads.map((thread) => thread.kind)).toEqual(['handoff', 'alert']);
    expect(threads.every((thread) => thread.group === 'needs')).toBe(true);
  });
});

describe('a running thread', () => {
  it('previews the newest journal line rather than the last message', () => {
    const threads = buildThreads({
      tasks: [
        task({ id: 't1', status: 'running', lastMessage: { text: 'Starting.', createdAt: now - 5000 } }),
      ],
      proposals: [],
      handoffs: [],
      alerts: [],
      events: [
        {
          id: 'e1',
          sequence: 1,
          taskId: 't1',
          type: 'tool.call',
          text: 'Searching Drive',
          createdAt: now - 4000,
        },
        {
          id: 'e2',
          sequence: 2,
          taskId: 't1',
          type: 'tool.call',
          text: 'Reading the roster',
          createdAt: now - 1000,
        },
        { id: 'e3', sequence: 3, taskId: 'other', type: 'tool.call', text: 'Elsewhere', createdAt: now },
      ],
      now,
    });
    expect(threads[0].preview).toBe('Reading the roster');
  });
});
