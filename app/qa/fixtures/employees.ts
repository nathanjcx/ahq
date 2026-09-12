import type { FixtureQueries } from '@/components/shared/use-ui-query';
import type {
  AuditFinding,
  HireRequest,
  InstanceStatus,
  InstanceUpgrade,
  Memory,
  VersionChange,
} from '@/lib/contracts';

const hour = 3_600_000;
/** The same fixed clock the workspace fixture uses, so the two read as one day. */
const now = Date.UTC(2026, 2, 17, 14, 30);
const ago = (hours: number) => now - hours * hour;

const status = (
  employeeId: string,
  values: Partial<Omit<InstanceStatus, 'employeeId'>> = {},
): InstanceStatus => ({
  employeeId,
  shift: { state: 'off' },
  shiftsToday: 0,
  tokensToday: 0,
  hiredAt: ago(400),
  ...values,
});

const instanceStatus: InstanceStatus[] = [
  status('emp_ada', {
    shift: { state: 'running', kind: 'work', startedAt: ago(5.5) },
    shiftsToday: 1,
    tokensToday: 184_200,
    overnightModel: 'gpt-5.6-luna',
  }),
  status('emp_ada_2', {
    shift: { state: 'running', kind: 'review', startedAt: ago(1.2) },
    shiftsToday: 1,
    tokensToday: 41_800,
  }),
  status('emp_bruno', {
    shift: { state: 'done', kind: 'work', startedAt: ago(6), endedAt: ago(2) },
    shiftsToday: 1,
    tokensToday: 96_400,
  }),
  status('emp_bruno_2', { hiredAt: ago(60) }),
  status('emp_cyrus', {
    shift: { state: 'running', kind: 'work', startedAt: ago(4) },
    shiftsToday: 1,
    tokensToday: 220_900,
    overnightModel: 'gpt-5.6-terra',
  }),
  status('emp_emi', { shiftsToday: 0, tokensToday: 12_300 }),
  status('emp_fen', {
    shift: { state: 'done', kind: 'work', startedAt: ago(7), endedAt: ago(3) },
    shiftsToday: 2,
    tokensToday: 58_600,
  }),
  status('emp_gil'),
  status('emp_hana', { tokensToday: 4_100 }),
  status('emp_mina', { hiredAt: ago(120) }),
  status('emp_ada_3', { hiredAt: ago(900) }),
  status('emp_janitor', { shiftsToday: 1, tokensToday: 9_800, hiredAt: ago(900) }),
  status('emp_auditor', {
    shift: { state: 'done', kind: 'work', startedAt: ago(20), endedAt: ago(18) },
    shiftsToday: 1,
    tokensToday: 31_500,
    hiredAt: ago(900),
  }),
  status('emp_triage', { hiredAt: ago(900) }),
];

const hireRequests: HireRequest[] = [
  {
    id: 'req_bruno',
    listingId: 'lst_bruno',
    listingName: 'Bruno',
    floorId: 'proj_launch',
    count: 2,
    requestedBy: 'user_ivan',
    requestedByName: 'Ivan Petrov',
    status: 'pending',
    createdAt: ago(3),
  },
];

const upgrades: Record<string, InstanceUpgrade> = {
  emp_bruno_2: {
    employeeId: 'emp_bruno_2',
    fromVersion: 1,
    toVersion: 2,
    publishedAt: ago(40),
    changed: ['description', 'instructions', 'capabilities'],
  },
};

const versions: Record<string, VersionChange[]> = {
  lst_ada: [
    { version: 2, publishedAt: ago(40), retired: false, changed: ['description', 'instructions'] },
    {
      version: 1,
      publishedAt: ago(400),
      retired: false,
      changed: ['name', 'role', 'description', 'category', 'capabilities', 'instructions'],
    },
  ],
  lst_bruno: [
    { version: 2, publishedAt: ago(40), retired: false, changed: ['instructions', 'capabilities'] },
    {
      version: 1,
      publishedAt: ago(300),
      retired: false,
      changed: ['name', 'role', 'description', 'category', 'instructions'],
    },
  ],
  lst_mina: [
    {
      version: 1,
      publishedAt: ago(120),
      retired: false,
      changed: ['name', 'role', 'description', 'category', 'capabilities', 'instructions'],
    },
  ],
};

