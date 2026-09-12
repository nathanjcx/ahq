import type { Memory, MemoryScope } from '../../../lib/contracts';
import type { WorkingMemoryInputs } from '../../../lib/server/memory';
import { GatewayError } from '../errors';
import {
  boundedNumber,
  optionalString,
  requireString,
  stringList,
  untrusted,
  type InternalTool,
} from './shared';

const KINDS = ['fact', 'decision', 'preference', 'procedure', 'glossary', 'status'];
const SCOPES: MemoryScope[] = ['task', 'agent', 'floor', 'project', 'workspace'];

function requireKind(args: Record<string, unknown>) {
  const kind = requireString(args, 'kind');
  if (!KINDS.includes(kind))
    throw new GatewayError('invalid_arguments', `kind must be one of ${KINDS.join(', ')}.`);
  return kind;
}

/** `remember`, so a later shift is not wrong. One atomic claim per call; the instructions say so too. */
const remember: InternalTool = {
  name: 'remember',
  description:
    'File one atomic claim a later shift would be wrong without. Your own notes take effect at once; a floor or project claim is a proposal a person or the janitor decides. Never record a credential or anything told in confidence.',
  properties: {
    scope: {
      type: 'string',
      description:
        'task for this task alone, self for every task you run, floor, or project. A task claim is searchable with recall; a self claim is compiled into your working memory.',
    },
    kind: { type: 'string', description: `One of ${KINDS.join(', ')}.` },
    text: { type: 'string', description: 'The claim, in one or two sentences.' },
    tags: { type: 'array', description: 'Search tags.', items: { type: 'string' } },
    confidence: { type: 'number', description: 'How sure you are, from 0 to 1.' },
    supersedesId: { type: 'string', description: 'The claim this one replaces, if any.' },
  },
  required: ['scope', 'kind', 'text'],
  async run(request, _context, args) {
    const scope = requireString(args, 'scope');
    if (!['task', 'self', 'floor', 'project'].includes(scope))
      throw new GatewayError('invalid_arguments', 'scope must be task, self, floor, or project.');
    return request.backend.mutate<Record<string, unknown>>('services/memory:remember', {
      runToken: request.runToken,
      scope,
      kind: requireKind(args),
      text: requireString(args, 'text'),
      tags: stringList(args, 'tags'),
      ...(args.confidence === undefined ? {} : { confidence: boundedNumber(args, 'confidence', 0, 1) }),
      ...(args.supersedesId ? { supersedesId: requireString(args, 'supersedesId') } : {}),
    });
  },
};

const recall: InternalTool = {
  name: 'recall',
  description: 'Search the memory this task may read by tag and keyword. Best matches first.',
  properties: {
    query: { type: 'string', description: 'Words or tags to search for.' },
    scope: { type: 'string', description: `Narrow to one of ${SCOPES.join(', ')}.` },
  },
  required: ['query'],
  async run(request, _context, args) {
    const scope = optionalString(args, 'scope');
    if (scope && !SCOPES.includes(scope as MemoryScope))
      throw new GatewayError('invalid_arguments', `scope must be one of ${SCOPES.join(', ')}.`);
    const rows = await request.backend.query<Memory[]>('services/memory:recall', {
      runToken: request.runToken,
      query: requireString(args, 'query'),
      ...(scope ? { scope } : {}),
    });
    return { count: rows.length, memories: untrusted(rows) };
  },
};

const readMemory: InternalTool = {
  name: 'read_memory',
  description:
    'Read the active claims of every scope this task may see: workspace, project, floor, and your own notes, with the recent task summaries of your floor.',
  properties: {},
  async run(request, context) {
    const inputs = await request.backend.query<WorkingMemoryInputs>('services/memory:compileInputs', {
      taskId: context.task.id,
    });
    return {
      budgets: inputs.budgets,
      memory: untrusted({ entries: inputs.entries, summaries: inputs.summaries }),
    };
  },
};

const readBoard: InternalTool = {
  name: 'read_board',
  description: 'Read the recent posts on your floor, your project, and the workspace channel.',
  properties: { limit: { type: 'number', description: 'Posts per channel, up to 50.' } },
  async run(request, _context, args) {
    const limit = boundedNumber(args, 'limit', 1, 50);
    const rows = await request.backend.query<unknown[]>('services/channels:readBoard', {
      runToken: request.runToken,
      ...(limit === undefined ? {} : { limit: Math.floor(limit) }),
    });
    return { channels: untrusted(rows) };
  },
};

export const memoryTools = [remember, recall, readMemory, readBoard];
