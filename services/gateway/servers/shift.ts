import { boundedNumber, requireString, stringList, type InternalTool } from './shared';

/** The structured report a shift ends with. Without one the platform infers it and marks it inferred. */
export const submitReport: InternalTool = {
  name: 'submit_report',
  description:
    'End this shift with its report. File it once, at the end: what you finished, what is in progress, what blocks you, what comes next, the risks, and how confident you are of the deadline.',
  properties: {
    done: { type: 'array', description: 'What you finished.', items: { type: 'string' } },
    inProgress: { type: 'array', description: 'What is under way.', items: { type: 'string' } },
    blockedOn: { type: 'array', description: 'What is blocking you.', items: { type: 'string' } },
    next: { type: 'array', description: 'What the next shift takes on.', items: { type: 'string' } },
    risks: { type: 'array', description: 'What could still go wrong.', items: { type: 'string' } },
    deadlineConfidence: {
      type: 'number',
      description: 'From 0 to 1, how sure you are of meeting the deadline.',
    },
  },
  required: ['done', 'inProgress', 'blockedOn', 'next', 'risks'],
  async run(request, _context, args) {
    const confidence = boundedNumber(args, 'deadlineConfidence', 0, 1);
    const result = await request.backend.mutate<{ reportId: string | null }>(
      'services/schedule:submitReport',
      {
        runToken: request.runToken,
        report: {
          done: stringList(args, 'done'),
          inProgress: stringList(args, 'inProgress'),
          blockedOn: stringList(args, 'blockedOn'),
          next: stringList(args, 'next'),
          risks: stringList(args, 'risks'),
          ...(confidence === undefined ? {} : { deadlineConfidence: confidence }),
        },
      },
    );
    return { filed: true, reportId: result.reportId };
  },
};

/** The structured outcome of a finished task, which later shifts read as a recent summary. */
export const submitSummary: InternalTool = {
  name: 'submit_summary',
  description:
    'Close this task with its outcome: what it produced, the decisions taken, what is still open, and the deliverables it archived.',
  properties: {
    outcome: { type: 'string', description: 'What the task produced, in one sentence.' },
    decisions: { type: 'array', description: 'Decisions taken.', items: { type: 'string' } },
    openQuestions: { type: 'array', description: 'What is still open.', items: { type: 'string' } },
    artifactIds: { type: 'array', description: 'Archived artifact ids.', items: { type: 'string' } },
    text: { type: 'string', description: 'The summary a later shift reads.' },
  },
  required: ['outcome', 'text'],
  async run(request, context, args) {
    const result = await request.backend.mutate<{ summaryId: string }>('services/memory:recordSummary', {
      taskId: context.task.id,
      outcome: requireString(args, 'outcome'),
      decisions: stringList(args, 'decisions'),
      openQuestions: stringList(args, 'openQuestions'),
      artifactIds: stringList(args, 'artifactIds'),
      text: requireString(args, 'text'),
      inferred: false,
    });
    return { filed: true, summaryId: result.summaryId };
  },
};

export const shiftTools = [submitReport, submitSummary];
