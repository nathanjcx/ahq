import type { AuthConfig } from 'convex/server';

const clientId = process.env.WORKOS_CLIENT_ID;

/**
 * WorkOS AuthKit access tokens, validated against the environment's public keys. Two issuers because
 * WorkOS has two: user management tokens come from the `user_management/<client id>` issuer and carry
 * no audience, while the plain `api.workos.com` issuer does. Both are signed by the same JWKS.
 */
export default {
  providers: [
    {
      type: 'customJwt',
      issuer: 'https://api.workos.com/',
      algorithm: 'RS256',
      jwks: `https://api.workos.com/sso/jwks/${clientId}`,
      applicationID: clientId,
    },
    {
      type: 'customJwt',
      issuer: `https://api.workos.com/user_management/${clientId}`,
      algorithm: 'RS256',
      jwks: `https://api.workos.com/sso/jwks/${clientId}`,
    },
  ],
} satisfies AuthConfig;
