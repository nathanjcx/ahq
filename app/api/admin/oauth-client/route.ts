import { NextResponse } from 'next/server';
import { z } from 'zod';
import { failure, jsonBody, platformAdmin } from '@/lib/server/http';
import { mutate } from '@/lib/server/backend';
import { seal } from '@/lib/server/secrets';
import { getProvider, providerServerUrls } from '@/lib/providers';
export const runtime = 'nodejs';

const input = z.object({
  provider: z.string(),
  serverUrl: z.string().max(2048).optional(),
  clientId: z.string().min(1).max(500),
  clientSecret: z.string().max(2000).optional(),
  scopes: z.string().max(2000).optional(),
  authorizationUrl: z.string().url().optional(),
  tokenUrl: z.string().url().optional(),
  tokenAuthMethod: z.enum(['client_secret_basic', 'client_secret_post', 'none']).optional(),
});

function serverUrl(provider: string, url?: string) {
  if (url && !providerServerUrls(getProvider(provider)).includes(url))
    throw new Error('That server is not in the provider registry.');
  return url;
}

/** The browser sends the client secret once; only this route can seal it for Convex. */
export async function POST(request: Request) {
  try {
    const identity = await platformAdmin(request);
    const body = input.parse(await jsonBody(request));
    await mutate('services/config:setOAuthClient', {
      actorSubject: identity.authSubject,
      provider: getProvider(body.provider).id,
      serverUrl: serverUrl(body.provider, body.serverUrl),
      clientId: body.clientId,
      clientSecretCiphertext: body.clientSecret ? seal(body.clientSecret) : undefined,
      scopes: body.scopes,
      authorizationUrl: body.authorizationUrl,
      tokenUrl: body.tokenUrl,
      tokenAuthMethod: body.tokenAuthMethod,
    });
    return NextResponse.json({ saved: true });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const identity = await platformAdmin(request);
    const body = input.pick({ provider: true, serverUrl: true }).parse(await jsonBody(request));
    await mutate('services/config:removeOAuthClient', {
      actorSubject: identity.authSubject,
      provider: getProvider(body.provider).id,
      serverUrl: body.serverUrl,
    });
    return NextResponse.json({ removed: true });
  } catch (error) {
    return failure(error);
  }
}
