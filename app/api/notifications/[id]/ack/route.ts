import { type AcknowledgedResponse } from '@/lib/api/schemas';
import { mutate } from '@/lib/server/backend';
import { actor, failure, jsonOk } from '@/lib/server/http';

export const runtime = 'nodejs';

/** Acknowledging is what the emergency rule counts as an answer, so only the subject may do it. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const identity = await actor(request);
    const { id } = await params;
    await mutate('services/notifications:acknowledgeForSubject', { subject: identity.authSubject, id });
    return jsonOk({ acknowledged: true } satisfies AcknowledgedResponse);
  } catch (error) {
    return failure(error);
  }
}
