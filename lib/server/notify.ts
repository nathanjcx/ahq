import { mutate } from './backend';

/** One recorded attempt to reach one person, exactly as `services/notifications:attempt` returns it. */
export interface NotificationAttempt {
  id: string;
  subject: string;
  kind: 'triage' | 'meeting' | 'finding' | 'general';
  title: string;
  text: string;
  alertId?: string;
  channels: string[];
  attempt: number;
}

/**
 * Delivery per channel. `in_app` is the row itself, so it always lands. The other three are not
 * configured in this deployment and say so rather than pretending:
 *
 * - `push`: Web Push needs the `web-push` package and a VAPID key pair, and this repository has
 *   neither. Subscriptions are still stored, so turning it on is a dependency and a key, not a
 *   migration. Until then a push channel delivers nothing.
 * - `slack` and `email`: connector stubs. No transport is wired, and no message is invented.
 */
async function send(channel: string, attempt: NotificationAttempt) {
  if (channel === 'in_app') return true;
  console.warn(
    `notification channel not configured channel=${channel} kind=${attempt.kind} attempt=${attempt.attempt}`,
  );
  return false;
}

/**
 * Delivers recorded attempts. An attempt counts only once a channel reports delivery, so the first
 * channel that lands marks the row and the rest are skipped.
 */
export async function deliverNotifications(attempts: NotificationAttempt[]) {
  let delivered = 0;
  for (const attempt of attempts) {
    for (const channel of attempt.channels) {
      if (!(await send(channel, attempt))) continue;
      await mutate('services/notifications:markDelivered', { id: attempt.id, channel });
      delivered += 1;
      break;
    }
  }
  return { delivered, undelivered: attempts.length - delivered };
}
