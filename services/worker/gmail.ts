import { query } from '../../lib/server/backend';
import { startGmailWatch, syncGmail, type GmailWatch } from '../../lib/server/gmail';
import { safeError } from '../../lib/server/secrets';
import type { PrivateConnection } from '../types';

/** Gmail keeps a watch for seven days; renew anything inside the last day of that. */
const RENEW_WITHIN_MS = 24 * 60 * 60 * 1000;
export const gmailPassMs = 60 * 60 * 1000;

/**
 * Once an hour: renew every Gmail watch about to lapse, and sync every mailbox from its cursor so a
 * missed push never loses mail. Runs only where the topic is configured.
 */
export async function gmailPass() {
  if (!process.env.GMAIL_PUBSUB_TOPIC) return;
  const watches = await query<Array<{ connection: PrivateConnection; watch: GmailWatch }>>(
    'services/integrations:gmailWatches',
    {},
  );
  for (const { connection, watch } of watches) {
    try {
      const current =
        watch.expiresAt - Date.now() < RENEW_WITHIN_MS
          ? await startGmailWatch(connection, watch.historyId)
          : watch;
      await syncGmail(connection, current);
    } catch (error) {
      console.error(`gmail pass failed connection=${connection.id} reason=${safeError(error)}`);
    }
  }
}
