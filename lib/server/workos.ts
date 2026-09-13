import { getWorkOS } from '@workos-inc/authkit-nextjs';

/**
 * Sign-in is optional in this application: with no WorkOS credentials the interface renders in
 * preview mode, the proxy only stamps the content policy, and every authenticated route answers 503.
 * One place decides, so the proxy, the routes, and the page agree on what "configured" means.
 * The cookie password is the one value AuthKit refuses at a shorter length, so check it here rather
 * than discover it as a thrown error on the first request.
 */
export function authConfigured() {
  return Boolean(
    process.env.WORKOS_CLIENT_ID &&
    process.env.WORKOS_API_KEY &&
    (process.env.WORKOS_COOKIE_PASSWORD || '').length >= 32 &&
    process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI,
  );
}

/** WorkOS ships `admin` and `member` role slugs; anything else a dashboard adds is a member. */
function membershipRole(slug: string): 'admin' | 'member' {
  return slug === 'admin' ? 'admin' : 'member';
}

function personName(user: { name: string | null; firstName: string | null; lastName: string | null }) {
  return user.name || [user.firstName, user.lastName].filter(Boolean).join(' ');
}

/** The organizations the signed-in person belongs to, for the workspace switcher. */
export async function organizationsFor(userId: string) {
  const memberships = await getWorkOS().userManagement.listOrganizationMemberships({
    userId,
    statuses: ['active'],
    limit: 100,
  });
  return memberships.data.map((membership) => ({
    id: membership.organizationId,
    name: membership.organizationName,
    role: membershipRole(membership.role.slug),
  }));
}

/**
 * Creates an organization and puts its creator in it as an administrator, which is what makes them
 * the workspace owner once the session switches to it.
 */
export async function createOrganizationFor(userId: string, name: string) {
  const organization = await getWorkOS().organizations.createOrganization({ name });
  await getWorkOS().userManagement.createOrganizationMembership({
    organizationId: organization.id,
    userId,
    roleSlug: 'admin',
  });
  return { id: organization.id, name: organization.name };
}

/**
 * Everyone in one organization, named. Memberships carry the role and users carry the name, so this
 * is two list calls joined on the user id rather than a lookup per member.
 */
export async function organizationMembers(organizationId: string) {
  const [memberships, users] = await Promise.all([
    getWorkOS().userManagement.listOrganizationMemberships({
      organizationId,
      statuses: ['active'],
      limit: 100,
    }),
    getWorkOS().userManagement.listUsers({ organizationId, limit: 100 }),
  ]);
  const byId = new Map(users.data.map((user) => [user.id, user]));
  return memberships.data.flatMap((membership) => {
    const user = byId.get(membership.userId);
    if (!user) return [];
    return [
      {
        subject: user.id,
        name: personName(user) || user.email,
        email: user.email,
        imageUrl: user.profilePictureUrl ?? undefined,
        role: membershipRole(membership.role.slug),
      },
    ];
  });
}
