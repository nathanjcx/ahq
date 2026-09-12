import { failure, jsonOk, parseBody, platformAdmin } from '@/lib/server/http';
import {
  clearInboxSecretRequest,
  inboxSecretRequest,
  type RemovedResponse,
  type SavedResponse,
} from '@/lib/api/schemas';
import { mutate } from '@/lib/server/backend';
import { seal } from '@/lib/server/secrets';
import { getProvider } from '@/lib/providers';
export const runtime = 'nodejs';

/** The provider's app-level webhook signing secret, sealed here and stored only as ciphertext. */
export async function POST(request: Request) {
  try {
    const identity = await platformAdmin(request);
    const body = await parseBody(request, inboxSecretRequest);
    await mutate('services/config:setInboxSecret', {
      actorSubject: identity.authSubject,
      provider: getProvider(body.provider).id,
      inboxSecretCiphertext: seal(body.inboxSecret),
    });
    return jsonOk({ saved: true } satisfies SavedResponse);
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const identity = await platformAdmin(request);
    const body = await parseBody(request, clearInboxSecretRequest);
    await mutate('services/config:setInboxSecret', {
      actorSubject: identity.authSubject,
      provider: getProvider(body.provider).id,
    });
    return jsonOk({ removed: true } satisfies RemovedResponse);
  } catch (error) {
    return failure(error);
  }
}
