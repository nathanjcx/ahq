import type { RoadmapProposal } from '../../../lib/contracts';
import { mutate, query } from '../../../lib/server/backend';
import { untrustedJson } from '../../../lib/server/untrusted';
import { GatewayError } from '../../gateway/errors';
import type { Job } from '../../types';
import type { WorkerRuntime } from '../state';
import { parseJsonAnswer, payload, runBareTurn, taskContext } from './context';

const SHAPE = `{
  "staffing": [{"floorId":"…","employeeIds":["…"],"suggestedHires":[{"versionId":"…","count":1,"reason":"…"}]}],
  "milestones": [{
    "key":"m1","title":"…","description":"…","deadlineAt":0,"dependsOn":[],
    "tasks":[{"key":"t1","title":"…","prompt":"…","employeeId":"…","floorId":"…","dependsOn":[],"deadlineAt":0,
              "estimate":{"workingHours":0,"tokens":0,"confidence":0,"model":"…"}}]
  }],
  "meetings": [{"title":"…","startsAt":0,"purpose":"…","milestoneKey":"m1"}],
  "prompts": [{"kind":"capacity|deadline|order|cost","text":"…"}],
  "projectedTokens": 0
}`;

/**
 * The planner turn for one project.
 *
 * A pure model call: it reads the brief, the floors and their instances, what that kind of work has
 * cost before, and the memory the workspace has already agreed on, and answers with a roadmap. It
 * creates nothing. `recordProposal` validates the shape and adds the bottleneck questions the
 * platform can work out for itself; a person edits and confirms before any of it exists.
 */
export async function planProject(runtime: WorkerRuntime, job: Job) {
  const input = payload(job);
  if (!input.projectId)
    throw new GatewayError('invalid_arguments', 'A planner run needs the project it plans.');
  const context = await taskContext(job.taskId);
  const inputs = await query<{ project: { name: string; brief: string } } & Record<string, unknown>>(
    'services/projects:plannerInputs',
    { projectId: input.projectId },
  );
  const result = await runBareTurn(runtime, job, context, {
    servers: [],
    ...(input.model ? { model: input.model } : {}),
    instructions:
      'You plan projects for this workspace. You propose a roadmap and nothing else: you do not create tasks, hire anyone, or change a schedule. A person edits your proposal and confirms it.',
    brief: [
      'Propose a roadmap for this project: which instances on which floors do the work, milestones with deadlines, the tasks under each milestone with their dependencies, the meeting points, and what you expect it to cost.',
      'The project, its floors and their instances, what their work has cost before, and the memory this workspace has agreed on',
      untrustedJson(inputs),
      'Estimate from the history you were given. Where there is none, use what you know of the model and say so in the estimate’s confidence. Raise a prompt wherever the plan is tight rather than quietly assuming it works: one instance carrying parallel tasks due the same week, a deadline the hours do not fit, an order that forces work to wait.',
      `Reply with one JSON object of exactly this shape:\n${SHAPE}`,
      'Every task’s `dependsOn` names task keys from this proposal, and every milestone’s names milestone keys. Deadlines are epoch milliseconds. When the project carries a `deadlineAt`, every milestone lands on or before it; if the work does not fit, say so in a prompt rather than planning past it.',
    ],
  });
  const proposal = parseJsonAnswer<RoadmapProposal>(result.text);
  if (!proposal) throw new Error('The planner turn did not return a roadmap.');
  await mutate('services/projects:recordProposal', { projectId: input.projectId, proposal });
  return { projectId: input.projectId };
}
