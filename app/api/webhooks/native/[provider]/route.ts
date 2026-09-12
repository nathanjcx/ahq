import { NextResponse } from 'next/server';
import { mutate } from '../../../../../lib/server/backend';
import { failure, HttpError, rawBody } from '../../../../../lib/server/http';
import { isNativeProvider, nativeSecret, parseNativeDelivery } from '../../../../../lib/server/native-inbox';

export const runtime = 'nodejs';

export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  try {
    const { provider } = await params;
    if (!isNativeProvider(provider)) throw new HttpError(404, 'Unknown native inbox provider.');
    const secret = await nativeSecret(provider);
    if (!secret) throw new HttpError(404, 'Native inbox delivery is not configured for this provider.');
    const body = await rawBody(request, 1_000_000);
    const delivery = parseNativeDelivery(provider, secret, body, request.headers);
    if (delivery.kind === 'challenge') return NextResponse.json({ challenge: delivery.challenge });
    if (delivery.kind === 'ignored')
      return NextResponse.json({ accepted: true, ignored: true }, { status: 202 });
    const { delivered } = await mutate<{ delivered: number }>('services/inbox:ingestInboxByResource', {
      provider,
      resourceIds: delivery.resourceIds,
      items: delivery.items,
    });
    return NextResponse.json({ accepted: true, delivered }, { status: 202 });
  } catch (error) {
    return failure(error);
  }
}
