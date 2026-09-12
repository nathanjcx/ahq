import { createHash, createHmac } from 'node:crypto';
import { providerRuntimeConfig } from './config';
import { equalSecret, unseal } from './secrets';

export type NativeProvider = 'github' | 'linear' | 'slack';

export function isNativeProvider(value: string): value is NativeProvider {
  return value === 'github' || value === 'linear' || value === 'slack';
}

/** The administrator's app-level webhook secret for one provider, shared by every connection. */
export async function nativeSecret(provider: NativeProvider): Promise<string | undefined> {
  const ciphertext = (await providerRuntimeConfig(provider))?.inboxSecretCiphertext;
  return ciphertext ? unseal<string>(ciphertext) : undefined;
}

export interface NativeInboxItem {
  externalId: string;
  title: string;
  preview: string;
  sourceUrl?: string;
  createdAt: number;
}

export type NativeDelivery =
  | { kind: 'items'; resourceIds: string[]; items: NativeInboxItem[] }
  | { kind: 'challenge'; challenge: string }
  | { kind: 'ignored' };

function header(headers: Headers, name: string) {
  return headers.get(name);
}

function verifyHmac(body: string, secret: string, signature: string | null, prefix = '') {
  if (!signature || !signature.startsWith(prefix)) throw new Error('Invalid webhook signature');
  const supplied = signature.slice(prefix.length);
  if (!/^[0-9a-f]{64}$/i.test(supplied)) throw new Error('Invalid webhook signature');
  const expected = createHmac('sha256', secret).update(body).digest('hex');
  if (!equalSecret(supplied.toLowerCase(), expected)) throw new Error('Invalid webhook signature');
}

function verifyFreshness(timestamp: number, now: number, maxAgeMs: number) {
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > maxAgeMs)
    throw new Error('Webhook timestamp is stale');
}

function parseJson(body: string): Record<string, any> {
  const value: unknown = JSON.parse(body);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Webhook payload must be an object');
  return value as Record<string, any>;
}

function clip(value: unknown, max: number) {
  return String(value ?? '')
    .trim()
    .slice(0, max);
}

