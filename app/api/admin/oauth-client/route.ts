import { failure, jsonOk, parseBody, platformAdmin } from '@/lib/server/http';
import {
  oauthClientRequest,
  removeOAuthClientRequest,
  type RemovedResponse,
  type SavedResponse,
} from '@/lib/api/schemas';
import { mutate } from '@/lib/server/backend';
import { seal } from '@/lib/server/secrets';
import { getProvider, providerServerUrls } from '@/lib/providers';
export const runtime = 'nodejs';

function serverUrl(provider: string, url?: string) {
  if (url && !providerServerUrls(getProvider(provider)).includes(url))
    throw new Error('That server is not in the provider registry.');
  return url;
}

/** The browser sends the client secret once; only this route can seal it for Convex. It is never read back. */
export async function POST(request: Request) {
  try {
    const identity = await platformAdmin(request);
    const body = await parseBody(request, oauthClientRequest);
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
    return jsonOk({ saved: true } satisfies SavedResponse);
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const identity = await platformAdmin(request);
    const body = await parseBody(request, removeOAuthClientRequest);
    await mutate('services/config:removeOAuthClient', {
      actorSubject: identity.authSubject,
      provider: getProvider(body.provider).id,
      serverUrl: body.serverUrl,
    });
    return jsonOk({ removed: true } satisfies RemovedResponse);
  } catch (error) {
    return failure(error);
  }
}