export const notebookMemories: Memory[] = [
  {
    id: 'mem_ada_1',
    scope: 'agent',
    scopeId: 'emp_ada',
    kind: 'procedure',
    text: 'Release blockers are labelled `blocker` in Linear, not `P0`. The label was renamed in February.',
    tags: ['linear', 'release'],
    author: 'agent',
    authorName: 'Ada',
    confidence: 0.9,
    status: 'active',
    createdAt: ago(70),
    updatedAt: ago(70),
  },
  {
    id: 'mem_ada_2',
    scope: 'agent',
    scopeId: 'emp_ada',
    kind: 'preference',
    text: 'Dana wants the unverified items listed first, before the summary.',
    tags: ['reporting'],
    author: 'person',
    authorName: 'Dana Okoye',
    confidence: 1,
    status: 'active',
    createdAt: ago(26),
    updatedAt: ago(26),
  },
  {
    id: 'mem_ada_3',
    scope: 'agent',
    scopeId: 'emp_ada',
    kind: 'fact',
    text: 'The migration script owner is Ivan.',
    tags: ['ownership'],
    author: 'agent',
    authorName: 'Ada',
    confidence: 0.5,
    status: 'contested',
    contestedWithId: 'mem_ada_4',
    contestReason: 'Another claim names Priya as the owner since March.',
    createdAt: ago(200),
    updatedAt: ago(12),
  },
];

export const instanceFindings: AuditFinding[] = [
  {
    id: 'find_ada_1',
    employeeId: 'emp_ada',
    employeeName: 'Ada',
    taskId: 'task_running',
    auditDate: '2026-03-16',
    severity: 'medium',
    claim: 'The report says every blocker was checked, but the journal shows two issues were never read.',
    evidence: 'Journal has get_issue for ENG-412 and ENG-418 only; the report lists six.',
    requiredAction: 'Re-read the four remaining issues and correct the report before the next shift.',
    status: 'open',
    createdAt: ago(19),
    updatedAt: ago(19),
  },
  {
    id: 'find_ada_2',
    employeeId: 'emp_ada',
    employeeName: 'Ada',
    auditDate: '2026-03-14',
    severity: 'low',
    claim: 'Two sentences in the summary repeat the changelog verbatim.',
    evidence: 'Lines 4 and 5 match the changelog word for word.',
    requiredAction: 'Write the summary in the workspace standard voice.',
    status: 'verified',
    createdAt: ago(66),
    updatedAt: ago(40),
  },
];

const instructions = `# Operating rules
You are an employee of this workspace. Work only on the task you were given, and say what you could
not verify before you say what you found.

# Character
Writes in short declaratives and says what she is unsure about first.
Traits: terse, fast.

# Floor rules
Post what you finish to your floor channel. Hand work off rather than doing someone else's job.

# Working memory
{{MEMORY}}

# Instructions
Read the issue tracker and the repository and answer questions about the work. Cite the records you
used. Never close an issue without approval.`;

/**
 * Query answers for the employees, marketplace, and studio pages under the fixture route.
 *
 * `plan:projection`, `memory:list`, `audit:findings`, and `channels:list` are read by these pages but
 * owned by the plan, memory, audit, and channels workstreams; the entries here answer for this
 * workspace's instances and are meant to be merged with theirs, not to replace them.
 */
export const employeesQueries: FixtureQueries = {
  'marketplace:instanceStatus': instanceStatus,
  'marketplace:hireRequests': hireRequests,
  'marketplace:instanceUpgrade': (args: { employeeId: string }) => upgrades[args.employeeId] ?? null,
  'marketplace:listingVersions': (args: { listingId: string }) => versions[args.listingId] ?? [],
  'marketplace:previewInstructions': instructions,
  'marketplace:versionDiff': {
    currentVersion: 1,
    publishedAt: ago(300),
    fields: [
      {
        field: 'description',
        before: 'Turns a transcript into decisions and owners.',
        after: 'Turns a transcript into decisions, owners, and the dates they were agreed.',
      },
      {
        field: 'instructions',
        before: 'Summarise decisions, owners, and dates. Never invent an owner.',
        after:
          'Summarise decisions, owners, and dates. Never invent an owner. Say which decisions were left open.',
      },
    ],
  },
};
