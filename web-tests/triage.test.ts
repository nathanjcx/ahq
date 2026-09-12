import { createHmac } from 'node:crypto';
import { makeFunctionReference } from 'convex/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../convex/_generated/api';
import type { Backend } from '../lib/server/backend';
import { installBackend } from '../lib/server/backend';
import { resetRateLimits } from '../lib/server/rate-limit';
import { seal } from '../lib/server/secrets';
import {
  harness,
  hireOne,
  identity as orgIdentity,
  linearWorkspace,
  publishEmployee,
  secret,
} from './support';

const appUrl = 'https://hq.example.com';
const alertSecret = 'alert-signing-secret-that-is-long-enough';
// A Wednesday. Attended hours default to nine to six, Monday to Friday, in UTC.
const attendedNow = Date.UTC(2026, 8, 16, 12);
const unattendedNow = Date.UTC(2026, 8, 16, 3);

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ userId: 'platform-admin' }),
  clerkClient: async () => ({ users: { getUser: async () => ({ fullName: 'Admin' }) } }),
  clerkMiddleware: () => () => undefined,
}));

type Harness = ReturnType<typeof harness>;

/** Routes the service call names a route makes into convex-test, the way security.test.ts does. */
function testBackend(t: Harness): Backend {
  const run = async <T>(kind: 'query' | 'mutation', name: string, args: Record<string, unknown> = {}) => {
    const reference = makeFunctionReference<'query' & 'mutation'>(name);
    const withSecret = { ...args, secret };
    return (
      kind === 'query' ? t.query(reference, withSecret) : t.mutation(reference, withSecret)
    ) as Promise<T>;
  };
  return {
    query: (name, args) => run('query', name, args),
    mutate: (name, args) => run('mutation', name, args),
    journalMutation: (name, args) => run('mutation', name, args),
  };
}

async function workspace() {
  const t = harness();
  await linearWorkspace(t);
  const { listingId } = await publishEmployee(t);
  const user = t.withIdentity(orgIdentity('owner', 'acme', 'org:admin'));
  const { workspaceId } = await user.mutation(api.workspace.bootstrap, { name: 'Acme' });
  const { employeeId } = await hireOne(user, listingId);
  const { floorId } = await user.mutation(api.floors.create, {
    name: 'Launch',
    brief: 'Prepare the launch.',
    employeeIds: [employeeId],
  });
  return { t, user, workspaceId, floorId, employeeId };
}

const incident = {
  source: 'webhook' as const,
  fingerprint: 'uptime:checkout',
  severity: 'critical' as const,
  title: 'Checkout is returning 500',
  detail: 'Five consecutive probes failed.',
  url: 'https://status.example.com/checkout',
};

