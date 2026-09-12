import { convexTest } from 'convex-test';
import { api } from '../convex/_generated/api';
import schema from '../convex/schema';
import type { ProviderId, ToolMode } from '../lib/contracts';

const modules = import.meta.glob('../convex/**/*.ts');
export const secret = 'service-test-secret';
export const linearUrl = 'https://mcp.linear.app/mcp';
export const githubUrl = 'https://api.githubcopilot.com/mcp/';

export type Harness = ReturnType<typeof convexTest>;

export function identity(subject: string, orgId?: string, orgRole = 'org:member') {
  return {
    subject,
    tokenIdentifier: `test|${subject}`,
    issuer: 'test',
    name: subject,
    ...(orgId ? { org_id: orgId, org_role: orgRole } : {}),
  } as never;
}

export function harness() {
  process.env.AHQ_SERVICE_SECRET = secret;
  process.env.PLATFORM_ADMIN_USER_IDS = 'platform-admin';
  return convexTest(schema, modules);
}

export const adminIdentity = identity('platform-admin');

/** Seeds the operational configuration that used to live in environment variables. */
export async function configureProvider(
  t: Harness,
  input: {
    provider: ProviderId;
    enabledUrls?: string[];
    tools?: { name: string; mode: ToolMode; resourceArgument?: string }[];
    oauthClients?: { serverUrl?: string; clientId: string; clientSecretCiphertext?: string }[];
    inboxSecretCiphertext?: string;
  },
) {
  await t.run(async (ctx) => {
    await ctx.db.insert('providerConfigs', {
      provider: input.provider,
      enabledUrls: input.enabledUrls ?? [],
      oauthClients: input.oauthClients ?? [],
      inboxSecretCiphertext: input.inboxSecretCiphertext,
      updatedBy: 'platform-admin',
      updatedAt: 1,
    });
    for (const tool of input.tools ?? [])
      await ctx.db.insert('registryTools', {
        provider: input.provider,
        name: tool.name,
        description: `${tool.name} on ${input.provider}`,
        mode: tool.mode,
        resourceArgument: tool.resourceArgument,
        updatedBy: 'platform-admin',
        updatedAt: 1,
      });
  });
}

export async function linearWorkspace(t: Harness) {
  await configureProvider(t, {
    provider: 'linear',
    enabledUrls: [linearUrl],
    tools: [
      { name: 'get_issue', mode: 'read' },
      { name: 'update_issue', mode: 'write' },
    ],
  });
}

export async function publishEmployee(
  t: Harness,
  options: {
    name?: string;
    capabilities?: { provider: ProviderId; tools: string[]; optional: boolean }[];
  } = {},
) {
  const admin = t.withIdentity(adminIdentity);
  const { draftId } = await admin.mutation(api.marketplace.saveDraft, {
    name: options.name ?? 'Operations analyst',
    role: 'Analyst',
    description: 'Reviews operating work and prepares updates.',
    category: 'Operations',
    strengths: ['Careful review'],
    limitations: ['External writes require approval'],
    capabilities: options.capabilities ?? [],
    model: 'gpt-5.6-terra',
    color: '#6757d9',
    media: [],
    instructions: 'Follow the approved task and cite the records used.',
    skills: [{ name: 'review', version: '1', sha256: 'abc123', content: 'Private skill body' }],
  });
  return admin.mutation(api.marketplace.publish, { draftId });
}

export async function connectLinear(
  t: Harness,
  input: { subject: string; orgId?: string; tools?: string[] },
) {
  return t.mutation(api.services.integrations.connectIntegration, {
    secret,
    authSubject: input.subject,
    authOrgId: input.orgId,
    provider: 'linear',
    name: 'Linear',
    account: 'acme',
    ownerName: input.subject,
    serverUrl: linearUrl,
    tools: input.tools ?? ['get_issue', 'update_issue'],
    credentialCiphertext: 'encrypted-token',
    credentialKeyVersion: 'v1',
  });
}
