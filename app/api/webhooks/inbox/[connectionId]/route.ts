import { NextResponse } from 'next/server';
import { rawBody, HttpError, failure } from '@/lib/server/http';
import { mutate, query } from '@/lib/server/backend';
import { inboxPayload, verifyInboxSignature } from '@/lib/server/inbox-events';
import { unseal } from '@/lib/server/secrets';
import { withinRateLimit } from '@/lib/server/rate-limit';
export const runtime = 'nodejs';

/** Normalized relay deliveries are signed with the connection's own sealed relay secret. */
export async function POST(request: Request, { params }: { params: Promise<{ connectionId: string }> }) {
  try {
    const { connectionId } = await params;
    if (!withinRateLimit(`relay-inbox:${connectionId}`, 600))
      throw new HttpError(429, 'Too many deliveries for this connection.', 'rate_limited');
    const context = await query<{ inboxRelaySecretCiphertext?: string }>(
      'services/integrations:connectionContext',
      { connectionId },
    ).catch(() => null);
    if (!context?.inboxRelaySecretCiphertext)
      throw new HttpError(404, 'Inbox delivery is not configured for this connection.');
    const body = await rawBody(request);
    try {
      verifyInboxSignature(
        body,
        request.headers.get('x-ahq-timestamp'),
        request.headers.get('x-ahq-signature'),
        unseal<string>(context.inboxRelaySecretCiphertext),
      );
    } catch {
      throw new HttpError(401, 'Invalid inbox delivery signature.');
    }
    const payload = inboxPayload.parse(JSON.parse(body));
    await mutate('services/inbox:ingestInbox', { connectionId, ...payload });
    return NextResponse.json({ accepted: true });
  } catch (error) {
    return failure(error);
  }
}
