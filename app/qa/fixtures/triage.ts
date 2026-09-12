import type { FixtureQueries } from '@/components/shared/use-ui-query';
import type { Alert, IncidentReport, Notification, TriageEvent, TriageIntake } from '@/lib/contracts';

const now = Date.UTC(2026, 2, 17, 14, 30);
const hour = 3_600_000;
const minute = 60_000;
const ago = (hours: number) => now - hours * hour;
/** Countdowns are read against the viewer's clock, so the live window is anchored to it. */
const live = Date.now();

const alerts: Alert[] = [
  {
    id: 'alert_db',
    source: 'webhook',
    fingerprint: 'uptime:checkout-writes',
    severity: 'critical',
    title: 'Checkout writes are failing on the primary database',
    detail:
      'Write latency crossed 30s and then timed out entirely, starting four minutes after the 14:02 deploy. The connection pool cap stayed at 20 while the deploy doubled the worker count.\n\nAffected: checkout, refunds. Reads are unaffected.',
    url: 'https://status.example.com/incidents/4821',
    status: 'triaging',
    triageTaskId: 'task_triage_db',
    affectedFloorIds: ['proj_launch'],
    occurrences: 14,
    paging: {
      attempts: 3,
      required: 3,
      firstAttemptAt: live - 21 * minute,
      lastAttemptAt: live - 2 * minute,
      opensAt: live - 2 * minute,
      acknowledged: false,
    },
    createdAt: ago(3),
    updatedAt: ago(0.3),
  },
  {
    id: 'alert_gh',
    source: 'github',
    fingerprint: 'github:acme/platform#4137',
    severity: 'high',
    title: 'Migration 4120 leaves orphaned rows on rollback',
    detail:
      'Matched triage rule "incident".\nRolling back the deploy leaves rows in `order_lines` with no parent. Reported by a customer engineer against acme/platform#4137.',
    url: 'https://github.com/acme/platform/issues/4137',
    status: 'open',
    triageTaskId: 'task_triage_gh',
    affectedFloorIds: [],
    occurrences: 2,
    paging: {
      attempts: 2,
      required: 3,
      firstAttemptAt: live - 8 * minute,
      lastAttemptAt: live - 3 * minute,
      opensAt: live + 12 * minute,
      acknowledged: false,
    },
    createdAt: ago(6),
    updatedAt: ago(1.2),
  },
  {
    id: 'alert_mail',
    source: 'email',
    fingerprint: 'email:ses-bounce-spike',
    severity: 'medium',
    title: 'Bounce rate on transactional mail crossed 5%',
    detail:
      'Classified from a provider notice. The spike follows the new sender domain; the fix moved the domain back and the post-mortem is filed.',
    status: 'fixed',
    triageTaskId: 'task_triage_mail',
    affectedFloorIds: ['proj_support'],
    occurrences: 1,
    paging: {
      attempts: 1,
      required: 3,
      firstAttemptAt: live - 40 * minute,
      lastAttemptAt: live - 40 * minute,
      opensAt: live - 20 * minute,
      acknowledged: true,
    },
    createdAt: ago(26),
    updatedAt: ago(19),
  },
];

const timelines: Record<string, TriageEvent[]> = {
  alert_db: [
    {
      id: 'tl_1',
      at: ago(3),
      kind: 'intake',
      title: 'webhook alert received',
      detail: '14 deliveries share this fingerprint.',
    },
    {
      id: 'tl_2',
      at: ago(2.95),
      kind: 'run',
      title: 'Triage run opened for Triage',
      detail: 'Triage: Checkout writes are failing on the primary database',
      outcome: 'running',
      taskId: 'task_triage_db',
    },
    {
      id: 'tl_3',
      at: ago(2.7),
      kind: 'post',
      title: 'Triage posted a note',
      detail:
        'Reproduced: 40 of 40 write attempts time out against the primary. The pool cap stayed at 20 while the deploy doubled the worker count.',
      postId: 'post_t2',
      taskId: 'task_triage_db',
    },
    {
      id: 'tl_4',
      at: ago(2.4),
      kind: 'tool',
      title: 'github_create_issue',
      authority: 'allow_list',
      outcome: 'succeeded',
      taskId: 'task_triage_db',
    },
    {
      id: 'tl_5',
      at: ago(2.1),
      kind: 'tool',
      title: 'github_open_pull_request',
      detail: 'Raise the pool cap to 60 and pin it to the worker count.',
      authority: 'allow_list',
      outcome: 'succeeded',
      taskId: 'task_triage_db',
    },
    {
      id: 'tl_6',
      at: live - 21 * minute,
      kind: 'page',
      title: 'Notification attempt 1',
      detail: 'Delivered by push',
      outcome: 'delivered',
    },
    {
      id: 'tl_7',
      at: live - 11 * minute,
      kind: 'page',
      title: 'Notification attempt 2',
      detail: 'Delivered by push',
      outcome: 'delivered',
    },
    {
      id: 'tl_8',
      at: live - 2 * minute,
      kind: 'page',
      title: 'Notification attempt 3',
      detail: 'Delivered by slack',
      outcome: 'delivered',
    },
    {
      id: 'tl_9',
      at: live - 1 * minute,
      kind: 'tool',
      title: 'github_merge_pull_request',
      detail: 'Outside attended hours, three delivered pages unanswered.',
      authority: 'emergency',
      outcome: 'succeeded',
      taskId: 'task_triage_db',
    },
  ],
  alert_gh: [
    {
      id: 'tl_g1',
      at: ago(6),
      kind: 'intake',
      title: 'github alert received',
      detail: 'github:acme/platform#4137',
    },
    {
      id: 'tl_g2',
      at: ago(5.9),
      kind: 'run',
      title: 'Triage run opened for Triage',
      detail: 'Triage: Migration 4120 leaves orphaned rows on rollback',
      outcome: 'queued',
      taskId: 'task_triage_gh',
    },
    {
      id: 'tl_g3',
      at: live - 8 * minute,
      kind: 'page',
      title: 'Notification attempt 1',
      detail: 'Delivered by push',
      outcome: 'delivered',
    },
    {
      id: 'tl_g4',
      at: live - 3 * minute,
      kind: 'page',
      title: 'Notification attempt 2',
      detail: 'Sent to email; nothing delivered',
      outcome: 'undelivered',
    },
  ],
  alert_mail: [
    {
      id: 'tl_m1',
      at: ago(26),
      kind: 'intake',
      title: 'email alert received',
      detail: 'email:ses-bounce-spike',
    },
    {
      id: 'tl_m2',
      at: ago(20),
      kind: 'post',
      title: 'Triage posted a finding',
      detail: 'Post-mortem: Bounce rate on transactional mail crossed 5%',
      postId: 'report_mail',
      taskId: 'task_triage_mail',
    },
  ],
};

