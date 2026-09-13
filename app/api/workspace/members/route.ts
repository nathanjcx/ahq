import type { MembersResponse } from '@/lib/api/schemas';
import { actor, failure, jsonOk } from '@/lib/server/http';
import { organizationMembers } from '@/lib/server/workos';
export const runtime = 'nodejs';

/** Members come from WorkOS, the source of truth for who belongs to the workspace. */
export async function GET() {
  try {
    const identity = await actor();
    if (!identity.authOrgId)
      return jsonOk([
        { subject: identity.authSubject, name: identity.authName, role: 'owner' },
      ] satisfies MembersResponse);
    return jsonOk((await organizationMembers(identity.authOrgId)) satisfies MembersResponse);
  } catch (error) {
    return failure(error);
  }
}
