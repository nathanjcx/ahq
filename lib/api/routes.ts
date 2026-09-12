/** Web routes that need the encryption key or Clerk's backend API. Convex handles everything else. */
export const webApi = {
  members: '/api/workspace/members',
  audit: (taskId: string) => `/api/audit/${encodeURIComponent(taskId)}`,
  connect: '/api/integrations/connect',
  relaySecret: (connectionId: string) => `/api/integrations/relay-secret/${encodeURIComponent(connectionId)}`,
  adminOAuthClient: '/api/admin/oauth-client',
  adminInboxSecret: '/api/admin/inbox-secret',
} as const;

/** Proves to a route that the request came from this application's own code, not a cross-site form. */
export const REQUESTED_WITH = { header: 'x-requested-with', value: 'astra-hq' } as const;
