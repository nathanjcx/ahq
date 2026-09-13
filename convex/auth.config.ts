import type { AuthConfig } from 'convex/server';

const clientId = process.env.WORKOS_CLIENT_ID;
/** The host WorkOS issues tokens from: `api.workos.com`, or the environment's custom auth domain. */
const hosts = [...new Set(['api.workos.com', process.env.WORKOS_AUTH_DOMAIN].filter(Boolean))] as string[];

/**
 * WorkOS AuthKit access tokens, validated against the environment's public keys. Each host WorkOS
 * may issue from contributes two issuers: user management tokens come from the
 * `user_management/<client id>` issuer and carry no audience, while the plain host issuer does. A
 * custom auth domain changes the issuer and the JWKS host together, so both follow WORKOS_AUTH_DOMAIN.
 */
export default {
  providers: hosts.flatMap((host) => [
    {
      type: 'customJwt' as const,
      issuer: `https://${host}/`,
      algorithm: 'RS256' as const,
      jwks: `https://${host}/sso/jwks/${clientId}`,
      applicationID: clientId,
    },
    {
      type: 'customJwt' as const,
      issuer: `https://${host}/user_management/${clientId}`,
      algorithm: 'RS256' as const,
      jwks: `https://${host}/sso/jwks/${clientId}`,
    },
  ]),
} satisfies AuthConfig;
