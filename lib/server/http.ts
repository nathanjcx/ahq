import { auth, clerkClient } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import type { z } from 'zod';
import { REQUESTED_WITH } from '../api/routes';
import { safeError } from './secrets';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

/** Authenticated responses are never cached, by a proxy or by the browser. */
const privateHeaders = { 'Cache-Control': 'no-store' };

export function jsonOk<T>(body: T, headers?: Record<string, string>) {
  return NextResponse.json(body, { headers: { ...privateHeaders, ...headers } });
}

/** The one error envelope every route answers with. */
export function jsonError(status: number, error: string, code?: string) {
  return NextResponse.json(code ? { error, code } : { error }, { status, headers: privateHeaders });
}

export function failure(error: unknown) {
  return error instanceof HttpError
    ? jsonError(error.status, error.message, error.code)
    : jsonError(400, safeError(error));
}

/**
 * The signed-in caller. A state-changing request must also prove it came from this application's own
 * code: the Origin has to match, and a cross-site form post cannot set `x-requested-with` at all.
 */
export async function actor(request?: Request) {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || !process.env.CLERK_SECRET_KEY)
    throw new HttpError(503, 'Sign-in has not been configured yet.', 'not_configured');
  if (request && request.method !== 'GET') {
    const origin = request.headers.get('origin');
    const expected = new URL(process.env.APP_URL || request.url).origin;
    if (!origin || origin !== expected || request.headers.get(REQUESTED_WITH.header) !== REQUESTED_WITH.value)
      throw new HttpError(403, 'Request origin does not match this application.', 'bad_origin');
  }
  const identity = await auth();
  if (!identity.userId) throw new HttpError(401, 'Sign in to continue.', 'unauthenticated');
  return { authSubject: identity.userId, ...(identity.orgId ? { authOrgId: identity.orgId } : {}) };
}

/** Platform administrators are trusted by bootstrap environment, the same list Convex reads. */
export function isPlatformAdmin(subject: string) {
  return (process.env.PLATFORM_ADMIN_USER_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .includes(subject);
}

export async function platformAdmin(request?: Request) {
  const identity = await actor(request);
  if (!isPlatformAdmin(identity.authSubject))
    throw new HttpError(403, 'Platform administrator access required.', 'forbidden');
  return identity;
}

export async function displayName(subject: string) {
  const user = await (await clerkClient()).users.getUser(subject);
  return user.fullName || user.primaryEmailAddress?.emailAddress || 'Member';
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
        throw new HttpError(413, 'Request is too large.', 'too_large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Reads and validates a JSON body against the route's shared schema. */
export async function parseBody<T>(request: Request, schema: z.ZodType<T>, max = 1_000_000): Promise<T> {
  const text = await rawBody(request, max);
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'The request body is not valid JSON.', 'invalid_request');
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new HttpError(400, 'The request body is not valid.', 'invalid_request');
  return parsed.data;
}
