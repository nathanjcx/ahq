import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseNativeDelivery } from '../lib/server/native-inbox';

const now = 1_800_000_000_000;
const secret = 'a'.repeat(32);
const signed = (body: string, prefix = '') =>
  `${prefix}${createHmac('sha256', secret).update(body).digest('hex')}`;
const slackSignature = (timestamp: string, body: string) =>
  `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex')}`;

describe('native inbox deliveries', () => {
  it('rejects a bad GitHub signature and reports the repository resource keys', () => {
    const body = JSON.stringify({
      action: 'opened',
      issue: { title: 'A', body: 'B', html_url: 'https://github.com/acme/other/issues/1' },
      repository: { id: 2, full_name: 'acme/other' },
    });
    const headers = new Headers({
      'x-github-delivery': 'delivery-1',
      'x-github-event': 'issues',
      'x-hub-signature-256': 'sha256=' + '0'.repeat(64),
    });
    expect(() => parseNativeDelivery('github', secret, body, headers, now)).toThrow();
    headers.set('x-hub-signature-256', signed(body, 'sha256='));
    const delivery = parseNativeDelivery('github', secret, body, headers, now);
    expect(delivery.kind === 'items' && delivery.resourceIds).toEqual(['2', 'acme/other']);
  });

  it('deduplicates by hashing the signed GitHub body', () => {
    const body = JSON.stringify({
      action: 'opened',
      issue: {
        title: 'A',
        body: 'B',
        html_url: 'https://github.com/acme/repo/issues/1',
        updated_at: '2026-01-01T00:00:00Z',
      },
      repository: { id: 2, full_name: 'acme/repo' },
    });
    const headers = new Headers({
      'x-github-delivery': 'delivery-1',
      'x-github-event': 'issues',
      'x-hub-signature-256': signed(body, 'sha256='),
    });
    const first = parseNativeDelivery('github', secret, body, headers, now);
    const second = parseNativeDelivery('github', secret, body, headers, now);
    expect(first).toEqual(second);
    expect(first.kind === 'items' && first.items[0].externalId).toMatch(/^github:[0-9a-f]{64}$/);
    headers.set('x-github-delivery', 'delivery-2');
    expect(parseNativeDelivery('github', secret, body, headers, now)).toEqual(first);
  });

  it('rejects stale Linear deliveries and reports the team resource key', () => {
    const payload = {
      action: 'update',
      type: 'Issue',
      data: {
        id: 'issue-1',
        team: { id: 'team-a' },
        title: 'Roadmap',
        url: 'https://linear.app/acme/issue/1',
      },
      webhookTimestamp: now - 61_000,
      webhookId: 'linear-1',
    };
    const body = JSON.stringify(payload);
    const headers = new Headers({
      'linear-signature': signed(body),
      'linear-delivery': 'linear-1',
    });
    expect(() => parseNativeDelivery('linear', secret, body, headers, now)).toThrow('stale');
    payload.webhookTimestamp = now;
    const fresh = JSON.stringify(payload);
    headers.set('linear-signature', signed(fresh));
    const allowed = parseNativeDelivery('linear', secret, fresh, headers, now);
    expect(allowed.kind === 'items' && allowed.resourceIds).toEqual(['team-a']);
    headers.set('linear-delivery', 'different-unsigned-header');
    expect(parseNativeDelivery('linear', secret, fresh, headers, now)).toEqual(allowed);
  });

  it('verifies Slack signatures, handles URL verification, and reports the channel', () => {
    const body = JSON.stringify({
      token: 'legacy-token',
      type: 'url_verification',
      challenge: 'challenge-1',
    });
    const timestamp = Math.floor(now / 1_000).toString();
    const headers = new Headers({
      'x-slack-request-timestamp': timestamp,
      'x-slack-signature': slackSignature(timestamp, body),
    });
    expect(parseNativeDelivery('slack', secret, body, headers, now)).toEqual({
      kind: 'challenge',
      challenge: 'challenge-1',
    });
    headers.set('x-slack-signature', 'v0=' + '0'.repeat(64));
    expect(() => parseNativeDelivery('slack', secret, body, headers, now)).toThrow();
    const staleTimestamp = String(Number(timestamp) - 301);
    headers.set('x-slack-request-timestamp', staleTimestamp);
    headers.set('x-slack-signature', slackSignature(staleTimestamp, body));
    expect(() => parseNativeDelivery('slack', secret, body, headers, now)).toThrow('stale');

    const eventBody = JSON.stringify({
      type: 'event_callback',
      team_id: 'T1',
      event_id: 'event-1',
      event: { type: 'message', channel: 'C2', user: 'U1', text: 'hello', ts: '1800000000.000001' },
    });
    const eventHeaders = new Headers({
      'x-slack-request-timestamp': timestamp,
      'x-slack-signature': slackSignature(timestamp, eventBody),
    });
    const delivery = parseNativeDelivery('slack', secret, eventBody, eventHeaders, now);
    expect(delivery.kind === 'items' && delivery.resourceIds).toEqual(['C2']);
    expect(delivery.kind === 'items' && delivery.items[0].preview).toBe('hello');
  });
});
