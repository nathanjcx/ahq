import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseNativeDelivery, type NativeConfig } from '../lib/server/native-inbox';

const now = 1_800_000_000_000;
const config = (provider: NativeConfig['provider'], resourceIds: string[]): NativeConfig => ({
  provider,
  resourceIds,
  secret: 'a'.repeat(32),
});
const signed = (body: string, secret: string, prefix = '') =>
  `${prefix}${createHmac('sha256', secret).update(body).digest('hex')}`;

describe('native inbox deliveries', () => {
  it('rejects a GitHub signature and filters an unregistered repository', () => {
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
    expect(() => parseNativeDelivery(config('github', ['acme/repo']), body, headers, now)).toThrow();
    headers.set('x-hub-signature-256', `sha256=${signed(body, config('github', []).secret)}`);
    expect(parseNativeDelivery(config('github', ['acme/repo']), body, headers, now)).toEqual({
      kind: 'ignored',
    });
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
      'x-hub-signature-256': `sha256=${signed(body, config('github', []).secret)}`,
    });
    const first = parseNativeDelivery(config('github', ['acme/repo']), body, headers, now);
    const second = parseNativeDelivery(config('github', ['acme/repo']), body, headers, now);
    expect(first).toEqual(second);
    expect(first.kind === 'items' && first.items[0].externalId).toMatch(/^github:[0-9a-f]{64}$/);
    headers.set('x-github-delivery', 'delivery-2');
    expect(parseNativeDelivery(config('github', ['acme/repo']), body, headers, now)).toEqual(first);
  });

  it('rejects stale Linear deliveries and enforces exact team scope', () => {
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
      'linear-signature': signed(body, config('linear', []).secret),
      'linear-delivery': 'linear-1',
    });
    expect(() => parseNativeDelivery(config('linear', ['team-a']), body, headers, now)).toThrow('stale');
    payload.webhookTimestamp = now;
    const fresh = JSON.stringify(payload);
    headers.set('linear-signature', signed(fresh, config('linear', []).secret));
    expect(parseNativeDelivery(config('linear', ['team-b']), fresh, headers, now)).toEqual({
      kind: 'ignored',
    });
    const allowed = parseNativeDelivery(config('linear', ['team-a']), fresh, headers, now);
    headers.set('linear-delivery', 'different-unsigned-header');
    expect(parseNativeDelivery(config('linear', ['team-a']), fresh, headers, now)).toEqual(allowed);
  });

  it('verifies Slack signatures, handles URL verification, and filters channels', () => {
    const body = JSON.stringify({
      token: 'legacy-token',
      type: 'url_verification',
      challenge: 'challenge-1',
    });
    const timestamp = Math.floor(now / 1_000).toString();
    const signature = `v0=${createHmac('sha256', config('slack', []).secret).update(`v0:${timestamp}:${body}`).digest('hex')}`;
    const headers = new Headers({ 'x-slack-request-timestamp': timestamp, 'x-slack-signature': signature });
    expect(parseNativeDelivery(config('slack', ['C1']), body, headers, now)).toEqual({
      kind: 'challenge',
      challenge: 'challenge-1',
    });
    headers.set('x-slack-signature', 'v0=' + '0'.repeat(64));
    expect(() => parseNativeDelivery(config('slack', ['C1']), body, headers, now)).toThrow();
    const staleTimestamp = String(Number(timestamp) - 301);
    headers.set('x-slack-request-timestamp', staleTimestamp);
    headers.set(
      'x-slack-signature',
      `v0=${createHmac('sha256', config('slack', []).secret).update(`v0:${staleTimestamp}:${body}`).digest('hex')}`,
    );
    expect(() => parseNativeDelivery(config('slack', ['T1']), body, headers, now)).toThrow('stale');
    expect(
      parseNativeDelivery(
        config('slack', ['C2']),
        body,
        new Headers({ 'x-slack-request-timestamp': timestamp, 'x-slack-signature': signature }),
        now,
      ),
    ).toEqual({ kind: 'challenge', challenge: 'challenge-1' });

    const eventBody = JSON.stringify({
      type: 'event_callback',
      team_id: 'T1',
      event_id: 'event-1',
      event: { type: 'message', channel: 'C2', user: 'U1', text: 'hello', ts: '1800000000.000001' },
    });
    const eventHeaders = new Headers({
      'x-slack-request-timestamp': timestamp,
      'x-slack-signature': `v0=${createHmac('sha256', config('slack', []).secret).update(`v0:${timestamp}:${eventBody}`).digest('hex')}`,
    });
    expect(parseNativeDelivery(config('slack', ['C1']), eventBody, eventHeaders, now)).toEqual({
      kind: 'ignored',
    });
  });
});
