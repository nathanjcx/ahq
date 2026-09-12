import {
  pushSubscribeRequest,
  pushUnsubscribeRequest,
  type RemovedResponse,
  type SubscribedResponse,
} from '@/lib/api/schemas';
import { mutate } from '@/lib/server/backend';
import { actor, failure, HttpError, jsonOk, parseBody } from '@/lib/server/http';
import { requireSafeEndpoint } from '@/lib/server/notify';
import { seal } from '@/lib/server/secrets';

export const runtime = 'nodejs';

/** A browser push endpoint. The subscription keys are sealed here; Convex stores ciphertext only. */
export async function POST(request: Request) {
  try {
    const identity = await actor(request);
    const body = await parseBody(request, pushSubscribeRequest, 10_000);
    // The send path refuses an endpoint inside this network whatever is stored; refusing it here too
    // tells the browser rather than leaving a subscription that can never deliver.
    try {
      requireSafeEndpoint(body.endpoint);
    } catch (error) {
      throw new HttpError(400, (error as Error).message, 'invalid_request');
    }
    await mutate('services/notifications:subscribePush', {
      authSubject: identity.authSubject,
      authOrgId: identity.authOrgId,
      endpoint: body.endpoint,
      keysCiphertext: seal(body.keys),
    });
    return jsonOk({ subscribed: true } satisfies SubscribedResponse);
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const identity = await actor(request);
    const body = await parseBody(request, pushUnsubscribeRequest, 10_000);
    await mutate('services/notifications:unsubscribePush', {
      authSubject: identity.authSubject,
      endpoint: body.endpoint,
    });
    return jsonOk({ removed: true } satisfies RemovedResponse);
  } catch (error) {
    return failure(error);
  }
}
