import type { PrivateConnection } from '../../services/types';
import { mutate } from './backend';
import { googleAccessToken } from './google-token';

export const GMAIL_SERVER_URL = 'https://gmailmcp.googleapis.com/mcp/v1';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
/** How many new messages one sync will ingest; Gmail lists them newest-last across pages. */
const SYNC_LIMIT = 100;

export interface GmailWatch {
  mailbox: string;
  historyId: string;
  expiresAt: number;
}

type GmailConnection = Pick<PrivateConnection, 'id' | 'provider' | 'serverUrl' | 'credentialCiphertext'>;

async function gmail<T>(connection: GmailConnection, path: string, init: RequestInit = {}): Promise<T> {
  const token = await googleAccessToken(connection);
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
  });
  if (!response.ok) {
    const text = (await response.text()).slice(0, 300);
    throw new GmailError(response.status, `Gmail ${path.split('?')[0]} answered ${response.status}: ${text}`);
  }
  return (await response.json()) as T;
}

export class GmailError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Where Gmail publishes this deployment's mailbox changes. */
export function pubsubTopic() {
  const topic = process.env.GMAIL_PUBSUB_TOPIC;
  if (!topic) throw new Error('GMAIL_PUBSUB_TOPIC is not configured');
  return topic;
}

/**
 * Asks Gmail to publish this mailbox's INBOX changes to our topic. Gmail keeps a watch for seven days,
 * so the worker's pass calls this again before then, keeping the cursor it already has; a first watch
 * starts its cursor at the mailbox's current history id.
 */
export async function startGmailWatch(connection: GmailConnection, cursor?: string): Promise<GmailWatch> {
  const profile = await gmail<{ emailAddress: string; historyId: string }>(connection, '/profile');
  const watch = await gmail<{ historyId: string; expiration: string }>(connection, '/watch', {
    method: 'POST',
    body: JSON.stringify({ topicName: pubsubTopic(), labelIds: ['INBOX'], labelFilterBehavior: 'INCLUDE' }),
  });
  const record = {
    mailbox: profile.emailAddress.toLowerCase(),
    historyId: cursor ?? watch.historyId,
    expiresAt: Number(watch.expiration),
  };
  await mutate('services/integrations:setGmailWatch', { connectionId: connection.id, watch: record });
  return record;
}

interface HistoryPage {
  history?: Array<{ messagesAdded?: Array<{ message: { id: string; labelIds?: string[] } }> }>;
  historyId: string;
  nextPageToken?: string;
}

interface MessageMeta {
  id: string;
  threadId: string;
  snippet?: string;
  internalDate: string;
  payload?: { headers?: Array<{ name: string; value: string }> };
}

/**
 * Brings a mailbox up to date from its stored history id: every message added to INBOX since then
 * becomes one inbox item, delivered through the same path the relay uses, so routing and
 * deduplication apply. A history id Gmail no longer holds (it keeps about a week) restarts the cursor
 * at the mailbox's current id; the mail in between is not recoverable through history and is not
 * invented.
 */
export async function syncGmail(
  connection: GmailConnection,
  watch: GmailWatch,
): Promise<{ inserted: number; historyId: string }> {
  const ids = new Set<string>();
  let historyId: string;
  let pageToken: string | undefined;
  try {
    do {
      const query = new URLSearchParams({
        startHistoryId: watch.historyId,
        historyTypes: 'messageAdded',
        labelId: 'INBOX',
        ...(pageToken ? { pageToken } : {}),
      });
      const page = await gmail<HistoryPage>(connection, `/history?${query}`);
      for (const entry of page.history ?? [])
        for (const added of entry.messagesAdded ?? [])
          if (added.message.labelIds?.includes('INBOX') && ids.size < SYNC_LIMIT) ids.add(added.message.id);
      historyId = page.historyId;
      pageToken = page.nextPageToken;
    } while (pageToken && ids.size < SYNC_LIMIT);
  } catch (error) {
    if (!(error instanceof GmailError) || error.status !== 404) throw error;
    const profile = await gmail<{ historyId: string }>(connection, '/profile');
    await mutate('services/integrations:setGmailWatch', {
      connectionId: connection.id,
      watch: { ...watch, historyId: profile.historyId },
    });
    return { inserted: 0, historyId: profile.historyId };
  }
  const items = [];
  for (const id of ids) {
    const message = await gmail<MessageMeta>(
      connection,
      `/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`,
    );
    const header = (name: string) =>
      message.payload?.headers?.find((entry) => entry.name.toLowerCase() === name)?.value ?? '';
    items.push({
      externalId: `gmail:${message.id}`,
      title: (header('subject') || '(no subject)').slice(0, 200),
      preview: `From ${header('from')}\n\n${message.snippet ?? ''}`.slice(0, 4000),
      sourceUrl: `https://mail.google.com/mail/u/0/#inbox/${message.id}`,
      createdAt: Number(message.internalDate) || Date.now(),
    });
  }
  let inserted = 0;
  if (items.length) {
    const result = await mutate<{ inserted: number }>('services/inbox:ingestInbox', {
      connectionId: connection.id,
      items,
    });
    inserted = result.inserted;
  }
  if (historyId !== watch.historyId)
    await mutate('services/integrations:setGmailWatch', {
      connectionId: connection.id,
      watch: { ...watch, historyId },
    });
  return { inserted, historyId };
}
