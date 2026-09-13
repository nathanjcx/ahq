import { createRemoteJWKSet, jwtVerify } from 'jose';
import { NextResponse } from 'next/server';
import { query } from '@/lib/server/backend';
import { syncGmail, type GmailWatch } from '@/lib/server/gmail';
import { failure, HttpError, rawBody } from '@/lib/server/http';
import { withinRateLimit } from '@/lib/server/rate-limit';
import { requiredEnv, safeError } from '@/lib/server/secrets';
import type { PrivateConnection } from '@/services/types';
export const runtime = 'nodejs';

const GOOGLE_KEYS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

/**
 * Pub/Sub's push of a Gmail change. The subscription signs each delivery with an OIDC token for our
 * service account; nothing in the body is trusted before that token verifies. The message names the
 * mailbox; the sync fetches what changed from the connection's own cursor.
 */
export async function POST(request: Request) {
  try {
    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) throw new HttpError(401, 'Missing push token.');
    const audience = new URL('/api/webhooks/gmail', requiredEnv('APP_URL')).href;
    const verified = await jwtVerify(token, GOOGLE_KEYS, {
      issuer: 'https://accounts.google.com',
      audience,
    }).catch(() => null);
    if (!verified) throw new HttpError(401, 'Invalid push token.');
    const { payload } = verified;
    if (payload.email !== requiredEnv('GMAIL_PUSH_SERVICE_ACCOUNT') || payload.email_verified !== true)
      throw new HttpError(401, 'Push token is not ours.');
    const body = JSON.parse(await rawBody(request)) as { message?: { data?: string } };
    const data = body.message?.data
      ? (JSON.parse(Buffer.from(body.message.data, 'base64').toString('utf8')) as { emailAddress?: unknown })
      : null;
    const mailbox = typeof data?.emailAddress === 'string' ? data.emailAddress.toLowerCase() : '';
    if (!mailbox) return NextResponse.json({ accepted: true, ignored: 'no mailbox' });
    if (!withinRateLimit(`gmail-push:${mailbox}`, 300))
      throw new HttpError(429, 'Too many pushes.', 'rate_limited');
    const watches = await query<Array<{ connection: PrivateConnection; watch: GmailWatch }>>(
      'services/integrations:gmailWatches',
      { mailbox },
    );
    let inserted = 0;
    for (const { connection, watch } of watches) {
      try {
        inserted += (await syncGmail(connection, watch)).inserted;
      } catch (error) {
        // Reported, never retried by Pub/Sub: the next push or the hourly pass syncs from the cursor.
        console.error(`gmail sync failed connection=${connection.id} reason=${safeError(error)}`);
      }
    }
    return NextResponse.json({ accepted: true, connections: watches.length, inserted });
  } catch (error) {
    return failure(error);
  }
}
