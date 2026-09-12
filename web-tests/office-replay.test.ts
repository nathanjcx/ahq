import { describe, expect, it } from 'vitest';
import type { AuditTimeline } from '../lib/contracts';
import { entryAt, sceneAt } from '../components/floors/floor-replay';

const START = 1_700_000_000_000;
const at = (seconds: number) => START + seconds * 1000;

const timeline: AuditTimeline = {
  task: {
    id: 'tsk_1',
    title: 'Draft the release note',
    employeeName: 'Ada',
    status: 'completed',
    createdAt: START,
    createdByName: 'Sam',
  },
  entries: [
    {
      kind: 'event',
      id: 'e1',
      at: at(0),
      type: 'agent.session.turn.created',
      text: 'Employee started a turn.',
    },
    {
      kind: 'tool_call',
      id: 't1',
      at: at(10),
      operationId: 'op1',
      connectionId: 'con_1',
      provider: 'linear',
      tool: 'linear_list_issues',
      outcome: 'started',
    },
    {
      kind: 'tool_call',
      id: 't2',
      at: at(14),
      operationId: 'op1',
      connectionId: 'con_1',
      provider: 'linear',
      tool: 'linear_list_issues',
      outcome: 'succeeded',
    },
    {
      kind: 'proposal',
      id: 'p1',
      at: at(20),
      tool: 'linear_create_issue',
      provider: 'linear',
      summary: 'Create the release issue',
      status: 'approved',
      correction: 'supported',
      arguments: {},
      transitions: [{ to: 'approved', actor: 'user_1', at: at(40) }],
    },
    {
      kind: 'message',
      id: 'm1',
      at: at(50),
      role: 'assistant',
      text: 'The release note is ready. See the draft.',
    },
  ],
};

const activityAt = (seconds: number) => sceneAt(timeline, 'emp_ada', at(seconds)).activities.get('emp_ada');

describe('replaying a task', () => {
  it('reenacts the recorded turn, tool call and review in order', () => {
    expect(activityAt(1)?.activity).toBe('thinking');
    expect(activityAt(11)).toMatchObject({ activity: 'calling', tool: 'linear_list_issues' });
    expect(activityAt(16)?.activity).toBe('reading');
    // The proposal is still pending at 30s, so the figure is waiting for a decision.
    expect(activityAt(30)?.activity).toBe('reviewing');
    // Once it is approved and the last message lands, the task reads as done.
    expect(activityAt(50)).toMatchObject({ activity: 'celebrating' });
  });

  it('collects the providers the task actually called', () => {
    expect(sceneAt(timeline, 'emp_ada', at(5)).providers).toEqual([]);
    expect(sceneAt(timeline, 'emp_ada', at(12)).providers).toMatchObject([{ id: 'linear', name: 'Linear' }]);
  });

  it('shows the last message as the bubble while it is fresh', () => {
    expect(activityAt(50)?.bubble).toBe('The release note is ready.');
  });

  it('names the entry the scrubber is sitting on', () => {
    expect(entryAt(timeline, at(0))).toBe('Employee started a turn.');
    expect(entryAt(timeline, at(12))).toBe('linear_list_issues: started');
    expect(entryAt(timeline, at(21))).toBe('Proposed linear_create_issue: Create the release issue');
    expect(entryAt(timeline, at(-5))).toBe('');
  });
});
