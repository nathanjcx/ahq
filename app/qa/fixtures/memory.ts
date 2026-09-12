import type { FixtureQueries } from '@/components/shared/use-ui-query';
import type { JanitorLogEntry, Memory, MemoryScopeSummary, TaskSummary } from '@/lib/contracts';

/**
 * The records basement, written down: every status and scope on the shelves, one conflict waiting on
 * a person, and a chain of three so the supersession history has something to show.
 */

const hour = 3_600_000;
/** The same fixed clock the workspace fixture uses, so the two read as one day. */
const now = Date.UTC(2026, 2, 17, 14, 30);
const ago = (hours: number) => now - hours * hour;

const workspaceId = 'ws_acme';
const projectId = 'prj_northstar';

function claim(entry: Partial<Memory> & Pick<Memory, 'id' | 'scope' | 'scopeId' | 'text'>): Memory {
  return {
    kind: 'fact',
    tags: [],
    author: 'agent',
    authorName: 'Ada',
    confidence: 0.85,
    status: 'active',
    createdAt: ago(30),
    updatedAt: ago(30),
    ...entry,
  };
}

const claims: Memory[] = [
  // Workspace: the tower's standing orders, plus one the janitor promoted and nobody has approved.
  claim({
    id: 'mem_ws_tone',
    scope: 'workspace',
    scopeId: workspaceId,
    kind: 'preference',
    text: 'Customer-facing copy says what changed and what the reader has to do, in that order.',
    tags: ['copy', 'standard'],
    author: 'person',
    authorName: 'Dana Okoye',
    confidence: 1,
    createdAt: ago(210),
    updatedAt: ago(210),
  }),
  claim({
    id: 'mem_ws_release',
    scope: 'workspace',
    scopeId: workspaceId,
    kind: 'procedure',
    text: 'Nothing ships on a Friday; the release window is Tuesday to Thursday.',
    tags: ['release'],
    author: 'person',
    authorName: 'Dana Okoye',
    confidence: 1,
    createdAt: ago(180),
    updatedAt: ago(180),
  }),
  claim({
    id: 'mem_ws_promoted',
    scope: 'workspace',
    scopeId: workspaceId,
    kind: 'decision',
    text: 'Billing questions go to the Support backlog floor before anyone answers the customer.',
    tags: ['billing', 'support'],
    author: 'janitor',
    authorName: 'The Janitor',
    status: 'proposed',
    confidence: 0.9,
    createdAt: ago(11),
    updatedAt: ago(11),
  }),

  // Project: one active claim and one an employee filed last night.
  claim({
    id: 'mem_proj_scope',
    scope: 'project',
    scopeId: projectId,
    kind: 'decision',
    text: 'Northstar ships without the self-serve upgrade flow; it moves to the next milestone.',
    tags: ['scope'],
    authorName: 'Bruno',
    createdAt: ago(54),
    updatedAt: ago(54),
  }),
  claim({
    id: 'mem_proj_risk',
    scope: 'project',
    scopeId: projectId,
    kind: 'status',
    text: 'The migration script is the critical path; every later milestone waits on it.',
    tags: ['risk'],
    status: 'proposed',
    confidence: 0.7,
    createdAt: ago(9),
    updatedAt: ago(9),
  }),

  // Floor: a chain of three, a contested pair, and one claim waiting for the janitor.
  claim({
    id: 'mem_floor_notes_c',
    scope: 'floor',
    scopeId: 'proj_launch',
    kind: 'procedure',
    text: 'Release notes ship with the migration guide in the same pull request.',
    tags: ['release', 'docs'],
    authorName: 'The Janitor',
    author: 'janitor',
    confidence: 0.95,
    createdAt: ago(12),
    updatedAt: ago(12),
  }),
  claim({
    id: 'mem_floor_notes_b',
    scope: 'floor',
    scopeId: 'proj_launch',
    kind: 'procedure',
    text: 'Release notes ship in the same pull request as the migration guide.',
    status: 'archived',
    supersedesId: 'mem_floor_notes_c',
    authorName: 'Bruno',
    createdAt: ago(80),
    updatedAt: ago(12),
  }),
  claim({
    id: 'mem_floor_notes_a',
    scope: 'floor',
    scopeId: 'proj_launch',
    kind: 'procedure',
    text: 'Release notes are written after the migration guide is merged.',
    status: 'archived',
    supersedesId: 'mem_floor_notes_b',
    authorName: 'Bruno',
    createdAt: ago(160),
    updatedAt: ago(80),
  }),
  claim({
    id: 'mem_floor_freeze_a',
    scope: 'floor',
    scopeId: 'proj_launch',
    kind: 'decision',
    text: 'The code freeze starts on the Monday before launch.',
    tags: ['release'],
    status: 'contested',
    contestedWithId: 'mem_floor_freeze_b',
    contestReason: 'Two claims give different freeze dates and both were filed after the launch meeting.',
    authorName: 'Ada',
    createdAt: ago(70),
    updatedAt: ago(11),
  }),
  claim({
    id: 'mem_floor_freeze_b',
    scope: 'floor',
    scopeId: 'proj_launch',
    kind: 'decision',
    text: 'The code freeze starts on the Wednesday before launch, after the final review.',
    tags: ['release'],
    status: 'contested',
    contestedWithId: 'mem_floor_freeze_a',
    contestReason: 'Two claims give different freeze dates and both were filed after the launch meeting.',
    authorName: 'Bruno',
    createdAt: ago(38),
    updatedAt: ago(11),
  }),
  claim({
    id: 'mem_floor_owner',
    scope: 'floor',
    scopeId: 'proj_launch',
    kind: 'glossary',
    text: '“The announcement” means the customer email, not the changelog entry.',
    tags: ['glossary'],
    status: 'proposed',
    confidence: 0.6,
    createdAt: ago(6),
    updatedAt: ago(6),
  }),
  claim({
    id: 'mem_floor_expiring',
    scope: 'floor',
    scopeId: 'proj_launch',
    kind: 'status',
    text: 'The staging environment is on the release candidate build this week.',
    tags: ['staging'],
    expiresAt: now + 40 * hour,
    createdAt: ago(20),
    updatedAt: ago(20),
  }),
  claim({
    id: 'mem_support_escalation',
    scope: 'floor',
    scopeId: 'proj_support',
    kind: 'procedure',
    text: 'Anything touching billing is escalated to a person before a reply is sent.',
    tags: ['billing'],
    authorName: 'Mina',
    createdAt: ago(96),
    updatedAt: ago(96),
  }),
  claim({
    id: 'mem_support_tone',
    scope: 'floor',
    scopeId: 'proj_support',
    kind: 'preference',
    text: 'Replies open with the answer; the apology comes second if it is needed at all.',
    authorName: 'Mina',
    createdAt: ago(120),
    updatedAt: ago(120),
  }),

  // A notebook: one instance's own working notes.
  claim({
    id: 'mem_ada_tool',
    scope: 'agent',
    scopeId: 'emp_ada',
    kind: 'procedure',
    text: 'Linear issues for the launch carry the "spring" label; filtering on the project misses half.',
    tags: ['linear'],
    createdAt: ago(46),
    updatedAt: ago(46),
  }),
  claim({
    id: 'mem_ada_pref',
    scope: 'agent',
    scopeId: 'emp_ada',
    kind: 'preference',
    text: 'Dana wants blockers listed with an owner, never as a bare count.',
    tags: ['reporting'],
    createdAt: ago(64),
    updatedAt: ago(64),
  }),
  claim({
    id: 'mem_ada_stale',
    scope: 'agent',
    scopeId: 'emp_ada',
    kind: 'fact',
    text: 'The spend export lives in the finance Drive folder.',
    status: 'archived',
    createdAt: ago(300),
    updatedAt: ago(130),
  }),

  // A task dossier's own claims.
  claim({
    id: 'mem_task_decision',
    scope: 'task',
    scopeId: 'task_completed',
    kind: 'decision',
    text: 'The changelog keeps the old endpoint documented for one more release.',
    tags: ['api'],
    authorName: 'Bruno',
    createdAt: ago(40),
    updatedAt: ago(40),
  }),
];

