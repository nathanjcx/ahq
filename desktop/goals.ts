import { randomEmployeeAppearance } from '../src/lib/employeeAppearance';
import { randomUUID } from 'node:crypto';
import type { AppState, Commitment } from '../shared/types';

interface GoalDependencies {
  load(): Promise<AppState | null>;
  save(state: AppState, reason?: string, checkpoint?: boolean): Promise<void>;
  queue<T>(action: () => Promise<T>): Promise<T>;
  generate(state: AppState): Promise<Commitment[]>;
  advance(state: AppState): Promise<AppState>;
}

// Generation runs outside the disk queue; a newer goal always wins over a late result.
export class GoalCoordinator {
  private closed = false;
  constructor(private deps: GoalDependencies) {}
  close() {
    this.closed = true;
  }

  async create(goal: string, options?: { automatic?: boolean }): Promise<AppState> {
    const state = await this.deps.queue(async () => {
      const current = await this.deps.load();
      if (!current) throw new Error('Open your office first.');
      if (current.commitments.length > 980)
        throw new Error('The roadmap archive is full. Export your activity before starting a new workspace.');
      await this.deps.save(current, 'Before creating a roadmap', true);
      const now = new Date().toISOString();
      const next: AppState = {
        ...current,
        goal,
        demo: false,
        roadmap: {
          id: randomUUID(),
          automatic: options?.automatic === true,
          goal,
          status: 'planning',
          createdAt: now,
          message: 'Turning your goal into milestones and finding the right employees for each step.',
          milestoneIds: current.commitments
            .filter((c) => c.sessionId && c.status !== 'done')
            .map((c) => c.id),
          assignments: [],
        },
        events: [
          ...current.events,
          {
            id: randomUUID(),
            time: now,
            kind: 'system',
            source: 'local',
            text: `Set the goal and requested an AI roadmap: ${goal}`,
          },
        ],
      };
      await this.deps.save(next, 'Creating roadmap');
      return next;
    });
    void this.finish(state);
    return state;
  }

  private async finish(input: AppState) {
    try {
      const commitments = await this.deps.generate(input);
      if (this.closed) return;
      await this.deps.queue(async () => {
        if (this.closed) return;
        const current = await this.deps.load();
        if (
          !current?.roadmap ||
          current.roadmap.id !== input.roadmap!.id ||
          current.roadmap.status !== 'planning'
        )
          return;
        if (current.commitments.length + commitments.length > 1000)
          throw new Error(
            'There is not enough room for this roadmap. Your existing work is saved; use a new workspace for the next goal.',
          );
        const now = new Date().toISOString();
        const employees = [...current.employees];
        if (current.roadmap.automatic) {
          if (employees.length + commitments.length > 50)
            throw new Error('The office has no space for this roadmap’s workers.');
          for (const [index, task] of commitments.entries()) {
            const id = `demo-goal-${randomUUID()}`;
            employees.push({
              id,
              name: `${['Alex', 'Robin', 'Casey', 'Morgan', 'Taylor', 'Riley'][index]} · ${task.taskKind || 'analyst'}`,
              jobTitle: `Roadmap ${task.taskKind || 'analysis'} worker`,
              personality: 'Works from supplied files, checks results, and reports uncertainty.',
              skills: 'Astra session',
              status: 'ready',
              activity: 'Ready for the assigned roadmap step',
              location: 'desk',
              temporary: true,
              ...randomEmployeeAppearance(),
            });
            task.ownerId = id;
          }
        }
        const next: AppState = {
          ...current,
          employees,
          // Earlier roadmaps stay in storage and activity. The graph shows this goal's milestones.
          commitments: [...current.commitments, ...commitments],
          roadmap: {
            ...current.roadmap,
            milestoneIds: [...new Set([...current.roadmap.milestoneIds, ...commitments.map((c) => c.id)])],
            status: 'active',
            generatedAt: now,
            message: 'Your roadmap is ready. Delegating the first available steps.',
          },
          events: [
            ...current.events,
            {
              id: randomUUID(),
              time: now,
              kind: 'work',
              source: 'local',
              text: `Created and validated ${commitments.length} milestones in ${Math.max(0, (Date.parse(now) - Date.parse(current.roadmap.createdAt)) / 1000).toFixed(1)} seconds for “${current.goal}”.`,
            },
          ],
          messages: [
            ...current.messages,
            {
              id: randomUUID(),
              authorId: 'you',
              channel: 'team',
              time: now,
              text: `Our goal: ${current.goal}\nThe roadmap is ready with ${commitments.length} milestones. Employees will begin available steps and bring their work back for review.`,
            },
          ],
        };
        await this.deps.save(next, 'AI roadmap created', true);
        await this.deps.advance(next);
      });
    } catch (error) {
      if (this.closed) return;
      await this.deps
        .queue(async () => {
          const current = await this.deps.load();
          if (!current?.roadmap || current.roadmap.id !== input.roadmap!.id) return;
          // A dispatch failure must not discard a successfully generated plan.
          const message = error instanceof Error ? error.message : 'Please try again.';
          const next: AppState = {
            ...current,
            roadmap: {
              ...current.roadmap,
              status: current.roadmap.status === 'planning' ? 'failed' : 'paused',
              message,
            },
            events: [
              ...current.events,
              {
                id: randomUUID(),
                time: new Date().toISOString(),
                kind: 'system',
                source: 'local',
                text: `Roadmap paused: ${message}`,
              },
            ],
          };
          await this.deps.save(next, 'Roadmap needs attention');
        })
        .catch(() => undefined);
    }
  }
}
