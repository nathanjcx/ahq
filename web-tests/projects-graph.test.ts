import { describe, expect, it } from 'vitest';
import {
  assertAcyclic,
  dependentsOf,
  milestoneStatus,
  readyToStart,
  topologicalOrder,
} from '../convex/lib/dependencies';
import { bottleneckPrompts, meetingRequests, parseProposal } from '../convex/lib/projects';
import type { RoadmapProposal } from '../lib/contracts';

const DAY = 24 * 60 * 60 * 1_000;
const estimate = { workingHours: 4, tokens: 1_000, confidence: 0.3, model: 'gpt-5.6-terra' as const };

function roadmap(overrides: Partial<RoadmapProposal> = {}): RoadmapProposal {
  return {
    staffing: [{ floorId: 'floor-1', employeeIds: ['employee-1'], suggestedHires: [] }],
    milestones: [
      {
        key: 'm1',
        title: 'Launch page',
        description: 'Ship the page.',
        dependsOn: [],
        tasks: [
          {
            key: 't1',
            title: 'Draft copy',
            prompt: 'Draft the copy.',
            employeeId: 'employee-1',
            floorId: 'floor-1',
            dependsOn: [],
            estimate,
          },
        ],
      },
    ],
    meetings: [{ title: 'Kickoff', startsAt: DAY, purpose: 'Agree the plan.', milestoneKey: 'm1' }],
    prompts: [],
    projectedTokens: 1_000,
    ...overrides,
  };
}

describe('dependency graph', () => {
  it('orders work dependency-first and rejects cycles', () => {
    const nodes = [
      { id: 'c', dependsOn: ['b'] },
      { id: 'b', dependsOn: ['a'] },
      { id: 'a', dependsOn: ['outside the set'] },
    ];
    expect(topologicalOrder(nodes)).toEqual(['a', 'b', 'c']);
    expect(() => assertAcyclic(nodes)).not.toThrow();
    expect(() => assertAcyclic([...nodes, { id: 'a', dependsOn: ['c'] }])).toThrow(
      'Dependency cycle through c, b, a',
    );
    expect(() => assertAcyclic([{ id: 'a', dependsOn: ['a'] }])).toThrow('Dependency cycle');
  });

  it('starts a task only when every dependency it names has completed', () => {
    const statuses = new Map([
      ['a', { status: 'completed' }],
      ['b', { status: 'running' }],
    ]);
    expect(readyToStart({ id: 'c' }, statuses)).toBe(true);
    expect(readyToStart({ id: 'c', dependsOn: ['a'] }, statuses)).toBe(true);
    expect(readyToStart({ id: 'c', dependsOn: ['a', 'b'] }, statuses)).toBe(false);
    // A dependency that is no longer there is not a completed one.
    expect(readyToStart({ id: 'c', dependsOn: ['gone'] }, statuses)).toBe(false);
  });

  it('finds the tasks waiting on one task', () => {
    const tasks = [
      { id: 'a', dependsOn: [] },
      { id: 'b', dependsOn: ['a'] },
      { id: 'c', dependsOn: ['a', 'b'] },
    ];
    expect(dependentsOf('a', tasks).map((task) => task.id)).toEqual(['b', 'c']);
    expect(dependentsOf('c', tasks)).toEqual([]);
  });

  it('reads milestone status from the work rather than from the row', () => {
    const milestone = { taskIds: ['a', 'b'] };
    const status = (a: string, b: string) =>
      milestoneStatus(milestone, [
        { id: 'a', status: a },
        { id: 'b', status: b },
        { id: 'other', status: 'running' },
      ]);
    expect(milestoneStatus({ taskIds: [] }, [])).toBe('planned');
    expect(status('waiting', 'queued')).toBe('planned');
    expect(status('running', 'waiting')).toBe('active');
    expect(status('completed', 'queued')).toBe('active');
    expect(status('completed', 'cancelled')).toBe('done');
  });
});

describe('roadmap proposals', () => {
  it('checks the shape of a planner answer before it is stored', () => {
    expect(parseProposal(roadmap())).toMatchObject({ projectedTokens: 1_000 });
    expect(() => parseProposal({ ...roadmap(), milestones: 'soon' })).toThrow('milestones must be an array');
    expect(() => parseProposal({ ...roadmap(), projectedTokens: 'many' })).toThrow(
      'projectedTokens must be a number',
    );
    const badModel = roadmap();
    badModel.milestones[0].tasks[0].estimate = { ...estimate, model: 'gpt-4' as never };
    expect(() => parseProposal(badModel)).toThrow('estimate.model must be one of');
    expect(() => parseProposal('a roadmap')).toThrow('Proposal must be an object');
  });

  it('turns proposed meetings into calendar requests with an end time', () => {
    expect(meetingRequests(roadmap())).toEqual([
      {
        title: 'Kickoff',
        startsAt: DAY,
        endsAt: DAY + 30 * 60_000,
        purpose: 'Agree the plan.',
        milestoneKey: 'm1',
      },
    ]);
  });

  it('asks about floors with more work than instances and deadlines before their dependencies', () => {
    const proposal = roadmap();
    const [milestone] = proposal.milestones;
    milestone.deadlineAt = 10 * DAY;
    milestone.dependsOn = ['m0'];
    proposal.milestones.unshift({
      key: 'm0',
      title: 'Research',
      description: 'Read the market.',
      deadlineAt: 20 * DAY,
      dependsOn: [],
      tasks: [],
    });
    milestone.tasks[0].deadlineAt = 30 * DAY;
    milestone.tasks.push({
      key: 't2',
      title: 'Design page',
      prompt: 'Design the page.',
      employeeId: 'employee-1',
      floorId: 'floor-1',
      dependsOn: [],
      deadlineAt: 30 * DAY + 60_000,
      estimate,
    });
    milestone.tasks.push({
      key: 't3',
      title: 'Write tests',
      prompt: 'Write the tests.',
      employeeId: 'employee-1',
      floorId: 'floor-1',
      dependsOn: ['t2'],
      deadlineAt: 29 * DAY,
      estimate,
    });
    const prompts = bottleneckPrompts(proposal, [{ floorId: 'floor-1', name: 'Marketing', instances: 2 }]);
    expect(prompts).toEqual([
      {
        kind: 'capacity',
        text: 'Marketing has 3 tasks due in the week of 1970-01-29 and 2 instance(s). Hire more or move the deadline.',
      },
      {
        kind: 'deadline',
        text: '"Write tests" is due before "Design page", which it depends on. Move one of the deadlines.',
      },
      {
        kind: 'deadline',
        text: 'Milestone "Launch page" is due before "Research", which it depends on. Move one of the deadlines.',
      },
    ]);
    // Three instances cover the same week, so only the deadline questions remain.
    expect(
      bottleneckPrompts(proposal, [{ floorId: 'floor-1', name: 'Marketing', instances: 3 }]).every(
        (prompt) => prompt.kind === 'deadline',
      ),
    ).toBe(true);
  });
});
