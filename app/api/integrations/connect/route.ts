import { NextResponse } from 'next/server';
import { z } from 'zod';
import { actor, failure, jsonBody } from '@/lib/server/http';
import { approvedMcpUrl } from '@/lib/server/network';
import { discoverTools } from '@/lib/server/mcp';
import { startOAuth } from '@/lib/server/oauth';
import { seal } from '@/lib/server/secrets';
import { mutate } from '@/lib/server/backend';
import { validateScope } from '@/lib/server/tool-policy';
export const runtime = 'nodejs';
const input = z.object({
  provider: z.string(),
  name: z.string().trim().min(1).max(100),
  serverUrl: z.string().max(2048).default(''),
  accessToken: z.string().max(12000).optional(),
  allowedTools: z.array(z.string().max(150)).max(200).default([]),
  resourceScope: z.string().max(4000).default(''),
  discoverOnly: z.boolean().default(false),
});
export async function POST(request: Request) {
  try {
    const identity = await actor(request);
    const body = input.parse(await jsonBody(request));
    const serverUrl = approvedMcpUrl(body.provider, body.serverUrl).href;
    validateScope(body.resourceScope);
    if (!body.accessToken) {
      const flow = await startOAuth({
        subject: identity.authSubject,
        orgId: identity.authOrgId,
        provider: body.provider,
        name: body.name,
        serverUrl,
        allowedTools: body.allowedTools,
        resourceScope: body.resourceScope,
      });
      const response = NextResponse.json({ authorizationUrl: flow.authorizationUrl });
      response.cookies.set('ahq_oauth', seal(flow.state), {
        httpOnly: true,
        secure: new URL(request.url).protocol === 'https:',
        sameSite: 'lax',
        path: '/api/integrations/callback',
        maxAge: 600,
      });
      return response;
    }
    const credential = { accessToken: body.accessToken };
    const tools = await discoverTools({ provider: body.provider, serverUrl }, credential);
    if (body.discoverOnly)
      return NextResponse.json({
        tools: tools.map((t) => ({ name: t.name, description: t.description || '' })),
      });
    if (!body.allowedTools.length) throw new Error('Select at least one discovered tool before connecting.');
    if (body.allowedTools.some((name) => !tools.some((t) => t.name === name)))
      throw new Error('A selected tool is not available on this server.');
    const result = await mutate('services:connectIntegration', {
      ...identity,
      provider: body.provider,
      name: body.name,
      account: body.name,
      serverUrl,
      tools: tools.map((t) => t.name),
      allowedTools: body.allowedTools,
      resourceScope: body.resourceScope,
      inboxMode: 'on-demand',
      credentialCiphertext: seal(credential),
      credentialKeyVersion: '1',
    });
    return NextResponse.json(result);
  } catch (error) {
    return failure(error);
  }
}
