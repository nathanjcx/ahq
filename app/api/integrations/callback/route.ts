import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { actor, failure } from '@/lib/server/http';
import { unseal, seal, equalSecret, requiredEnv } from '@/lib/server/secrets';
import { finishOAuth, type OAuthState } from '@/lib/server/oauth';
import { discoverTools } from '@/lib/server/mcp';
import { mutate } from '@/lib/server/backend';
export const runtime = 'nodejs';
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
    const tools = await discoverTools(state, credential);
    // OAuth consent grants account scopes. Tool-level grants remain empty until the user selects them.
    const allowedTools = state.allowedTools.filter((name) => tools.some((t) => t.name === name));
    await mutate('services:connectIntegration', {
      ...identity,
      provider: state.provider,
      name: state.name,
      account: state.name,
      serverUrl: state.serverUrl,
      tools: tools.map((t) => t.name),
      allowedTools,
      resourceScope: state.resourceScope,
      inboxMode: 'on-demand',
      credentialCiphertext: seal(credential),
      credentialKeyVersion: '1',
    });
    return NextResponse.redirect(new URL('/#integrations', requiredEnv('APP_URL')));
  } catch (error) {
    return failure(error);
  }
}
