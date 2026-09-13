import { Agent } from 'node:https';
import { isIP } from 'node:net';
import webpush, { WebPushError } from 'web-push';
import { mutate, query } from './backend';
import { publicOnlyLookup } from './network';
import { safeError, unseal } from './secrets';

/** One recorded attempt to reach one person, exactly as `services/notifications:attempt` returns it. */
export interface NotificationAttempt {
  id: string;
  subject: string;
  kind: 'triage' | 'meeting' | 'finding' | 'general' | 'task';
  title: string;
  text: string;
  alertId?: string;
  channels: string[];
  attempt: number;
}

/** A stored browser endpoint, with its keys still sealed. */
interface PushTarget {
  endpoint: string;
  keysCiphertext: string;
}

/**
 * The VAPID identity this deployment pushes under.
 *
 * Push is optional: a deployment without the key pair simply has no push channel, and says so rather
 * than reporting a delivery it never made. `VAPID_SUBJECT` is the `mailto:` address or origin a push
 * service contacts when something is wrong with this application's notifications.
 */
function pushConfigured() {
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: subject } = process.env;
  if (!publicKey || !privateKey || !subject) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return true;
}

/**
 * Push is the one outbound path that does not go through `safeFetch`: `web-push` signs and sends over
 * plain Node HTTPS. The endpoint is a URL a member registered, so it gets the same treatment a
 * provider URL gets — the same resolver refuses any non-public address, and a literal IP, which never
 * reaches DNS at all, is refused before the request is made.
 */
const pushAgent = new Agent({ lookup: publicOnlyLookup });

export function requireSafeEndpoint(endpoint: string) {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || isIP(url.hostname.replace(/^\[|\]$/g, '')))
    throw new Error('A push endpoint must be an HTTPS hostname, not an address.');
}

/** A push service saying the endpoint is gone. The subscription is dead and is pruned, not retried. */
function subscriptionGone(error: unknown) {
  return error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410);
}

/**
 * Web Push to every endpoint this person has registered.
 *
 * The keys are unsealed here, as with every other credential: Convex holds ciphertext and never the
 * key. An attempt counts as delivered when at least one endpoint accepted it, so a person with a
 * stale subscription beside a live one is still reached, and the stale one is removed on the way.
 */
async function sendPush(attempt: NotificationAttempt) {
  if (!pushConfigured()) return false;
  const targets = await query<PushTarget[]>('services/notifications:pushTargets', {
    subject: attempt.subject,
  });
  let delivered = false;
  for (const target of targets) {
    try {
      requireSafeEndpoint(target.endpoint);
      const keys = unseal<{ p256dh: string; auth: string }>(target.keysCiphertext);
      await webpush.sendNotification(
        { endpoint: target.endpoint, keys },
        JSON.stringify({
          id: attempt.id,
          kind: attempt.kind,
          title: attempt.title,
          body: attempt.text,
          ...(attempt.alertId ? { alertId: attempt.alertId } : {}),
        }),
        { TTL: 600, agent: pushAgent },
      );
      delivered = true;
    } catch (error) {
      if (subscriptionGone(error)) {
        await mutate('services/notifications:unsubscribePush', {
          authSubject: attempt.subject,
          endpoint: target.endpoint,
        }).catch((failure: unknown) => console.error(`push prune failed reason=${safeError(failure)}`));
        continue;
      }
      console.error(`push delivery failed reason=${safeError(error)}`);
    }
  }
  return delivered;
}

/**
 * Delivery per channel. `in_app` is the row itself, so it always lands. `push` is Web Push when the
 * deployment carries a VAPID key pair. `slack` and `email` are connector stubs: no transport is
 * wired, and no message is invented, so they report no delivery and say why.
 */
async function send(channel: string, attempt: NotificationAttempt) {
  if (channel === 'in_app') return true;
  if (channel === 'push') {
    if (await sendPush(attempt)) return true;
    console.warn(
      `push delivered nothing configured=${pushConfigured()} kind=${attempt.kind} attempt=${attempt.attempt}`,
    );
    return false;
  }
  console.warn(
    `notification channel not configured channel=${channel} kind=${attempt.kind} attempt=${attempt.attempt}`,
  );
  return false;
}

/**
 * The order channels are tried in, whatever order the workspace listed them.
 *
 * `in_app` is last on purpose: it is a row in a database nobody has necessarily looked at, and an
 * attempt that settles for it would never have reached a person's phone. A real transport is tried
 * first, and the in-app row remains the fallback that always lands.
 */
const CHANNEL_ORDER = ['push', 'slack', 'email', 'in_app'];

function rank(channel: string) {
  const index = CHANNEL_ORDER.indexOf(channel);
  return index === -1 ? CHANNEL_ORDER.length : index;
}

function inOrder(channels: string[]) {
  return [...channels].sort((a, b) => rank(a) - rank(b));
}

/**
 * Delivers recorded attempts. An attempt counts only once a channel reports delivery, so the first
 * channel that lands marks the row and the rest are skipped.
 */
export async function deliverNotifications(attempts: NotificationAttempt[]) {
  let delivered = 0;
  for (const attempt of attempts) {
    for (const channel of inOrder(attempt.channels)) {
      if (!(await send(channel, attempt))) continue;
      await mutate('services/notifications:markDelivered', { id: attempt.id, channel });
      delivered += 1;
      break;
    }
  }
  return { delivered, undelivered: attempts.length - delivered };
}
