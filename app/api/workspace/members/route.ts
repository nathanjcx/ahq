import { clerkClient } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { actor, displayName, failure } from '@/lib/server/http';
import type { Member } from '@/lib/contracts';
export const runtime = 'nodejs';

function role(clerkRole: string): Member['role'] {
  return clerkRole === 'org:admin' || clerkRole === 'admin' ? 'admin' : 'member';
}

/** Members come from Clerk, the source of truth for who belongs to the workspace. */
export async function GET() {
  try {
    const identity = await actor();
    if (!identity.authOrgId)
      return NextResponse.json([
        { subject: identity.authSubject, name: await displayName(identity.authSubject), role: 'owner' },
      ] satisfies Member[]);
    const { data } = await (
      await clerkClient()
    ).organizations.getOrganizationMembershipList({
      organizationId: identity.authOrgId,
      limit: 200,
    });
    const members: Member[] = data.flatMap((membership) => {
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
    return NextResponse.json(members, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return failure(error);
  }
}
