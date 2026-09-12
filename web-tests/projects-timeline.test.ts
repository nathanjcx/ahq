import { describe, expect, it } from 'vitest';
import {
  answerPrompt,
  proposalTotals,
  removeMilestone,
  removeTask,
  shiftDeadlines,
} from '../components/projects/proposal';
import { dependencyEdges, fraction, proposalTimeline, ROW_HEIGHT } from '../components/projects/roadmap';
import type { RoadmapProposal } from '../lib/contracts';

const DAY = 86_400_000;
const day = Math.floor(Date.now() / DAY) * DAY;
const estimate = { workingHours: 8, tokens: 1_000, confidence: 0.4, model: 'gpt-5.6-terra' as const };

function proposal(): RoadmapProposal {
  return {
    staffing: [{ floorId: 'floor_a', employeeIds: ['emp_one'], suggestedHires: [] }],
    milestones: [
      {
        key: 'm1',
        title: 'First',
        description: 'Open the work.',
        deadlineAt: day + 5 * DAY,
        dependsOn: [],
        tasks: [
          {
            key: 'draft',
            title: 'Draft',
            prompt: 'Draft it.',
            employeeId: 'emp_one',
            floorId: 'floor_a',
            dependsOn: [],
            deadlineAt: day + 4 * DAY,
            estimate,
          },
        ],
      },
      {
        key: 'm2',
        title: 'Second',
        description: 'Close the work.',
        deadlineAt: day + 12 * DAY,
        dependsOn: ['m1'],
        tasks: [
          {
            key: 'review',
            title: 'Review',
            prompt: 'Review it.',
            employeeId: 'emp_two',
            floorId: 'floor_b',
            dependsOn: ['draft'],
            deadlineAt: day + 11 * DAY,
            estimate,
          },
        ],
      },
    ],
    meetings: [{ title: 'Kickoff', startsAt: day + DAY, purpose: 'Agree the plan.' }],
    prompts: [{ kind: 'capacity', text: 'Floor A is short an instance.' }],
    projectedTokens: 2_000,
  };
}

const names = {
  floor: (id: string) => (id === 'floor_a' ? 'Floor A' : 'Floor B'),
  employee: (id?: string) => (id === 'emp_one' ? 'One' : 'Two'),
};

describe('the roadmap timeline', () => {
  it('puts one row under each floor per instance, and every milestone on the axis', () => {
    const timeline = proposalTimeline(proposal(), names);
    expect(timeline.rows.map((row) => [row.floorName, row.employeeName, row.firstOfFloor])).toEqual([
      ['Floor A', 'One', true],
      ['Floor B', 'Two', true],
    ]);
    expect(timeline.height).toBe(2 * ROW_HEIGHT);
    expect(timeline.markers.map((marker) => marker.title)).toEqual(['1. First', '2. Second']);
    // Every bar and marker sits inside the axis, with a margin at each end.
    for (const marker of timeline.markers) {
      expect(fraction(timeline, marker.at)).toBeGreaterThan(0);
      expect(fraction(timeline, marker.at)).toBeLessThan(1);
    }
  });

  it('strings a task to the work it waits for, from the row it is on', () => {
    const timeline = proposalTimeline(proposal(), names);
    const [edge, ...rest] = dependencyEdges(timeline);
    expect(rest).toEqual([]);
    expect(edge.key).toBe('draft-review');
    expect(edge.y1).toBe(ROW_HEIGHT / 2);
    expect(edge.y2).toBe(ROW_HEIGHT + ROW_HEIGHT / 2);
    expect(edge.x1).toBeLessThan(edge.x2);
  });
});

describe('editing a proposal', () => {
  it('moves every deadline and meeting together', () => {
    const moved = shiftDeadlines(proposal(), 7);
    expect(moved.milestones.map((milestone) => milestone.deadlineAt)).toEqual([
      day + 12 * DAY,
      day + 19 * DAY,
    ]);
    expect(moved.milestones[0].tasks[0].deadlineAt).toBe(day + 11 * DAY);
    expect(moved.meetings[0].startsAt).toBe(day + 8 * DAY);
  });

  it('drops the dependencies on work it removes', () => {
    expect(removeTask(proposal(), 'draft').milestones[1].tasks[0].dependsOn).toEqual([]);
    const left = removeMilestone(proposal(), 'm1');
    expect(left.milestones).toHaveLength(1);
    expect(left.milestones[0].dependsOn).toEqual([]);
    expect(left.milestones[0].tasks[0].dependsOn).toEqual([]);
  });

  it('counts the work and answers a question', () => {
    expect(proposalTotals(proposal())).toMatchObject({
      milestones: 2,
      tasks: 2,
      workingHours: 16,
      floorIds: ['floor_a', 'floor_b'],
    });
    expect(answerPrompt(proposal(), 0).prompts).toEqual([]);
  });
});
