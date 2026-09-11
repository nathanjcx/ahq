import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { safeError } from './secrets';
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function actor(request?: Request) {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || !process.env.CLERK_SECRET_KEY)
    throw new HttpError(503, 'Sign-in has not been configured yet.');
  if (request && request.method !== 'GET') {
    const origin = request.headers.get('origin');
    const expected = new URL(process.env.APP_URL || request.url).origin;
    if (!origin || origin !== expected)
      throw new HttpError(403, 'Request origin does not match this application.');
  }
  const identity = await auth();
  if (!identity.userId) throw new HttpError(401, 'Sign in to continue.');
  return { authSubject: identity.userId, ...(identity.orgId ? { authOrgId: identity.orgId } : {}) };
}
export function failure(error: unknown) {
  const status = error instanceof HttpError ? error.status : 400;
  return NextResponse.json({ error: safeError(error) }, { status });
}
export async function rawBody(request: Request, max = 1_000_000) {
  const reader = request.body?.getReader();
  if (!reader) return '';
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw new HttpError(413, 'Request is too large.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf8');
}
export async function jsonBody(request: Request, max = 1_000_000) {
  return JSON.parse(await rawBody(request, max));
}
