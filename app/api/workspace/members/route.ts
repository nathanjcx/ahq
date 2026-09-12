import { clerkClient } from '@clerk/nextjs/server';
import { actor, displayName, failure, jsonOk } from '@/lib/server/http';
import type { MembersResponse } from '@/lib/api/schemas';
export const runtime = 'nodejs';

function role(clerkRole: string): MembersResponse[number]['role'] {
  return clerkRole === 'org:admin' || clerkRole === 'admin' ? 'admin' : 'member';
}

/** Members come from Clerk, the source of truth for who belongs to the workspace. */
export async function GET() {
  try {
    const identity = await actor();
    if (!identity.authOrgId)
      return jsonOk([
        { subject: identity.authSubject, name: await displayName(identity.authSubject), role: 'owner' },
      ] satisfies MembersResponse);
    const { data } = await (
      await clerkClient()
    ).organizations.getOrganizationMembershipList({
      organizationId: identity.authOrgId,
      limit: 200,
    });
    const members: MembersResponse = data.flatMap((membership) => {
      const user = membership.publicUserData;
      if (!user) return [];
      const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.identifier;
      return [
        {
          subject: user.userId,
          name,
          email: user.identifier.includes('@') ? user.identifier : undefined,
          imageUrl: user.imageUrl,
          role: role(membership.role),
        },
      ];
    });
    return jsonOk(members);
  } catch (error) {
    return failure(error);
  }
}
