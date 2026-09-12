import { GatewayError } from '../errors';
import { optionalString, requireString, stringList, untrusted, type InternalTool } from './shared';

const KINDS = ['fact', 'decision', 'preference', 'procedure', 'glossary', 'status'];

const merge: InternalTool = {
  name: 'merge',
  description:
    'Replace two or more overlapping claims in one scope with a single claim. Each input is archived pointing at the merge.',
  properties: {
    ids: { type: 'array', description: 'The claims to merge, at least two.', items: { type: 'string' } },
    text: { type: 'string', description: 'The claim that replaces them.' },
    kind: { type: 'string', description: `One of ${KINDS.join(', ')}.` },
    tags: { type: 'array', description: 'Search tags.', items: { type: 'string' } },
  },
  required: ['ids', 'text', 'kind'],
  async run(request, _context, args) {
    const kind = requireString(args, 'kind');
    if (!KINDS.includes(kind))
      throw new GatewayError('invalid_arguments', `kind must be one of ${KINDS.join(', ')}.`);
    const ids = stringList(args, 'ids');
    if (ids.length < 2) throw new GatewayError('invalid_arguments', 'A merge needs at least two claims.');
    return request.backend.mutate<Record<string, unknown>>('services/memory:merge', {
      runToken: request.runToken,
      ids,
      text: requireString(args, 'text'),
      kind,
      tags: stringList(args, 'tags'),
    });
  },
};

const contest: InternalTool = {
  name: 'contest',
  description:
    'Mark a claim as contested so it reaches no model, naming the claim it conflicts with when there is one. The conflict is posted as a question for a person to settle.',
  properties: {
    id: { type: 'string', description: 'The claim to contest.' },
    reason: { type: 'string', description: 'Why the claim is in doubt.' },
    otherId: { type: 'string', description: 'The competing claim, if there is one.' },
  },
  required: ['id', 'reason'],
  async run(request, _context, args) {
    const otherId = optionalString(args, 'otherId');
    const entry = await request.backend.mutate<Record<string, unknown>>('services/memory:contest', {
      runToken: request.runToken,
      id: requireString(args, 'id'),
      reason: requireString(args, 'reason'),
      ...(otherId ? { otherId } : {}),
    });
    return { contested: untrusted(entry) };
  },
};

const archive: InternalTool = {
  name: 'archive',
  description: 'Retire a claim that is stale or wrong.',
  properties: { id: { type: 'string', description: 'The claim to archive.' } },
  required: ['id'],
  async run(request, _context, args) {
    await request.backend.mutate('services/memory:archive', {
      runToken: request.runToken,
      id: requireString(args, 'id'),
    });
    return { archived: true };
  },
};

const promote: InternalTool = {
  name: 'promote',
  description:
    'Propose an active scoped claim for the whole workspace. It waits for an administrator; promoting is not approving.',
  properties: { id: { type: 'string', description: 'The claim to promote.' } },
  required: ['id'],
  async run(request, _context, args) {
    const result = await request.backend.mutate<{ memoryId: string }>('services/memory:promote', {
      runToken: request.runToken,
      id: requireString(args, 'id'),
    });
    return {
      ...result,
      status: 'proposed',
      instruction: 'An administrator decides this. Do not treat it as workspace memory yet.',
    };
  },
};

const readMemory: InternalTool = {
  name: 'read_memory',
  description:
    'The workspace’s memory as the janitor sees it: the fill of every scope against its budget, and the claims waiting on a decision first.',
  properties: {},
  async run(request, context) {
    const inputs = await request.backend.query<Record<string, unknown>>('services/memory:curateInputs', {
      runToken: request.runToken,
      workspaceId: context.task.workspaceId,
    });
    const { budgets, scopes, entries } = inputs;
    return { budgets, scopes, entries: untrusted(entries) };
  },
};

export const janitorTools = [merge, contest, archive, promote, readMemory];