beforeEach(() => {
  process.env.APP_URL = appUrl;
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_key';
  process.env.CLERK_SECRET_KEY = 'sk_test_key';
  process.env.CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  resetRateLimits();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('alert intake', () => {
  it('opens one triage task per fingerprint and counts the repeats', async () => {
    const { t, user, workspaceId, floorId } = await workspace();
    const first = await t.mutation(api.services.triage.ingest, {
      secret,
      workspaceId,
      ...incident,
      affectedFloorIds: [floorId],
    });
    expect(first.created).toBe(true);

    // The reserved Triage floor, its one triage instance, and the triage task all exist now.
    const { floorId: triageFloorId, employeeId: triageEmployeeId } = await user.mutation(
      api.triage.ensureTriageFloor,
      {},
    );
    const triageFloor = await t.run((ctx) => ctx.db.get(triageFloorId));
    expect(triageFloor).toMatchObject({ name: 'Triage', reserved: 'triage' });
    expect(await t.run((ctx) => ctx.db.get(triageEmployeeId))).toMatchObject({
      kind: 'triage',
      floorId: triageFloorId,
    });
    const task = await t.run((ctx) => ctx.db.get(first.taskId!));
    expect(task).toMatchObject({ floorId: triageFloorId, employeeId: triageEmployeeId });
    // The alert is a provider's words, so it reaches the model as material, not as orders.
    expect(task?.prompt).toContain('--- Untrusted context');
    expect(task?.prompt).toContain('Five consecutive probes failed.');

    const repeat = await t.mutation(api.services.triage.ingest, { secret, workspaceId, ...incident });
    expect(repeat).toEqual({ alertId: first.alertId, taskId: first.taskId, created: false });
    expect(await user.query(api.triage.alerts, { status: 'open' })).toEqual([
      expect.objectContaining({
        id: first.alertId,
        occurrences: 2,
        severity: 'critical',
        affectedFloorIds: [floorId],
      }),
    ]);

    // Triage hears about every incident; an affected floor hears about its own.
    for (const scope of [
      { kind: 'triage' as const, scopeId: '' },
      { kind: 'floor' as const, scopeId: floorId },
    ]) {
      const { channelId } = await user.mutation(api.channels.open, scope);
      const posts = await user.query(api.channels.posts, { channelId });
      expect(posts.filter((post) => post.kind === 'alert').map((post) => post.text)).toEqual([
        expect.stringContaining('CRITICAL: Checkout is returning 500'),
      ]);
    }

    await user.mutation(api.triage.dismiss, { alertId: first.alertId });
    expect(await user.query(api.triage.alerts, { status: 'dismissed' })).toHaveLength(1);
    await expect(user.mutation(api.triage.close, { alertId: first.alertId })).rejects.toThrow(
      'was dismissed',
    );
  });

  it('matches a GitHub delivery only against the workspace rules', async () => {
    const { t, user, workspaceId } = await workspace();
    const payload = JSON.stringify({
      action: 'opened',
      issue: {
        number: 42,
        title: 'Checkout fails on Safari',
        body: 'Steps to reproduce inside.',
        html_url: 'https://github.com/acme/shop/issues/42',
        labels: [{ name: 'incident' }],
      },
      repository: { id: 9, full_name: 'acme/shop' },
    });

    // No rules configured: a delivery is inbox, never an alert.
    expect(await t.mutation(api.services.triage.matchGithub, { secret, workspaceId, payload })).toEqual({
      matched: false,
    });
    await user.mutation(api.triage.setRules, { rules: ['Incident', 'sev1'] });
    expect(await user.query(api.triage.rules, {})).toEqual(['incident', 'sev1']);

    const matched = await t.mutation(api.services.triage.matchGithub, { secret, workspaceId, payload });
    expect(matched).toMatchObject({ matched: true, rule: 'incident', created: true });
    expect(await user.query(api.triage.alerts, {})).toEqual([
      expect.objectContaining({
        source: 'github',
        fingerprint: 'github:acme/shop#42',
        title: 'Checkout fails on Safari',
        url: 'https://github.com/acme/shop/issues/42',
      }),
    ]);
    // The same issue again is the same incident.
    expect(await t.mutation(api.services.triage.matchGithub, { secret, workspaceId, payload })).toMatchObject(
      { matched: true, created: false },
    );

    const unmatched = JSON.stringify({
      issue: { number: 43, title: 'Typo in the footer', body: '', labels: [] },
      repository: { id: 9, full_name: 'acme/shop' },
    });
    expect(
      await t.mutation(api.services.triage.matchGithub, { secret, workspaceId, payload: unmatched }),
    ).toEqual({ matched: false });

    const colleague = t.withIdentity(orgIdentity('colleague', 'acme'));
    await expect(colleague.mutation(api.triage.setRules, { rules: ['sev2'] })).rejects.toThrow(
      'administrator access required',
    );
  });
});

describe('triage authority', () => {
  it('opens the emergency path only outside attended hours after delivered pages went unanswered', async () => {
    const { t, user, workspaceId } = await workspace();
    // `setRules` creates the settings row from the defaults; the allow-lists belong to Settings.
    await user.mutation(api.triage.setRules, { rules: ['sev1'] });
    await t.run(async (ctx) => {
      const settings = await ctx.db
        .query('workspaceSettings')
        .withIndex('by_workspace', (q) => q.eq('workspaceId', workspaceId))
        .unique();
      if (!settings) throw new Error('Expected settings');
      await ctx.db.patch(settings._id, {
        triageAllowList: ['create_pull_request'],
        emergencyAllowList: ['merge_pull_request', 'deploy'],
      });
    });

    const { alertId, taskId } = await t.mutation(api.services.triage.ingest, {
      secret,
      workspaceId,
      ...incident,
    });
    if (!taskId) throw new Error('Expected a triage task');
    const runToken = await t.run(async (ctx) => (await ctx.db.get(taskId))?.runToken ?? '');
    const authority = () => t.query(api.services.triage.authority, { secret, runToken });

    vi.useFakeTimers();
    vi.setSystemTime(attendedNow);
    expect(await authority()).toEqual({
      attended: true,
      allowList: ['create_pull_request'],
      emergencyAllowList: ['merge_pull_request', 'deploy'],
      unattendedAttempts: 0,
    });

    vi.setSystemTime(unattendedNow);
    expect((await authority()).attended).toBe(false);

    // A recorded attempt does not count until a channel delivered it.
    const attempts = await t.mutation(api.services.notifications.attempt, {
      secret,
      workspaceId,
      kind: 'triage',
      title: incident.title,
      text: incident.detail,
      alertId,
    });
    expect(attempts).toEqual([expect.objectContaining({ subject: 'owner', attempt: 1 })]);
    expect((await authority()).unattendedAttempts).toBe(0);
    await t.mutation(api.services.notifications.markDelivered, {
      secret,
      id: attempts[0].id,
      channel: 'in_app',
    });
    expect((await authority()).unattendedAttempts).toBe(1);

    // Acknowledging is an answer: the count drops back and the emergency path closes.
    await user.mutation(api.notifications.acknowledge, { id: attempts[0].id });
    expect((await authority()).unattendedAttempts).toBe(0);
    expect(await user.query(api.notifications.list, {})).toEqual([
      expect.objectContaining({ attempt: 1, acknowledgedAt: unattendedNow }),
    ]);

    // A page older than the twenty-minute window never authorizes anything.
    const second = await t.mutation(api.services.notifications.attempt, {
      secret,
      workspaceId,
      kind: 'triage',
      title: incident.title,
      text: incident.detail,
      alertId,
    });
    expect(second[0].attempt).toBe(2);
    await t.mutation(api.services.notifications.markDelivered, {
      secret,
      id: second[0].id,
      channel: 'in_app',
    });
    expect((await authority()).unattendedAttempts).toBe(1);
    vi.setSystemTime(unattendedNow + 21 * 60_000);
    expect((await authority()).unattendedAttempts).toBe(0);
  });

  it('posts the post-mortem to the affected floors and proposes the prevention to memory', async () => {
    const { t, user, workspaceId, floorId } = await workspace();
    const { alertId, taskId } = await t.mutation(api.services.triage.ingest, {
      secret,
      workspaceId,
      ...incident,
      affectedFloorIds: [floorId],
    });
    if (!taskId) throw new Error('Expected a triage task');
    await t.mutation(api.services.triage.resolve, {
      secret,
      taskId,
      cause: 'A null price broke the total.',
      fix: 'Guard the total and backfill the rows.',
      prevention: 'Validate prices at write time.',
      regressionRef: 'web-tests/checkout.test.ts',
    });

    const { channelId } = await user.mutation(api.channels.open, { kind: 'floor', scopeId: floorId });
    const findings = (await user.query(api.channels.posts, { channelId })).filter(
      (post) => post.kind === 'finding',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].text).toContain('Prevention: Validate prices at write time.');
    expect(await user.query(api.triage.alerts, { status: 'fixed' })).toEqual([
      expect.objectContaining({ id: alertId }),
    ]);
    const memories = await t.run((ctx) => ctx.db.query('memories').collect());
    expect(memories).toEqual([
      expect.objectContaining({ scope: 'workspace', status: 'proposed', author: 'agent' }),
    ]);
  });
});

describe('the signed alert route', () => {
  it('accepts a signed body, refuses a forged or stale one, and pages on a new critical alert', async () => {
    const { t, workspaceId } = await workspace();
    installBackend(testBackend(t));
    await t.mutation(api.services.triage.setAlertSecret, {
      secret,
      workspaceId,
      alertSecretCiphertext: seal(alertSecret),
    });

    const { POST } = await import('../app/api/alerts/route');
    const call = (body: string, headers: Record<string, string>) =>
      POST(new Request(`${appUrl}/api/alerts`, { method: 'POST', headers, body }));
    const sign = (timestamp: number, body: string) =>
      createHmac('sha256', alertSecret).update(`${timestamp}.${body}`).digest('hex');
    const body = JSON.stringify({
      source: 'webhook',
      fingerprint: incident.fingerprint,
      severity: 'critical',
      title: incident.title,
      detail: incident.detail,
      url: incident.url,
    });
    const timestamp = Date.now();
    const signed = {
      'x-astra-workspace': workspaceId,
      'x-astra-timestamp': String(timestamp),
      'x-astra-signature': sign(timestamp, body),
    };

    const accepted = await call(body, signed);
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ accepted: true, alertId: expect.any(String), duplicate: false });
    // A critical alert pages the workspace; only `in_app` is configured, so exactly one row delivers.
    const notifications = await t.run((ctx) => ctx.db.query('notifications').collect());
    expect(notifications).toEqual([
      expect.objectContaining({ subject: 'owner', attempt: 1, deliveredChannel: 'in_app' }),
    ]);

    // The same body signed again is the same incident, and pages nobody a second time.
    const repeat = await call(body, { ...signed, 'x-astra-signature': sign(timestamp, body) });
    expect(await repeat.json()).toMatchObject({ duplicate: true });
    expect(await t.run((ctx) => ctx.db.query('notifications').collect())).toHaveLength(1);

    const refused: [string, Record<string, string>, number][] = [
      ['no workspace', { ...signed, 'x-astra-workspace': '' }, 400],
      ['bad signature', { ...signed, 'x-astra-signature': '0'.repeat(64) }, 401],
      ['no signature', { ...signed, 'x-astra-signature': 'not-hex' }, 401],
      [
        'stale timestamp',
        {
          ...signed,
          'x-astra-timestamp': String(timestamp - 400_000),
          'x-astra-signature': sign(timestamp - 400_000, body),
        },
        401,
      ],
    ];
    for (const [, headers, status] of refused) {
      resetRateLimits();
      expect((await call(body, headers)).status).toBe(status);
    }
    // A body that verifies but is not an alert is a plain 400, and never reaches Convex.
    resetRateLimits();
    const malformed = JSON.stringify({ source: 'webhook', title: 'No fingerprint' });
    const bad = await call(malformed, { ...signed, 'x-astra-signature': sign(timestamp, malformed) });
    expect(bad.status).toBe(400);
    expect(await t.run((ctx) => ctx.db.query('alerts').collect())).toHaveLength(1);
  });
});
