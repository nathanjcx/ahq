import { describe, expect, it } from 'vitest';
import { deriveScene } from '@/components/office/office-stage';
import { emptyDashboard, type Dashboard, type ScheduleSummary, type Task } from '@/lib/contracts';

/**
 * What one live floor shows. This is the derivation every room in the tower runs
 * on, so the things the plan promises a floor — its board, its binder, the hour it
 * is, and the workspace's own hours — have to come out of it.
 */
const NOW = Date.UTC(2026, 8, 9, 21, 30);
const FLOOR = 'flr_1';

function task(entry: Partial<Task> & Pick<Task, 'id' | 'employeeId' | 'status'>): Task {
  return {
    floorId: FLOOR,
    employeeName: 'Ada',
    createdBy: 'user_sam',
    createdByName: 'Sam',
    isOwner: true,
    visibility: 'workspace',
    title: 'Draft the release note',
    prompt: '',
    createdAt: NOW - 3_600_000,
    updatedAt: NOW - 3_600_000,
    model: 'gpt-6-astra',
    ...entry,
  };
}

const schedule: ScheduleSummary = {
  timezone: 'Europe/London',
  workingDays: [1, 2, 3, 4, 5],
  startHour: 9,
  endHour: 18,
  attendedStartHour: 9,
  attendedEndHour: 18,
  overnightPolicy: 'cheap',
  working: false,
  attended: false,
  usageToday: { input: 0, output: 0, cached: 0, cap: 0 },
};

const employees = [
  { id: 'emp_ada', name: 'Ada' },
  { id: 'emp_bruno', name: 'Bruno' },
];

function dashboard(extra: Partial<Dashboard> = {}): Dashboard {
  return { ...emptyDashboard, ...extra };
}

describe('deriveScene', () => {
  it('builds the wall board from the floor’s own work, and nothing else', () => {
    const scene = deriveScene({
      dashboard: dashboard({
        tasks: [
          task({ id: 'tsk_1', employeeId: 'emp_ada', status: 'running' }),
          task({ id: 'tsk_2', employeeId: 'emp_bruno', status: 'waiting', dependsOn: ['tsk_1'] }),
          task({ id: 'tsk_3', employeeId: 'emp_ada', status: 'cancelled' }),
          task({ id: 'tsk_4', employeeId: 'emp_ada', status: 'running', kind: 'audit' }),
          task({ id: 'tsk_other', employeeId: 'emp_ada', status: 'running', floorId: 'flr_2' }),
        ],
      }),
      posts: [],
      employees,
      floorId: FLOOR,
      now: NOW,
    });
    expect(scene.board?.cards.map((card) => [card.id, card.status])).toEqual([
      ['tsk_1', 'active'],
      ['tsk_2', 'waiting'],
    ]);
    expect(scene.board?.cards[1].dependsOn).toEqual(['tsk_1']);
  });

  it('leaves the lobby without a board, since unassigned work is on no wall', () => {
    const scene = deriveScene({
      dashboard: dashboard({
        tasks: [task({ id: 'tsk_1', employeeId: 'emp_ada', status: 'running', floorId: undefined })],
      }),
      posts: [],
      employees,
      now: NOW,
      room: 'lobby',
      calendar: [{ at: '09:00', label: 'Ada · release shift' }],
    });
    expect(scene.board).toBeUndefined();
    expect(scene.room).toBe('lobby');
    expect(scene.calendar).toHaveLength(1);
  });

  it('reads the hour off the clock, so the daylight follows it', () => {
    const scene = deriveScene({ dashboard: dashboard(), posts: [], employees, now: NOW });
    expect(scene.hour).toBe(new Date(NOW).getHours());
  });

  it('puts the workspace’s hours in the day, which is what makes somebody off shift', () => {
    const scene = deriveScene({
      dashboard: dashboard({ schedule }),
      posts: [],
      employees,
      floorId: FLOOR,
      now: NOW,
    });
    expect(scene.schedule).toEqual({ working: false, attended: false, overnightCheap: true });
    expect(scene.activities.get('emp_ada')?.activity).toBe('off_shift');
  });

  it('writes the day’s report at the end of a shift, rather than typing', () => {
    const shift = task({
      id: 'tsk_shift',
      employeeId: 'emp_ada',
      status: 'running',
      lastMessage: { text: 'Three blockers closed; the pricing page is still open.', createdAt: NOW },
    });
    const scene = deriveScene({
      dashboard: dashboard({ schedule, tasks: [shift] }),
      posts: [],
      employees,
      floorId: FLOOR,
      now: NOW,
      day: { shifts: [{ employeeId: 'emp_ada', taskId: 'tsk_shift', startedAt: NOW - 7_200_000 }] },
    });
    expect(scene.activities.get('emp_ada')?.activity).toBe('reporting');
  });
});
