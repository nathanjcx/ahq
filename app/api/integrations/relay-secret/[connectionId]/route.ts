import { randomBytes } from 'node:crypto';
import { actor, failure, HttpError, jsonOk } from '@/lib/server/http';
import { withinRateLimit } from '@/lib/server/rate-limit';
import type { RelaySecretResponse } from '@/lib/api/schemas';
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
    throw new HttpError(404, 'Connection not found.', 'not_found');
  return context;
}

/** Reveals the relay secret to its owner. The browser never receives another member's secret. */
export async function GET(_request: Request, { params }: { params: Promise<{ connectionId: string }> }) {
  try {
    const identity = await actor();
    const { connectionId } = await params;
    // Keyed by viewer as well as connection, so no one can exhaust the owner's budget for them.
    if (!withinRateLimit(`relay-reveal:${identity.authSubject}:${connectionId}`, 10))
      throw new HttpError(429, 'Too many reveal requests. Try again in a minute.', 'rate_limited');
    const context = await ownedConnection(connectionId, identity.authSubject);
    if (!context.inboxRelaySecretCiphertext)
      throw new HttpError(
        404,
        'This connection has no relay secret yet. Rotate it to create one.',
        'not_found',
      );
    return jsonOk({
      url: relayUrl(connectionId),
      secret: unseal<string>(context.inboxRelaySecretCiphertext),
    } satisfies RelaySecretResponse);
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
    return jsonOk({ url: relayUrl(connectionId), secret } satisfies RelaySecretResponse);
  } catch (error) {
    return failure(error);
  }
}
