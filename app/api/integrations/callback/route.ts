import { randomBytes } from 'node:crypto';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getProvider } from '@/lib/providers';
import { mutate } from '@/lib/server/backend';
import { GMAIL_SERVER_URL, startGmailWatch } from '@/lib/server/gmail';
import { actor, failure, workspaceClaims } from '@/lib/server/http';
import { discoverTools } from '@/lib/server/mcp';
import {
  finishOAuth,
  oauthCookie,
  startOAuth,
  type OAuthState,
  type StoredCredential,
  credentialForServer,
} from '@/lib/server/oauth';
import { unseal, seal, equalSecret, requiredEnv } from '@/lib/server/secrets';
export const runtime = 'nodejs';

async function connect(
  identity: { authSubject: string; authOrgId?: string },
  ownerName: string,
  state: Pick<OAuthState, 'provider' | 'serverUrl' | 'name'>,
  credential: StoredCredential,
) {
  const tools = await discoverTools(state, credential);
  const credentialCiphertext = seal(credential);
  const { connectionId } = await mutate<{ connectionId: string }>(
    'services/integrations:connectIntegration',
    {
      ...workspaceClaims(identity),
      provider: state.provider,
      name: state.name,
      account: state.name,
      ownerName,
      serverUrl: state.serverUrl,
      tools: tools.map((tool) => tool.name),
      toolAnnotations: tools.map((tool) => ({
        name: tool.name,
        readOnlyHint: tool.annotations?.readOnlyHint,
        destructiveHint: tool.annotations?.destructiveHint,
        idempotentHint: tool.annotations?.idempotentHint,
      })),
      credentialCiphertext,
      credentialKeyVersion: '1',
      // Convex cannot seal, so the relay secret is generated and sealed here.
      inboxRelaySecretCiphertext: seal(randomBytes(32).toString('base64url')),
    },
  );
  // Gmail publishes this mailbox's changes to us from now on. A watch that cannot start is reported on
  // the connection rather than failing the sign-in; the worker's renewal pass tries again.
  if (state.serverUrl === GMAIL_SERVER_URL && process.env.GMAIL_PUBSUB_TOPIC) {
    await startGmailWatch({
      id: connectionId,
      provider: state.provider,
      serverUrl: state.serverUrl,
      credentialCiphertext,
    }).catch((error) =>
      mutate('services/integrations:markConnectionError', {
        connectionId,
        error: `Gmail push: ${error instanceof Error ? error.message : 'could not start the watch'}`.slice(
          0,
          500,
        ),
      }).catch(() => {}),
    );
  }
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
    const queue = [...(state.queue ?? [])];
    const credential = await finishOAuth(state, code);
    await connect(identity, identity.authName, state, credential);
    // Remaining servers of a multi-product provider. Reuse the grant when the server accepts it;
    // otherwise send the user through consent for that server.
    const definition = getProvider(state.provider);
    while (queue.length) {
      const serverUrl = queue.shift() as string;
      const productName = definition.products?.find((product) => product.url === serverUrl)?.name;
      const next = {
        subject: state.subject,
        orgId: state.orgId,
        provider: state.provider,
        name: productName ? `${definition.name} ${productName}` : definition.name,
        serverUrl,
      };
      try {
        await connect(
          identity,
          identity.authName,
          next,
          credentialForServer(credential, serverUrl, next.name),
        );
      } catch (error) {
        if (!(error instanceof UnauthorizedError)) throw error;
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
