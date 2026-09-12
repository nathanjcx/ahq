import { NextResponse } from 'next/server';
import { z } from 'zod';
import { failure, jsonBody, platformAdmin } from '@/lib/server/http';
import { mutate } from '@/lib/server/backend';
import { seal } from '@/lib/server/secrets';
import { getProvider } from '@/lib/providers';
export const runtime = 'nodejs';

const input = z.object({ provider: z.string(), inboxSecret: z.string().min(1).max(2000).optional() });

/** The provider's app-level webhook signing secret, sealed here and stored only as ciphertext. */
export async function POST(request: Request) {
  try {
    const identity = await platformAdmin(request);
    const body = input.parse(await jsonBody(request));
    if (!body.inboxSecret) throw new Error('An inbox secret is required.');
    await mutate('services/config:setInboxSecret', {
      actorSubject: identity.authSubject,
      provider: getProvider(body.provider).id,
      inboxSecretCiphertext: seal(body.inboxSecret),
    });
    return NextResponse.json({ saved: true });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const identity = await platformAdmin(request);
    const body = input.pick({ provider: true }).parse(await jsonBody(request));
    await mutate('services/config:setInboxSecret', {
      actorSubject: identity.authSubject,
      provider: getProvider(body.provider).id,
    });
    return NextResponse.json({ removed: true });
  } catch (error) {
    return failure(error);
  }
}
