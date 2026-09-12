import {
  alertSecretRequest,
  clearAlertSecretRequest,
  type RemovedResponse,
  type SavedResponse,
} from '@/lib/api/schemas';
import { mutate } from '@/lib/server/backend';
import { failure, jsonOk, parseBody, platformAdmin } from '@/lib/server/http';
import { seal } from '@/lib/server/secrets';

export const runtime = 'nodejs';

/**
 * The signing secret for one workspace's alert intake, sealed here and stored only as ciphertext.
 * Platform administrators own it, like the other secrets under `/api/admin`, until Settings grows a
 * workspace-administrator route of its own.
 */
export async function POST(request: Request) {
  try {
    await platformAdmin(request);
    const body = await parseBody(request, alertSecretRequest);
    await mutate('services/triage:setAlertSecret', {
      workspaceId: body.workspaceId,
      alertSecretCiphertext: seal(body.alertSecret),
    });
    return jsonOk({ saved: true } satisfies SavedResponse);
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await platformAdmin(request);
    const body = await parseBody(request, clearAlertSecretRequest);
    await mutate('services/triage:setAlertSecret', { workspaceId: body.workspaceId });
    return jsonOk({ removed: true } satisfies RemovedResponse);
  } catch (error) {
    return failure(error);
  }
}
