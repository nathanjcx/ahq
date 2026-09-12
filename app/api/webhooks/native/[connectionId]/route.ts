import { NextResponse } from 'next/server';
import { query, mutate } from '../../../../../lib/server/backend';
import { failure, HttpError, rawBody } from '../../../../../lib/server/http';
import { nativeConfig, parseNativeDelivery } from '../../../../../lib/server/native-inbox';

export const runtime = 'nodejs';

export async function POST(request: Request, { params }: { params: Promise<{ connectionId: string }> }) {
  try {
    const { connectionId } = await params;
    const config = nativeConfig(connectionId);
    if (!config) throw new HttpError(404, 'Native inbox delivery is not configured for this connection.');
    const context = await query<{
      connection: { id: string; provider: string; status: string };
    }>('services:connectionContext', { connectionId });
    if (
      context.connection.id !== connectionId ||
      context.connection.provider !== config.provider ||
      context.connection.status !== 'connected'
    )
      throw new HttpError(404, 'Native inbox connection is unavailable.');
    const body = await rawBody(request, 1_000_000);
    const delivery = parseNativeDelivery(config, body, request.headers);
    if (delivery.kind === 'challenge') return NextResponse.json({ challenge: delivery.challenge });
    if (delivery.kind === 'ignored')
      return NextResponse.json({ accepted: true, ignored: true }, { status: 202 });
    await mutate('services:ingestInbox', { connectionId, items: delivery.items });
    return NextResponse.json({ accepted: true }, { status: 202 });
  } catch (error) {
    return failure(error);
  }
}
