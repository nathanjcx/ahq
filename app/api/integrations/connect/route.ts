import { NextResponse } from 'next/server';
import { z } from 'zod';
import { actor, failure, jsonBody } from '@/lib/server/http';
import { approvedMcpUrl } from '@/lib/server/network';
import { oauthConfigured, oauthCookie, startOAuth } from '@/lib/server/oauth';
import { seal } from '@/lib/server/secrets';
import { query } from '@/lib/server/backend';
import { getProvider } from '@/lib/providers';
import type { ProviderReadiness } from '@/lib/contracts';
export const runtime = 'nodejs';
const input = z.object({
  provider: z.string(),
  serverUrls: z.array(z.string().max(2048)).min(1).max(10).optional(),
});
export async function POST(request: Request) {
  try {
    const identity = await actor(request);
    const body = input.parse(await jsonBody(request));
    const definition = getProvider(body.provider);
    const serverUrls = [
      ...new Set(
        (body.serverUrls ?? [definition.serverUrl]).map((url) => approvedMcpUrl(body.provider, url).href),
      ),
    ];
    // Never send a user to a consent screen that cannot end in a working connection.
    const readiness = (await query<ProviderReadiness[]>('services:readiness')).find(
      (entry) => entry.provider === body.provider,
    );
    if (!readiness?.reviewedTools) throw new Error('No reviewed tools are available for this provider yet.');
    for (const url of serverUrls) {
      if (!readiness.enabledUrls.includes(url))
        throw new Error('This server is not enabled by your administrator.');
      if (!oauthConfigured(body.provider, url)) throw new Error('Sign-in for this server is not set up yet.');
    }
    const [serverUrl, ...queue] = serverUrls;
    const productName = definition.products?.find((product) => product.url === serverUrl)?.name;
    const flow = await startOAuth({
      subject: identity.authSubject,
      orgId: identity.authOrgId,
      provider: body.provider,
      name: productName ? `${definition.name} ${productName}` : definition.name,
      serverUrl,
      queue,
    });
    const response = NextResponse.json({ authorizationUrl: flow.authorizationUrl });
    response.cookies.set('ahq_oauth', seal(flow.state), oauthCookie(request.url));
    return response;
  } catch (error) {
    return failure(error);
  }
}
