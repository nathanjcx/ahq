import type { FixtureQueries } from '@/components/shared/use-ui-query';
import type { Channel, Post } from '@/lib/contracts';

/** The same fixed clock the workspace fixture uses, so screenshots stay comparable. */
const now = Date.UTC(2026, 2, 17, 14, 30);
const hour = 3_600_000;
const ago = (hours: number) => now - hours * hour;

const channels: Channel[] = [
  { id: 'chan_launch', kind: 'floor', scopeId: 'proj_launch', name: 'Spring launch', unread: 3 },
  { id: 'chan_support', kind: 'floor', scopeId: 'proj_support', name: 'Support backlog', unread: 0 },
  { id: 'chan_workspace', kind: 'workspace', scopeId: '', name: 'Workspace', unread: 1 },
  { id: 'chan_triage', kind: 'triage', scopeId: '', name: 'Triage', unread: 2 },
  { id: 'chan_audit', kind: 'audit', scopeId: '', name: 'Audit', unread: 0 },
];

/**
 * The Spring launch floor channel: every kind of post the feed can draw, over two days, with the
 * last three unread so the line has somewhere to sit.
 */
const launchPosts: Post[] = [
  {
    id: 'post_1',
    channelId: 'chan_launch',
    kind: 'system',
    authorEmployeeId: 'emp_ada',
    authorName: 'Ada',
    text: 'Started the shift for Draft the migration notes',
    taskId: 'task_running',
    createdAt: ago(30),
  },
  {
    id: 'post_2',
    channelId: 'chan_launch',
    kind: 'note',
    authorSubject: 'user_dana',
    authorName: 'Dana Okoye',
    text: 'Customer comms go out Thursday, so the migration notes need to be readable by a non-engineer. Keep the schema table but lead with what breaks.',
    createdAt: ago(29),
  },
  {
    id: 'post_3',
    channelId: 'chan_launch',
    kind: 'report',
    authorEmployeeId: 'emp_ada',
    authorName: 'Ada',
    text: 'Ada — Draft the migration notes\nDone: read the diff on acme/platform#4120; drafted the column-by-column table\nIn progress: the reversibility note\nBlocked on: whether the backfill is run before or after deploy\nNext: rewrite the opening for a non-engineer\nRisks: the backfill answer changes the whole ordering section',
    taskId: 'task_running',
    createdAt: ago(28),
  },
  {
    id: 'post_4',
    channelId: 'chan_launch',
    kind: 'feedback',
    authorEmployeeId: 'emp_bruno',
    authorName: 'Bruno',
    text: 'Read Ada’s draft ahead of the changelog. The table is right, but "irreversible" is doing a lot of work in paragraph two — it is only irreversible after the backfill runs. I will wait for her next report before I write the announcement.',
    createdAt: ago(26),
  },
  {
    id: 'post_5',
    channelId: 'chan_launch',
    kind: 'finding',
    authorEmployeeId: 'emp_gil',
    authorName: 'Gil',
    text: 'Bruno — audit of 2026-03-16\nMEDIUM: the changelog claims the migration is tested, and the journal shows no test run → run the migration test and cite it\nLOW: two headings repeat the product name → follow the workspace copy standard',
    createdAt: ago(20),
  },
  {
    id: 'post_6',
    channelId: 'chan_launch',
    kind: 'alert',
    authorEmployeeId: 'emp_triage',
    authorName: 'Triage',
    text: 'CRITICAL: Checkout writes are failing on the primary database\nConnection pool exhausted after the 14:02 deploy. This floor’s work is on hold until the incident closes.\nhttps://status.example.com/incidents/4821',
    taskId: 'task_triage_db',
    createdAt: ago(3),
  },
  {
    id: 'post_7',
    channelId: 'chan_launch',
    kind: 'decision',
    flag: 'contested',
    authorEmployeeId: 'emp_hana',
    authorName: 'Hana',
    text: 'Contested: The launch deadline is March 24.\nAgainst: The launch deadline is March 26.\nReason: two shift reports on the same day cite different dates, and neither names a source.\nA person decides which claim stands; neither reaches a model until then.',
    createdAt: ago(2.5),
  },
  {
    id: 'post_8',
    channelId: 'chan_launch',
    kind: 'handoff',
    authorSubject: 'user_dana',
    authorName: 'Dana Okoye',
    text: 'Take the migration notes through to the announcement once Ada files her next report.',
    handoff: {
      toEmployeeId: 'emp_bruno',
      toEmployeeName: 'Bruno',
      brief: 'Take the migration notes through to the announcement once Ada files her next report.',
      status: 'pending',
    },
    createdAt: ago(1.5),
  },
  {
    id: 'post_9',
    channelId: 'chan_launch',
    kind: 'note',
    authorSubject: 'user_dana',
    authorName: 'Dana Okoye',
    text: '@Ada the backfill runs after the deploy. Write the ordering section on that basis and say so explicitly.',
    toEmployeeId: 'emp_ada',
    createdAt: ago(0.6),
  },
];

const triagePosts: Post[] = [
  {
    id: 'post_t1',
    channelId: 'chan_triage',
    kind: 'alert',
    authorEmployeeId: 'emp_triage',
    authorName: 'Triage',
    text: 'CRITICAL: Checkout writes are failing on the primary database\nConnection pool exhausted after the 14:02 deploy.',
    taskId: 'task_triage_db',
    createdAt: ago(3),
  },
  {
    id: 'post_t2',
    channelId: 'chan_triage',
    kind: 'note',
    authorEmployeeId: 'emp_triage',
    authorName: 'Triage',
    text: 'Reproduced: 40 of 40 write attempts time out against the primary. The pool cap stayed at 20 while the deploy doubled the worker count.',
    taskId: 'task_triage_db',
    createdAt: ago(2.7),
  },
];

const employeeFeeds: Record<string, Post[]> = {
  emp_ada: [launchPosts[0], launchPosts[2]],
  emp_bruno: [launchPosts[3]],
  emp_mina: [],
};

/** Query answers for the channels pages under the fixture route. */
export const channelsQueries: FixtureQueries = {
  'channels:list': channels,
  'channels:posts': (args: unknown) => {
    const channelId = (args as { channelId?: string }).channelId;
    if (channelId === 'chan_triage') return triagePosts;
    return channelId === 'chan_launch' ? launchPosts : [];
  },
  'channels:employeeFeed': (args: unknown) =>
    employeeFeeds[(args as { employeeId?: string }).employeeId ?? ''] ?? [],
};
