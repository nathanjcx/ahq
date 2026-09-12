import { NextResponse } from 'next/server';
import { actor, failure, parseBody } from '@/lib/server/http';
import { connectRequest, type ConnectResponse } from '@/lib/api/schemas';
import { approvedMcpUrl } from '@/lib/server/network';
import { oauthCookie, pickOAuthClient, startOAuth } from '@/lib/server/oauth';
import { providerRuntimeConfig } from '@/lib/server/config';
import { seal } from '@/lib/server/secrets';
import { getProvider } from '@/lib/providers';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const identity = await actor(request);
    const body = await parseBody(request, connectRequest);
    const definition = getProvider(body.provider);
    const serverUrls = [
      ...new Set(
        (body.serverUrls ?? [definition.serverUrl]).map((url) => approvedMcpUrl(body.provider, url).href),
      ),
    ];
    // Never send a user to a consent screen that cannot end in a working connection.
    const config = await providerRuntimeConfig(body.provider);
    if (!config?.reviewedTools) throw new Error('No reviewed tools are available for this provider yet.');
    for (const url of serverUrls) {
      if (!config.enabledUrls.includes(url))
        throw new Error('This server is not enabled by your administrator.');
      if (!pickOAuthClient(config, url)) throw new Error('Sign-in for this server is not set up yet.');
    }
    const [serverUrl, ...queue] = serverUrls;
    const productName = definition.products?.find((product) => product.url === serverUrl)?.name;
    const flow = await startOAuth({
      subject: identity.authSubject,
      orgId: identity.authOrgId,
      provider: definition.id,
      name: productName ? `${definition.name} ${productName}` : definition.name,
      serverUrl,
      queue,
    });
    const response = NextResponse.json(
      { authorizationUrl: flow.authorizationUrl } satisfies ConnectResponse,
      {
        headers: { 'Cache-Control': 'no-store' },
      },
    );
    response.cookies.set('ahq_oauth', seal(flow.state), oauthCookie(request.url));
    return response;
  } catch (error) {
    return failure(error);
  }
}