function httpsUrl(value: unknown) {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function signedBodyId(provider: NativeProvider, body: string) {
  return `${provider}:${createHash('sha256').update(body).digest('hex')}`;
}

function github(body: string, headers: Headers, secret: string): NativeDelivery {
  verifyHmac(body, secret, header(headers, 'x-hub-signature-256'), 'sha256=');
  const delivery = header(headers, 'x-github-delivery');
  const event = header(headers, 'x-github-event');
  if (!delivery || !event) throw new Error('GitHub delivery headers are required');
  const payload = parseJson(body);
  if (!['issues', 'pull_request', 'issue_comment'].includes(event)) return { kind: 'ignored' };
  const repository = payload.repository;
  const repositoryId = repository && repository.id !== undefined ? String(repository.id) : '';
  const repositoryName = typeof repository?.full_name === 'string' ? repository.full_name : '';
  if (!repositoryId || !repositoryName) return { kind: 'ignored' };
  const subject = event === 'pull_request' ? payload.pull_request : payload.issue;
  if (!subject || typeof subject !== 'object') return { kind: 'ignored' };
  const subjectTitle = clip(subject.title, 500) || `${event} in ${repositoryName}`;
  const action = clip(payload.action, 80) || 'updated';
  const author = clip(payload.sender?.login, 120);
  const bodyText = clip(event === 'issue_comment' ? payload.comment?.body : subject.body, 5_000);
  const preview = clip([action, author && `by ${author}`, bodyText].filter(Boolean).join(' '), 5_000);
  const createdAt = Date.parse(subject.updated_at || payload.comment?.updated_at || '') || Date.now();
  const sourceUrl = httpsUrl(
    event === 'issue_comment' ? payload.comment?.html_url || subject.html_url : subject.html_url,
  );
  return {
    kind: 'items',
    resourceIds: [repositoryId, repositoryName],
    items: [
      {
        externalId: signedBodyId('github', body),
        title: `GitHub ${event === 'pull_request' ? 'pull request' : event === 'issue_comment' ? 'issue comment' : 'issue'}: ${subjectTitle}`,
        preview,
        ...(sourceUrl ? { sourceUrl } : {}),
        createdAt,
      },
    ],
  };
}

function linear(body: string, headers: Headers, secret: string, now: number): NativeDelivery {
  verifyHmac(body, secret, header(headers, 'linear-signature'));
  const payload = parseJson(body);
  const timestamp = Number(payload.webhookTimestamp);
  verifyFreshness(timestamp, now, 60_000);
  const headerTimestamp = header(headers, 'linear-timestamp');
  if (headerTimestamp && Number(headerTimestamp) !== timestamp)
    throw new Error('Webhook timestamp is invalid');
  const delivery = header(headers, 'linear-delivery') || clip(payload.webhookId, 300);
  const type = clip(payload.type || header(headers, 'linear-event'), 80);
  if (!delivery || !['Issue', 'Comment'].includes(type)) return { kind: 'ignored' };
  const data = payload.data && typeof payload.data === 'object' ? payload.data : undefined;
  if (!data) return { kind: 'ignored' };
  const teamId = clip(data.team?.id || data.teamId || data.issue?.team?.id, 300);
  if (!teamId) return { kind: 'ignored' };
  const title = clip(data.title || data.identifier || data.body, 500) || `${type} in team ${teamId}`;
  const preview = clip(
    [clip(payload.action, 80), clip(data.body || data.description, 5_000)].filter(Boolean).join(' '),
    5_000,
  );
  const createdAt = Date.parse(data.updatedAt || data.createdAt || payload.createdAt || '') || timestamp;
  const sourceUrl = httpsUrl(payload.url || data.url);
  return {
    kind: 'items',
    resourceIds: [teamId],
    items: [
      {
        externalId: signedBodyId('linear', body),
        title: `Linear ${type.toLowerCase()}: ${title}`,
        preview,
        ...(sourceUrl ? { sourceUrl } : {}),
        createdAt,
      },
    ],
  };
}

function slack(body: string, headers: Headers, secret: string, now: number): NativeDelivery {
  const timestampHeader = header(headers, 'x-slack-request-timestamp');
  if (!timestampHeader || !/^\d+$/.test(timestampHeader)) throw new Error('Invalid webhook timestamp');
  const timestampSeconds = Number(timestampHeader);
  const timestamp = timestampSeconds * 1_000;
  verifyFreshness(timestamp, now, 300_000);
  const signature = header(headers, 'x-slack-signature');
  if (!signature || !/^v0=[0-9a-f]{64}$/i.test(signature)) throw new Error('Invalid webhook signature');
  const expected = `v0=${createHmac('sha256', secret)
    .update(`v0:${Math.floor(timestampSeconds)}:${body}`)
    .digest('hex')}`;
  if (!equalSecret(signature.toLowerCase(), expected)) throw new Error('Invalid webhook signature');
  const payload = parseJson(body);
  if (payload.type === 'url_verification') {
    if (typeof payload.challenge !== 'string') return { kind: 'ignored' };
    return { kind: 'challenge', challenge: payload.challenge };
  }
  if (payload.type !== 'event_callback') return { kind: 'ignored' };
  const event = payload.event;
  if (!event || event.type !== 'message' || (event.subtype && event.subtype !== 'message_changed'))
    return { kind: 'ignored' };
  const message = event.subtype === 'message_changed' ? event.message : event;
  if (!message || typeof message !== 'object') return { kind: 'ignored' };
  const channelId = clip(message.channel || event.channel, 300);
  if (!channelId) return { kind: 'ignored' };
  const eventId = clip(payload.event_id, 300);
  if (!eventId) return { kind: 'ignored' };
  const text = clip(message.text, 5_000);
  if (!text) return { kind: 'ignored' };
  const eventTs = Number(message.ts) * 1_000;
  const createdAt =
    Number.isFinite(eventTs) && eventTs > 0 ? eventTs : Number(payload.event_time) * 1_000 || now;
  return {
    kind: 'items',
    resourceIds: [channelId],
    items: [
      {
        externalId: signedBodyId('slack', body),
        title: `Slack message in ${channelId}`,
        preview: text,
        createdAt,
      },
    ],
  };
}

/** Verify one provider delivery and normalize it, with the resource keys a connection can follow. */
export function parseNativeDelivery(
  provider: NativeProvider,
  secret: string,
  body: string,
  headers: Headers,
  now = Date.now(),
): NativeDelivery {
  if (Buffer.byteLength(body, 'utf8') > 1_000_000) throw new Error('Request is too large');
  if (provider === 'github') return github(body, headers, secret);
  if (provider === 'linear') return linear(body, headers, secret, now);
  return slack(body, headers, secret, now);
}
