import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { actor, failure } from '@/lib/server/http';
import { unseal, seal, equalSecret, requiredEnv } from '@/lib/server/secrets';
import { finishOAuth, oauthCookie, startOAuth, type OAuthState, type StoredCredential } from '@/lib/server/oauth';
import { discoverTools } from '@/lib/server/mcp';
import { mutate } from '@/lib/server/backend';
import { getProvider } from '@/lib/providers';
export const runtime = 'nodejs';

async function connect(identity: { authSubject: string; authOrgId?: string }, state: OAuthState, credential: StoredCredential) {
  const tools = await discoverTools(state, credential);
  await mutate('services:connectIntegration', {
    ...identity,
    provider: state.provider,
    name: state.name,
    account: state.name,
    serverUrl: state.serverUrl,
    tools: tools.map((t) => t.name),
    credentialCiphertext: seal(credential),
    credentialKeyVersion: '1',
  });
}

export async function GET(request: Request) {
  const jar = await cookies();
  const value = jar.get('ahq_oauth')?.value;
  jar.delete('ahq_oauth');
  try {
    const identity = await actor();
    const url = new URL(request.url);
    if (!value) throw new Error('Authorization expired. Start again from Integrations.');
    const state = unseal<OAuthState>(value);
    if (
      !equalSecret(url.searchParams.get('state') || '', state.nonce) ||
      state.subject !== identity.authSubject ||
      state.orgId !== identity.authOrgId ||
      Date.now() - state.createdAt > 600000
    )
      throw new Error('Authorization session does not match.');
    const code = url.searchParams.get('code');
    if (!code) throw new Error('Authorization was not granted.');
    const credential = await finishOAuth(state, code);
    await connect(identity, state, credential);
    // Remaining servers of a multi-product provider. Reuse the grant when the server accepts it;
    // otherwise send the user through consent for that server.
    const definition = getProvider(state.provider);
    const queue = [...(state.queue ?? [])];
    while (queue.length) {
      const serverUrl = queue.shift() as string;
      const productName = definition.products?.find((product) => product.url === serverUrl)?.name;
      const next = { ...state, serverUrl, name: productName ? `${definition.name} ${productName}` : definition.name };
      try {
        await connect(identity, next, credential);
      } catch {
        const flow = await startOAuth({ ...next, queue });
        const response = NextResponse.redirect(flow.authorizationUrl);
        response.cookies.set('ahq_oauth', seal(flow.state), oauthCookie(request.url));
        return response;
      }
    }
    return NextResponse.redirect(new URL('/#integrations', requiredEnv('APP_URL')));
  } catch (error) {
    return failure(error);
  }
}
