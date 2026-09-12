import type { LookupFunction } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import { defaultWorkspaceSettings } from '../lib/contracts';
import { installBackend } from '../lib/server/backend';
import { deliverNotifications } from '../lib/server/notify';
import { seal } from '../lib/server/secrets';
import { harness, identity, secret, testBackend, type Harness } from './support';

/**
 * A stand-in for the push service. `web-push` speaks HTTPS to a real endpoint, so what is exercised
 * here is everything this application decides: which channel is tried, what the payload says, what
 * the ledger records, and what happens to a subscription the endpoint says is gone.
 */
interface Sent {
  endpoint: string;
  payload: string;
  agent?: { options: { lookup?: LookupFunction } };
}
const sent: Sent[] = [];
let refuse: ((endpoint: string) => Error | undefined) | undefined;

vi.mock('web-push', () => {
  class WebPushError extends Error {
    constructor(public statusCode: number) {
      super(`push endpoint answered ${statusCode}`);
    }
  }
  return {
    default: {
      setVapidDetails: () => {},
      sendNotification: async (
        subscription: { endpoint: string },
        payload: string,
        options?: { agent?: Sent['agent'] },
      ) => {
        const failure = refuse?.(subscription.endpoint);
        if (failure) throw failure;
        sent.push({ endpoint: subscription.endpoint, payload, agent: options?.agent });
      },
    },
    WebPushError,
  };
});

/** The mocked error class, as the module under test sees it. */
const { WebPushError } = (await import('web-push')) as unknown as {
  WebPushError: new (statusCode: number) => Error;
};

const subject = 'push-owner';

/** A workspace with one person, two registered browsers, and one triage notification to deliver. */
async function workspace() {
  const t = harness();
  installBackend(testBackend(t));
  const user = t.withIdentity(identity(subject));
  await user.mutation(api.workspace.bootstrap, { name: 'Acme' });
  await user.mutation(api.floors.create, { name: 'Platform', brief: 'The floor.', employeeIds: [] });
  const workspaceId = String(await t.run(async (ctx) => (await ctx.db.query('workspaces').first())?._id));
  for (const endpoint of ['https://push.example/live', 'https://push.example/stale'])
    await subscribe(t, endpoint);
  return { t, workspaceId };
}

async function subscribe(t: Harness, endpoint: string) {
  return t.mutation(api.services.notifications.subscribePush, {
    secret,
    authSubject: subject,
    endpoint,
    keysCiphertext: seal({ p256dh: 'key', auth: 'auth' }),
  });
}

async function attempts(
  t: Harness,
  workspaceId: string,
  channels: string[],
  message: { title?: string; text?: string } = {},
) {
  await t.run(async (ctx) => {
    const settings = await ctx.db
      .query('workspaceSettings')
      .filter((q) => q.eq(q.field('workspaceId'), workspaceId))
      .unique();
    if (settings) await ctx.db.patch(settings._id, { notificationChannels: channels });
    else
      await ctx.db.insert('workspaceSettings', {
        ...defaultWorkspaceSettings,
        workspaceId: workspaceId as Id<'workspaces'>,
        timezone: 'UTC',
        notificationChannels: channels,
        updatedAt: Date.now(),
      });
  });
  return t.mutation(api.services.notifications.attempt, {
    secret,
    workspaceId: workspaceId as Id<'workspaces'>,
    kind: 'triage',
    title: message.title ?? 'Payments are down',
    text: message.text ?? 'Nobody has answered.',
  });
}

let harnessState: Awaited<ReturnType<typeof workspace>>;

beforeEach(async () => {
  sent.length = 0;
  refuse = undefined;
  process.env.CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  harnessState = await workspace();
});

afterEach(() => {
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_SUBJECT;
});

/** A deployment that carries a VAPID key pair, which is what turns the push channel on. */
function configureVapid() {
  process.env.VAPID_PUBLIC_KEY = 'public';
  process.env.VAPID_PRIVATE_KEY = 'private';
  process.env.VAPID_SUBJECT = 'mailto:ops@example.com';
}

