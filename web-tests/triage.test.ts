import { createHmac } from 'node:crypto';
import { makeFunctionReference } from 'convex/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../convex/_generated/api';
import type { Backend } from '../lib/server/backend';
import { installBackend } from '../lib/server/backend';
import { resetRateLimits } from '../lib/server/rate-limit';
import { seal } from '../lib/server/secrets';
import {
  connectLinear,
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
      emergency: false,
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
    // Nor does the in-app row, which lands whether or not anybody ever looked at it.
    await t.mutation(api.services.notifications.markDelivered, {
      secret,
      id: attempts[0].id,
      channel: 'in_app',
    });
    expect((await authority()).unattendedAttempts).toBe(0);
    await t.run(async (ctx) =>
      ctx.db.patch(attempts[0].id, { deliveredChannel: 'push' }),
    );
    expect((await authority()).unattendedAttempts).toBe(1);

    // Acknowledging is an answer: the count drops back and the emergency path closes.
    await user.mutation(api.notifications.acknowledge, { id: attempts[0].id });
    expect((await authority()).unattendedAttempts).toBe(0);
    expect(await user.query(api.notifications.list, {})).toEqual([
      expect.objectContaining({ attempt: 1, acknowledgedAt: unattendedNow }),
    ]);

    // Pages after the acknowledgement start the count again, and it only grows from there.
    const page = async () => {
      const rows = await t.mutation(api.services.notifications.attempt, {
        secret,
        workspaceId,
        kind: 'triage',
        title: incident.title,
        text: incident.detail,
        alertId,
      });
      for (const row of rows)
        await t.mutation(api.services.notifications.markDelivered, {
          secret,
          id: row.id,
          channel: 'push',
        });
      return rows[0];
    };
    vi.setSystemTime(unattendedNow + 60_000);
    const second = await page();
    expect(second.attempt).toBe(2);
    expect((await authority()).unattendedAttempts).toBe(1);
    vi.setSystemTime(unattendedNow + 8 * 60_000);
    await page();
    vi.setSystemTime(unattendedNow + 15 * 60_000);
    await page();
    // Three attempts stand, but the first of them is not yet twenty minutes old.
    expect(await authority()).toMatchObject({ unattendedAttempts: 3, emergency: false });
    vi.setSystemTime(unattendedNow + 22 * 60_000);
    expect(await authority()).toMatchObject({ unattendedAttempts: 3, emergency: true });
    // Answering resets the rule: every page sent before the answer is spent, and the emergency
    // allow-list shuts again until three new ones stand unanswered.
    await user.mutation(api.notifications.acknowledge, { id: second.id });
    expect(await authority()).toMatchObject({ unattendedAttempts: 0, emergency: false });
  });

  it('counts one page to three people as one page', async () => {
    const { t, user, workspaceId, employeeId } = await workspace();
    // Three people the workspace can reach: `workspaceSubjects` is everyone who opened a floor here.
    for (const person of ['alice', 'bob']) {
      const colleague = t.withIdentity(orgIdentity(person, 'acme', 'org:admin'));
      await colleague.mutation(api.floors.create, {
        name: `${person}'s floor`,
        brief: 'Somewhere to work.',
        employeeIds: [],
      });
    }
    await user.mutation(api.triage.setRules, { rules: ['sev1'] });
    await t.run(async (ctx) => {
      const settings = await ctx.db
        .query('workspaceSettings')
        .withIndex('by_workspace', (q) => q.eq('workspaceId', workspaceId))
        .unique();
      if (!settings) throw new Error('Expected settings');
      await ctx.db.patch(settings._id, {
        emergencyAllowList: ['merge_pull_request'],
        notificationChannels: ['push'],
      });
      await ctx.db.patch(employeeId, { kind: 'triage' });
    });
    const { alertId, taskId } = await t.mutation(api.services.triage.ingest, {
      secret,
      workspaceId,
      ...incident,
    });
    if (!taskId) throw new Error('Expected a triage task');
    const runToken = await t.run(async (ctx) => (await ctx.db.get(taskId))?.runToken ?? '');

    vi.useFakeTimers();
    const page = async (minutes: number) => {
      vi.setSystemTime(unattendedNow + minutes * 60_000);
      const rows = await t.mutation(api.services.triage.pageAlert, { secret, alertId });
      for (const row of rows)
        await t.mutation(api.services.notifications.markDelivered, {
          secret,
          id: row.id,
          channel: 'push',
        });
      return rows;
    };

    // One page, three people told, one attempt on the ledger — and no gate twenty minutes later.
    const first = await page(0);
    expect(first.map((row) => [row.subject, row.attempt]).sort()).toEqual([
      ['alice', 1],
      ['bob', 1],
      ['owner', 1],
    ]);
    expect(first[0].text).toContain('Attempt 1 of 3');
    vi.setSystemTime(unattendedNow + 25 * 60_000);
    expect(await t.query(api.services.triage.authority, { secret, runToken })).toMatchObject({
      unattendedAttempts: 1,
      emergency: false,
    });

    // Three pages is three rounds of paging everybody, and only then does the rule open.
    expect((await page(8))[0].text).toContain('Attempt 2 of 3');
    await page(16);
    vi.setSystemTime(unattendedNow + 25 * 60_000);
    expect(await t.query(api.services.triage.authority, { secret, runToken })).toMatchObject({
      unattendedAttempts: 3,
      emergency: true,
    });
    expect(await t.run(async (ctx) => ctx.db.query('notifications').collect())).toHaveLength(9);
    // A fourth page is not due: the ledger is full.
    expect(await page(24)).toEqual([]);
  });

  it('refuses to write through a connection its owner kept private', async () => {
    const { t, user, workspaceId, employeeId } = await workspace();
    await user.mutation(api.triage.setRules, { rules: ['sev1'] });
    await t.run(async (ctx) => {
      const settings = await ctx.db
        .query('workspaceSettings')
        .withIndex('by_workspace', (q) => q.eq('workspaceId', workspaceId))
        .unique();
      if (!settings) throw new Error('Expected settings');
      await ctx.db.patch(settings._id, { triageAllowList: ['create_pull_request'] });
      await ctx.db.patch(employeeId, { kind: 'triage' });
    });
    const connectionId = await t.run(async (ctx) =>
      ctx.db.insert('connections', {
        workspaceId,
        ownerSubject: 'colleague',
        ownerName: 'Colleague',
        visibility: 'private',
        visibleToSubjects: [],
        provider: 'github',
        name: 'Their own fork',
        account: 'colleague',
        status: 'connected',
        tools: ['create_pull_request'],
        allowedTools: ['create_pull_request'],
        resourceScope: '',
        inboxResources: [],
        inboxMode: 'unsupported',
        serverUrl: 'https://mcp.example.com/github',
        credentialCiphertext: seal({ token: 'theirs' }),
        credentialKeyVersion: 'v1',
        createdAt: Date.now(),
      }),
    );
    const { taskId } = await t.mutation(api.services.triage.ingest, { secret, workspaceId, ...incident });
    if (!taskId) throw new Error('Expected a triage task');
    const runToken = await t.run(async (ctx) => (await ctx.db.get(taskId))?.runToken ?? '');

    // The credential belongs to the member who connected it, not to the workspace's triage rule.
    expect((await t.query(api.services.triage.writeConnections, { secret, runToken })).connections).toEqual(
      [],
    );
    const journal = () =>
      t.mutation(api.services.actions.recordToolCall, {
        secret,
        runToken,
        connectionId,
        tool: 'create_pull_request',
        argumentsCiphertext: seal({ title: 'Fix it' }),
        outcome: 'started' as const,
        operationId: 'op-private',
      });
    await expect(journal()).rejects.toThrow('Tool is not authorized for this task');

    // Shared with the workspace, the same grant is exactly what triage may use.
    await t.run(async (ctx) => ctx.db.patch(connectionId, { visibility: 'workspace' }));
    expect(
      (await t.query(api.services.triage.writeConnections, { secret, runToken })).connections.map(
        (row) => row.allowedTools,
      ),
    ).toEqual([['create_pull_request']]);
    await expect(journal()).resolves.toMatchObject({ toolCallId: expect.anything() });
  });

  it('sees an emergency call behind a long journal, and wants a report newer than it', async () => {
    const { t, user, workspaceId, employeeId } = await workspace();
    await user.mutation(api.triage.setRules, { rules: ['sev1'] });
    await t.run(async (ctx) => {
      const settings = await ctx.db
        .query('workspaceSettings')
        .withIndex('by_workspace', (q) => q.eq('workspaceId', workspaceId))
        .unique();
      if (!settings) throw new Error('Expected settings');
      await ctx.db.patch(settings._id, {
        triageAllowList: ['create_pull_request'],
        emergencyAllowList: ['merge_pull_request'],
      });
      await ctx.db.patch(employeeId, { kind: 'triage' });
    });
    const { taskId } = await t.mutation(api.services.triage.ingest, { secret, workspaceId, ...incident });
    if (!taskId) throw new Error('Expected a triage task');
    const connectionId = await t.run(async (ctx) =>
      ctx.db.insert('connections', {
        workspaceId,
        ownerSubject: 'owner',
        ownerName: 'Owner',
        visibility: 'workspace',
        visibleToSubjects: [],
        provider: 'github',
        name: 'The forge',
        account: 'acme',
        status: 'connected',
        tools: ['merge_pull_request'],
        allowedTools: ['merge_pull_request'],
        resourceScope: '',
        inboxResources: [],
        inboxMode: 'unsupported',
        serverUrl: 'https://mcp.example.com/github',
        credentialCiphertext: seal({ token: 'ours' }),
        credentialKeyVersion: 'v1',
        createdAt: Date.now(),
      }),
    );

    // The incident's task is reused for the whole life of the alert, and every dispatch journals a
    // started row beside its terminal one, so an emergency call is soon far from the oldest rows.
    const journal = async (tool: string, outcome: 'started' | 'succeeded', operationId: string) =>
      t.run(async (ctx) =>
        ctx.db.insert('toolCalls', {
          workspaceId,
          taskId,
          connectionId,
          operationId,
          outcome,
          tool,
          argumentsCiphertext: 'x',
          createdAt: Date.now(),
        }),
      );
    for (let call = 0; call < 205; call++) {
      await journal('get_pull_request', 'started', `op-${call}`);
      await journal('get_pull_request', 'succeeded', `op-${call}`);
    }
    await journal('merge_pull_request', 'started', 'op-emergency');
    await journal('merge_pull_request', 'succeeded', 'op-emergency');

    // Four hundred rows of ordinary work do not hide what the run did without permission.
    const close = () => t.mutation(api.services.triage.closeRun, { secret, taskId });
    expect(await close()).toEqual({ emergency: true, reportMissing: true });
    // Closing twice files nothing twice: the placeholder answers for that call.
    expect(await close()).toEqual({ emergency: true, reportMissing: false });

    // A second emergency action is its own act, and a report written before it does not answer for it.
    await journal('merge_pull_request', 'succeeded', 'op-emergency-2');
    expect(await close()).toEqual({ emergency: true, reportMissing: true });
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
    await t.mutation(api.services.triage.setAlertSecretForActor, {
      secret,
      authSubject: 'owner',
      authOrgId: 'acme',
      authOrgRole: 'org:admin',
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

describe('what the Triage page reads', () => {
  it('reports paging state, the timeline, and acknowledgement across the whole incident', async () => {
    const { t, user, workspaceId, floorId } = await workspace();
    await user.mutation(api.triage.setRules, { rules: ['sev1'] });
    await t.run(async (ctx) => {
      const settings = await ctx.db
        .query('workspaceSettings')
        .withIndex('by_workspace', (q) => q.eq('workspaceId', workspaceId))
        .unique();
      if (!settings) throw new Error('Expected settings');
      await ctx.db.patch(settings._id, {
        triageAllowList: ['create_pull_request'],
        emergencyAllowList: ['merge_pull_request'],
      });
    });
    const { alertId } = await t.mutation(api.services.triage.ingest, { secret, workspaceId, ...incident });

    vi.useFakeTimers();
    vi.setSystemTime(unattendedNow);

    // A fresh alert has paged nobody, so the emergency window has not started.
    const fresh = await user.query(api.triage.alerts, {});
    expect(fresh).toHaveLength(1);
    expect(fresh[0].paging).toMatchObject({ attempts: 0, required: 3, acknowledged: false });

    // Two delivered pages: the count rises and the interface is told when the list would open.
    for (const minutes of [0, 8]) {
      vi.setSystemTime(unattendedNow + minutes * 60_000);
      const [attempt] = await t.mutation(api.services.notifications.attempt, {
        secret,
        workspaceId,
        kind: 'triage',
        title: incident.title,
        text: incident.detail,
        alertId,
      });
      await t.mutation(api.services.notifications.markDelivered, {
        secret,
        id: attempt.id,
        channel: 'push',
      });
    }
    const paged = (await user.query(api.triage.alerts, {}))[0].paging;
    expect(paged).toMatchObject({ attempts: 2, required: 3, acknowledged: false });
    // The wait runs from the first page that still stands, not from the latest one.
    expect(paged.opensAt).toBe(unattendedNow + 20 * 60_000);

    // Acknowledging the alert answers every page it sent this viewer at once.
    expect(await user.mutation(api.triage.acknowledgeAlert, { alertId })).toEqual({ acknowledged: 2 });
    expect((await user.query(api.triage.alerts, {}))[0].paging).toMatchObject({
      attempts: 0,
      acknowledged: true,
    });

    // The affected floors are the person's to correct, and the timeline carries every step.
    await user.mutation(api.triage.assignFloors, { alertId, floorIds: [floorId] });
    const timeline = await user.query(api.triage.timeline, { alertId });
    expect(timeline.map((entry) => entry.kind)).toEqual(['intake', 'run', 'post', 'page', 'page']);
    expect(timeline[0]).toMatchObject({ title: 'webhook alert received' });
    expect(timeline.every((entry, index) => index === 0 || entry.at >= timeline[index - 1].at)).toBe(true);
    expect((await user.query(api.triage.alerts, {}))[0].affectedFloorIds).toEqual([floorId]);
  });

  it('names the incident reports and says which of them acted without permission', async () => {
    const { t, user, workspaceId } = await workspace();
    await user.mutation(api.triage.setRules, { rules: ['sev1'] });
    await connectLinear(t, { subject: 'owner', orgId: 'acme' });
    const connectionId = await t.run(async (ctx) => {
      const settings = await ctx.db
        .query('workspaceSettings')
        .withIndex('by_workspace', (q) => q.eq('workspaceId', workspaceId))
        .unique();
      if (!settings) throw new Error('Expected settings');
      await ctx.db.patch(settings._id, {
        triageAllowList: ['create_pull_request'],
        emergencyAllowList: ['merge_pull_request'],
      });
      const connection = await ctx.db.query('connections').first();
      if (!connection) throw new Error('Expected a connection');
      return connection._id;
    });
    const { taskId } = await t.mutation(api.services.triage.ingest, { secret, workspaceId, ...incident });
    if (!taskId) throw new Error('Expected a triage task');

    // Intake alone files nothing; the post-mortem is what becomes a report.
    expect(await user.query(api.triage.incidentReports, {})).toEqual([]);
    await t.mutation(api.services.triage.resolve, {
      secret,
      taskId,
      cause: 'The connection pool cap stayed at 20.',
      fix: 'Raised it to 60.',
      prevention: 'Pin the pool cap to the worker count.',
      regressionRef: 'web-tests/pool.test.ts',
    });
    const [ordinary] = await user.query(api.triage.incidentReports, {});
    expect(ordinary).toMatchObject({ emergency: false, alertTitle: incident.title, taskId });

    // One succeeded call on the emergency list is what makes it an emergency report.
    await t.run((ctx) =>
      ctx.db.insert('toolCalls', {
        workspaceId,
        taskId,
        connectionId,
        operationId: 'op_merge',
        outcome: 'succeeded',
        tool: 'merge_pull_request',
        argumentsCiphertext: 'sealed',
        createdAt: Date.now(),
      }),
    );
    expect((await user.query(api.triage.incidentReports, {}))[0].emergency).toBe(true);
    const timeline = await user.query(api.triage.timeline, { alertId: ordinary.alertId! });
    expect(timeline.find((entry) => entry.kind === 'tool')).toMatchObject({
      title: 'merge_pull_request',
      authority: 'emergency',
      outcome: 'succeeded',
    });
  });

  it('describes intake without ever handing back the signing secret', async () => {
    const { t, user } = await workspace();
    expect(await user.query(api.triage.intake, {})).toMatchObject({
      signedEndpointReady: false,
      rules: [],
      emailClassification: false,
    });
    await user.mutation(api.triage.setRules, { rules: ['SEV1', 'sev1', 'outage'] });
    await t.mutation(api.services.triage.setAlertSecretForActor, {
      secret,
      authSubject: 'owner',
      authOrgId: 'acme',
      authOrgRole: 'org:admin',
      alertSecretCiphertext: seal(alertSecret),
    });
    const intake = await user.query(api.triage.intake, {});
    expect(intake).toMatchObject({
      signedEndpointReady: true,
      rules: ['sev1', 'outage'],
      secretUpdatedAt: expect.any(Number),
    });
    expect(JSON.stringify(intake)).not.toContain(alertSecret);
  });

  it('lets a workspace administrator set and clear the signing secret, and nobody else', async () => {
    const { t, user } = await workspace();
    const rotate = (subject: string, orgRole: string, ciphertext?: string) =>
      t.mutation(api.services.triage.setAlertSecretForActor, {
        secret,
        authSubject: subject,
        authOrgId: 'acme',
        authOrgRole: orgRole,
        ...(ciphertext ? { alertSecretCiphertext: ciphertext } : {}),
      });

    await expect(rotate('member', 'org:member', seal(alertSecret))).rejects.toThrow(
      'administrator access required',
    );
    expect(await user.query(api.triage.intake, {})).toMatchObject({ signedEndpointReady: false });

    const { updatedAt } = await rotate('owner', 'org:admin', seal(alertSecret));
    expect(await user.query(api.triage.intake, {})).toMatchObject({
      signedEndpointReady: true,
      secretUpdatedAt: updatedAt,
    });
    // The sealed secret is still only readable by the service that verifies a signature.
    expect(
      await t.query(api.services.triage.alertSecret, {
        secret,
        workspaceId: (await user.query(api.workspace.dashboard, {})).workspace!.id,
      }),
    ).toContain('.');

    // Writing no ciphertext clears it, which closes the signed endpoint.
    await rotate('owner', 'org:admin');
    expect(await user.query(api.triage.intake, {})).toMatchObject({ signedEndpointReady: false });
  });
});