const summaries: Record<'workspace' | 'project' | 'floor', MemoryScopeSummary[]> = {
  workspace: [
    { scope: 'workspace', scopeId: workspaceId, name: 'Acme', active: 2, proposed: 1, contested: 0, tokens: 1_180, budget: 2_000 },
  ],
  project: [
    { scope: 'project', scopeId: projectId, name: 'Northstar', active: 1, proposed: 1, contested: 0, tokens: 2_240, budget: 3_000 },
    { scope: 'project', scopeId: 'prj_billing', name: 'Billing clean-up', active: 0, proposed: 0, contested: 0, tokens: 0, budget: 3_000 },
  ],
  floor: [
    { scope: 'floor', scopeId: 'proj_launch', name: 'Spring launch', active: 2, proposed: 1, contested: 2, tokens: 4_380, budget: 4_000 },
    { scope: 'floor', scopeId: 'proj_support', name: 'Support backlog', active: 2, proposed: 0, contested: 0, tokens: 1_020, budget: 4_000 },
  ],
};

const taskSummary: TaskSummary = {
  id: 'sum_completed',
  taskId: 'task_completed',
  outcome: 'The changelog and the customer announcement are drafted and ready for review.',
  decisions: [
    'The old endpoint stays documented for one more release.',
    'The announcement links the migration guide rather than repeating it.',
  ],
  openQuestions: ['Who sends the customer email: support or the release owner?'],
  artifactIds: ['art_announcement', 'art_migration'],
  text: 'Both drafts follow the workspace copy standard. The migration guide was not touched.',
  inferred: false,
  createdAt: ago(38),
};

const janitorLog: JanitorLogEntry[] = [
  {
    id: 'mem_ws_promoted',
    action: 'promoted',
    at: ago(11),
    scope: 'workspace',
    scopeId: workspaceId,
    text: 'Billing questions go to the Support backlog floor before anyone answers the customer.',
    detail: 'Proposed for the whole workspace',
    authorName: 'The Janitor',
  },
  {
    id: 'mem_floor_freeze_a',
    action: 'contested',
    at: ago(11),
    scope: 'floor',
    scopeId: 'proj_launch',
    text: 'The code freeze starts on the Monday before launch.',
    detail: 'Two claims give different freeze dates and both were filed after the launch meeting.',
    authorName: 'Ada',
  },
  {
    id: 'mem_floor_notes_c',
    action: 'merged',
    at: ago(12),
    scope: 'floor',
    scopeId: 'proj_launch',
    text: 'Release notes ship with the migration guide in the same pull request.',
    detail: 'Replaced 1 overlapping claim',
    authorName: 'The Janitor',
  },
];

type ScopeArgs = { scope?: Memory['scope']; scopeId?: string; status?: Memory['status'] };

export const memoryQueries: FixtureQueries = {
  'memory:list': (args: ScopeArgs) =>
    claims
      .filter((entry) => (!args.scope || entry.scope === args.scope) && (!args.scopeId || entry.scopeId === args.scopeId))
      .sort((a, b) => b.createdAt - a.createdAt),
  'memory:summaries': (args: { scope: 'workspace' | 'project' | 'floor' }) => summaries[args.scope],
  'memory:taskSummary': (args: { taskId: string }) =>
    args.taskId === taskSummary.taskId ? taskSummary : null,
  'memory:janitorLog': janitorLog,
};
