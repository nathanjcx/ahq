import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { actor, failure, HttpError } from '@/lib/server/http';
import { mutate, query } from '@/lib/server/backend';
import { requiredEnv, seal, unseal } from '@/lib/server/secrets';
export const runtime = 'nodejs';

interface ConnectionContext {
  inboxRelaySecretCiphertext?: string;
  authorization: { ownerSubject: string };
}

function relayUrl(connectionId: string) {
  return new URL(`/api/webhooks/inbox/${encodeURIComponent(connectionId)}`, requiredEnv('APP_URL')).href;
}

async function ownedConnection(connectionId: string, subject: string) {
  const context = await query<ConnectionContext>('services/integrations:connectionContext', {
    connectionId,
  }).catch(() => null);
  if (!context || context.authorization.ownerSubject !== subject)
    throw new HttpError(404, 'Connection not found.');
  return context;
}

/** Reveals the relay secret to its owner. The browser never receives another member's secret. */
export async function GET(_request: Request, { params }: { params: Promise<{ connectionId: string }> }) {
  try {
    const identity = await actor();
    const { connectionId } = await params;
    const context = await ownedConnection(connectionId, identity.authSubject);
    if (!context.inboxRelaySecretCiphertext)
      throw new HttpError(404, 'This connection has no relay secret yet. Rotate it to create one.');
    return NextResponse.json(
      { url: relayUrl(connectionId), secret: unseal<string>(context.inboxRelaySecretCiphertext) },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ connectionId: string }> }) {
  try {
    const identity = await actor(request);
    const { connectionId } = await params;
    await ownedConnection(connectionId, identity.authSubject);
    const secret = randomBytes(32).toString('base64url');
    await mutate('services/integrations:setRelaySecret', {
      connectionId,
      authSubject: identity.authSubject,
      inboxRelaySecretCiphertext: seal(secret),
    });
    return NextResponse.json(
      { url: relayUrl(connectionId), secret },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return failure(error);
  }
}
