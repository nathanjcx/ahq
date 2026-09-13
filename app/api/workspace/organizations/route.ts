import { createOrganizationRequest, type OrganizationsResponse } from '@/lib/api/schemas';
import { actor, failure, jsonOk, parseBody } from '@/lib/server/http';
import { createOrganizationFor, organizationsFor } from '@/lib/server/workos';
export const runtime = 'nodejs';

/** The organizations the caller belongs to. One of them is the workspace the session is open on. */
export async function GET() {
  try {
    const identity = await actor();
    return jsonOk((await organizationsFor(identity.authSubject)) satisfies OrganizationsResponse);
  } catch (error) {
    return failure(error);
  }
}

/**
 * Creates an organization with the caller as its administrator. Creating it does not move the
 * session: the browser switches to the new organization afterwards, which is what opens its
 * workspace. The WorkOS API key lives only here, so this cannot happen in the browser.
 */
export async function POST(request: Request) {
  try {
    const identity = await actor(request);
    const body = await parseBody(request, createOrganizationRequest);
    const organization = await createOrganizationFor(identity.authSubject, body.name);
    return jsonOk({ ...organization, role: 'admin' } satisfies OrganizationsResponse[number]);
  } catch (error) {
    return failure(error);
  }
}
