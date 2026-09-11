import { NextResponse } from 'next/server';
import { rawBody, HttpError, failure } from '../../../../../lib/server/http';
import { mutate } from '../../../../../lib/server/backend';
import { inboxPayload, verifyInboxSignature } from '../../../../../lib/server/inbox-events';
export const runtime = 'nodejs';
export async function POST(request: Request, { params }: { params: Promise<{ connectionId: string }> }) {
  try {
    const { connectionId } = await params;
    const secrets = JSON.parse(process.env.INBOX_WEBHOOK_SECRETS_JSON || '{}') as Record<string, string>;
    const secret = secrets[connectionId];
    if (!secret) throw new HttpError(404, 'Inbox delivery is not configured for this connection.');
    const body = await rawBody(request);
    try {
      verifyInboxSignature(
        body,
        request.headers.get('x-ahq-timestamp'),
        request.headers.get('x-ahq-signature'),
        secret,
      );
    } catch {
      throw new HttpError(401, 'Invalid inbox delivery signature.');
    }
    const payload = inboxPayload.parse(JSON.parse(body));
    await mutate('services:ingestInbox', { connectionId, ...payload });
    return NextResponse.json({ accepted: true });
  } catch (error) {
    return failure(error);
  }
}