describe('notification delivery', () => {
  it('pushes to every registered browser and counts the attempt delivered', async () => {
    configureVapid();
    const { t, workspaceId } = harnessState;
    const rows = await attempts(t, workspaceId, ['in_app', 'push']);

    expect(await deliverNotifications(rows)).toEqual({ delivered: 1, undelivered: 0 });
    expect(sent.map((row) => row.endpoint).sort()).toEqual([
      'https://push.example/live',
      'https://push.example/stale',
    ]);
    expect(JSON.parse(sent[0].payload)).toMatchObject({ title: 'Payments are down', kind: 'triage' });
    // The real transport is what the ledger records, not the row it also wrote.
    const [stored] = await t.run(async (ctx) => ctx.db.query('notifications').collect());
    expect(stored).toMatchObject({ deliveredChannel: 'push', deliveredAt: expect.any(Number) });
  });

  it('prunes a subscription the endpoint reports gone and still delivers to the live one', async () => {
    configureVapid();
    const { t, workspaceId } = harnessState;
    refuse = (endpoint) => (endpoint.endsWith('/stale') ? new WebPushError(410) : undefined);
    const rows = await attempts(t, workspaceId, ['push', 'in_app']);

    expect(await deliverNotifications(rows)).toEqual({ delivered: 1, undelivered: 0 });
    expect(sent.map((row) => row.endpoint)).toEqual(['https://push.example/live']);
    expect(
      (await t.run(async (ctx) => ctx.db.query('pushSubscriptions').collect())).map(
        (row) => row.endpoint,
      ),
    ).toEqual(['https://push.example/live']);
  });

  it('truncates an alert title too long for a notification row instead of paging nobody', async () => {
    configureVapid();
    const { t, workspaceId } = harnessState;
    // An alert title may be 300 characters. The row holds 200, and the page must still go out.
    const rows = await attempts(t, workspaceId, ['push'], { title: 'A'.repeat(300) });

    expect(rows[0].title).toBe('A'.repeat(200));
    expect(await deliverNotifications(rows)).toEqual({ delivered: 1, undelivered: 0 });
    expect(JSON.parse(sent[0].payload).title).toBe('A'.repeat(200));
  });

  it('keeps push inside the public internet', async () => {
    configureVapid();
    const { t, workspaceId } = harnessState;
    const internal = 'https://10.0.0.5:8443/hook';
    await subscribe(t, internal);
    const rows = await attempts(t, workspaceId, ['push']);

    expect(await deliverNotifications(rows)).toEqual({ delivered: 1, undelivered: 0 });
    // web-push speaks plain Node HTTPS, so a literal address never reaches DNS and is refused here.
    expect(sent.map((row) => row.endpoint)).not.toContain(internal);
    // A hostname is resolved through the rule that refuses every non-public address.
    const lookup = sent[0].agent?.options.lookup;
    expect(lookup).toBeTypeOf('function');
    const refused = await new Promise<Error | null>((resolve) =>
      lookup?.('localhost', { all: true }, (error) => resolve(error)),
    );
    expect(refused?.message).toMatch(/Private and reserved/);
  });

  it('caps the browsers one person can register', async () => {
    const { t } = harnessState;
    for (let index = 0; index < 8; index++) await subscribe(t, `https://push.example/browser-${index}`);

    await expect(subscribe(t, 'https://push.example/eleventh')).rejects.toThrow(
      'Too many push subscriptions',
    );
    // Re-registering a browser already on the list still refreshes its keys.
    await subscribe(t, 'https://push.example/live');
    expect(await t.run(async (ctx) => ctx.db.query('pushSubscriptions').collect())).toHaveLength(10);
  });

  it('falls back to the in-app row when no VAPID key pair is configured', async () => {
    const { t, workspaceId } = harnessState;
    const rows = await attempts(t, workspaceId, ['push', 'in_app']);

    expect(await deliverNotifications(rows)).toEqual({ delivered: 1, undelivered: 0 });
    expect(sent).toEqual([]);
    const [stored] = await t.run(async (ctx) => ctx.db.query('notifications').collect());
    expect(stored.deliveredChannel).toBe('in_app');
  });
});
