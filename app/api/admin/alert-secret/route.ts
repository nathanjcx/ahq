import { alertSecretRequest, type RemovedResponse, type SavedResponse } from '@/lib/api/schemas';
import { mutate } from '@/lib/server/backend';
import { actor, failure, jsonOk, parseBody } from '@/lib/server/http';
import { seal } from '@/lib/server/secrets';

export const runtime = 'nodejs';

/**
 * The signing secret for the caller's workspace alert intake, sealed here and stored only as
 * ciphertext. A workspace owner or administrator sets it; Convex resolves the workspace from the
 * caller's Clerk claims and checks the role.
 */
export async function POST(request: Request) {
  try {
    const identity = await actor(request);
    const body = await parseBody(request, alertSecretRequest);
    await mutate('services/triage:setAlertSecretForActor', {
      ...identity,
      alertSecretCiphertext: seal(body.alertSecret),
    });
    return jsonOk({ saved: true } satisfies SavedResponse);
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const identity = await actor(request);
    await mutate('services/triage:setAlertSecretForActor', identity);
    return jsonOk({ removed: true } satisfies RemovedResponse);
  } catch (error) {
    return failure(error);
  }
}