const reports: IncidentReport[] = [
  {
    id: 'report_db',
    alertId: 'alert_db',
    alertTitle: 'Checkout writes are failing on the primary database',
    severity: 'critical',
    authorName: 'Triage',
    text: 'Incident report: Checkout writes are failing on the primary database\nIssue: every write to the primary timed out from 14:06.\nReproduction: 40 of 40 write attempts timed out; the pool held 20 connections against 40 workers.\nFix: raised the pool cap to 60 and pinned it to the worker count, then merged and deployed it.\nWhy I acted without permission: three pages were delivered over twenty-one minutes outside attended hours and none was answered; checkout was down for the whole window.\nSide effects: the primary now holds 60 connections, inside its 200 limit. Replica lag rose to 1.4s during the deploy and recovered.\nKnock-on risks: the cap is now derived from the worker count, so raising workers raises connections. A second guard on the database side is the follow-up.',
    taskId: 'task_triage_db',
    emergency: true,
    createdAt: ago(0.4),
  },
  {
    id: 'report_mail',
    alertId: 'alert_mail',
    alertTitle: 'Bounce rate on transactional mail crossed 5%',
    severity: 'medium',
    authorName: 'Triage',
    text: 'Post-mortem: Bounce rate on transactional mail crossed 5%\nCause: the new sender domain had no DKIM record, so two large providers rejected outright.\nFix: moved transactional mail back to the old sender domain.\nPrevention: publish DKIM and warm a domain before any sender change.\nRegression test: web-tests/mail-sender.test.ts asserts a configured sender has a DKIM record.',
    taskId: 'task_triage_mail',
    emergency: false,
    createdAt: ago(19),
  },
];

const intake: TriageIntake = {
  signedEndpointReady: true,
  rules: ['incident', 'sev1', 'outage', 'p0'],
  github: ['acme/platform', 'acme/website'],
  emailClassification: true,
};

const notifications: Notification[] = [
  {
    id: 'note_1',
    kind: 'triage',
    title: 'Checkout writes are failing',
    text: 'Third attempt. Nobody has answered; Triage may use the emergency allow-list.',
    alertId: 'alert_db',
    attempt: 3,
    sentAt: live - 2 * minute,
  },
  {
    id: 'note_2',
    kind: 'triage',
    title: 'Migration 4120 leaves orphaned rows',
    text: 'Second attempt on a high-severity GitHub alert.',
    alertId: 'alert_gh',
    attempt: 2,
    sentAt: live - 3 * minute,
  },
  {
    id: 'note_3',
    kind: 'finding',
    title: 'Escalated finding against Bruno',
    text: 'The changelog claims the migration is tested and the journal shows no test run. It is on the next meeting’s agenda.',
    attempt: 1,
    sentAt: ago(5),
  },
  {
    id: 'note_4',
    kind: 'meeting',
    title: 'Launch review starts in an hour',
    text: 'Four prep reports are ready to read before it opens.',
    attempt: 1,
    sentAt: ago(9),
    acknowledgedAt: ago(8.5),
  },
  {
    id: 'note_5',
    kind: 'general',
    title: 'Daily token cap at 80%',
    text: 'Tomorrow’s shifts run as planned; overnight audits will be skipped if the cap is reached.',
    attempt: 1,
    sentAt: ago(22),
    acknowledgedAt: ago(21),
  },
];

/** Query answers for the triage pages under the fixture route. */
export const triageQueries: FixtureQueries = {
  'triage:alerts': alerts,
  'triage:timeline': (args: unknown) => timelines[(args as { alertId?: string }).alertId ?? ''] ?? [],
  'triage:incidentReports': reports,
  'triage:intake': intake,
  'notifications:list': notifications,
};
