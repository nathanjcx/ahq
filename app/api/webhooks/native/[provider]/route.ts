import { NextResponse } from 'next/server';
import { mutate } from '../../../../../lib/server/backend';
import { failure, HttpError, rawBody } from '../../../../../lib/server/http';
import {
  isNativeProvider,
  nativeSecret,
  parseNativeDelivery,
  type NativeDelivery,
  type NativeProvider,
} from '../../../../../lib/server/native-inbox';
import { senderKey, withinRateLimit } from '../../../../../lib/server/rate-limit';

export const runtime = 'nodejs';

/**
 * One provider's deliveries share a bucket, because a signing secret belongs to the provider and not
 * to a connection. Charging that bucket before the signature is checked would let anyone drop every
 * real GitHub, Linear, or Slack delivery for a minute with junk, so unverified traffic is metered by
 * sender and only a delivery that verifies spends the provider's allowance.
 */
function verified(provider: NativeProvider, secret: string, body: string, headers: Headers): NativeDelivery {
  try {
    return parseNativeDelivery(provider, secret, body, headers);
  } catch (error) {
    if (!withinRateLimit(`native-senders:${senderKey(headers)}`, 600))
      throw new HttpError(429, 'Too many deliveries from this sender.', 'rate_limited');
    throw error;
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  try {
    const { provider } = await params;
    if (!isNativeProvider(provider)) throw new HttpError(404, 'Unknown native inbox provider.');
    const secret = await nativeSecret(provider);
    if (!secret) throw new HttpError(404, 'Native inbox delivery is not configured for this provider.');
    const body = await rawBody(request, 1_000_000);
    const delivery = verified(provider, secret, body, request.headers);
    if (!withinRateLimit(`native-inbox:${provider}`, 600))
      throw new HttpError(429, 'Too many deliveries for this provider.', 'rate_limited');
    if (delivery.kind === 'challenge') return NextResponse.json({ challenge: delivery.challenge });
    if (delivery.kind === 'ignored')
      return NextResponse.json({ accepted: true, ignored: true }, { status: 202 });
    const { delivered } = await mutate<{ delivered: number }>('services/inbox:ingestInboxByResource', {
      provider,
      resourceIds: delivery.resourceIds,
      items: delivery.items,
    });
    // A GitHub delivery is also triage input: the workspace's label and keyword rules decide.
    if (provider === 'github')
      await mutate('services/triage:matchGithubDelivery', {
        resourceIds: delivery.resourceIds,
        payload: body,
      });
    return NextResponse.json({ accepted: true, delivered }, { status: 202 });
  } catch (error) {
    return failure(error);
  }
}
