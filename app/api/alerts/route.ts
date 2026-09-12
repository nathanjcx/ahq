import { createHmac } from 'node:crypto';
import { alertRequest, type AlertResponse } from '@/lib/api/schemas';
import { mutate, query } from '@/lib/server/backend';
import { failure, HttpError, jsonOk, rawBody } from '@/lib/server/http';
import { deliverNotifications, type NotificationAttempt } from '@/lib/server/notify';
import { recallReply, rememberReply, withinRateLimit } from '@/lib/server/rate-limit';
import { equalSecret, unseal } from '@/lib/server/secrets';

export const runtime = 'nodejs';

const WORKSPACE_HEADER = 'x-astra-workspace';
const TIMESTAMP_HEADER = 'x-astra-timestamp';
const SIGNATURE_HEADER = 'x-astra-signature';
const MAX_AGE_MS = 300_000;
/** Severities that page a person the moment the alert opens. */
const PAGING_SEVERITIES = ['high', 'critical'];

/**
 * Who is asking, before anything has proved who it is. The workspace id is on screen in the app, so
 * metering unsigned requests by it lets anyone spend a workspace's whole allowance on garbage. The
 * first forwarded hop is the closest thing to the sender; with no proxy in front, unsigned traffic
 * is metered as one caller.
 */
function senderKey(request: Request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

/**
 * The signature covers the timestamp and the exact body, so a replayed body with a fresh timestamp
 * does not verify and a stale one is refused outright.
 */
function verify(secret: string, timestamp: string, body: string, signature: string) {
  if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > MAX_AGE_MS)
    throw new HttpError(401, 'The alert timestamp is stale.', 'unauthorized');
  if (!signature || !/^[0-9a-f]{64}$/i.test(signature))
    throw new HttpError(401, 'The alert signature is invalid.', 'unauthorized');
  const expected = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  if (!equalSecret(signature.toLowerCase(), expected))
    throw new HttpError(401, 'The alert signature is invalid.', 'unauthorized');
}

/** Generic signed alert intake: uptime probes, error trackers, and cloud health notices. */
export async function POST(request: Request) {
  try {
    const workspaceId = request.headers.get(WORKSPACE_HEADER);
    if (!workspaceId) throw new HttpError(400, 'The workspace header is required.', 'invalid_request');
    if (!withinRateLimit(`alert-senders:${senderKey(request)}`, 600))
      throw new HttpError(429, 'Too many alert requests.', 'rate_limited');
    const ciphertext = await query<string | null>('services/triage:alertSecret', { workspaceId });
    if (!ciphertext) throw new HttpError(404, 'Alert intake is not configured.', 'not_configured');
    const body = await rawBody(request, 100_000);
    const signature = request.headers.get(SIGNATURE_HEADER) ?? '';
    verify(unseal<string>(ciphertext), request.headers.get(TIMESTAMP_HEADER) ?? '', body, signature);
    if (!withinRateLimit(`alerts:${workspaceId}`, 120))
      throw new HttpError(429, 'Too many alerts for this workspace.', 'rate_limited');
    const replayKey = `alert:${workspaceId}:${signature.toLowerCase()}`;
    const replayed = recallReply(replayKey);
    if (replayed)
      return jsonOk({ accepted: true, alertId: replayed, duplicate: true } satisfies AlertResponse);

    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      throw new HttpError(400, 'The request body is not valid JSON.', 'invalid_request');
    }
    const parsed = alertRequest.safeParse(payload);
    if (!parsed.success) throw new HttpError(400, 'The request body is not valid.', 'invalid_request');
    const { floorIds, ...alert } = parsed.data;
    const result = await mutate<{ alertId: string; created: boolean }>('services/triage:ingest', {
      workspaceId,
      ...alert,
      affectedFloorIds: floorIds,
    });
    rememberReply(replayKey, result.alertId, MAX_AGE_MS);
    if (result.created && PAGING_SEVERITIES.includes(alert.severity)) {
      const attempts = await mutate<NotificationAttempt[]>('services/notifications:attempt', {
        workspaceId,
        kind: 'triage',
        title: alert.title,
        text: alert.detail,
        alertId: result.alertId,
      });
      await deliverNotifications(attempts);
    }
    return jsonOk({
      accepted: true,
      alertId: result.alertId,
      duplicate: !result.created,
    } satisfies AlertResponse);
  } catch (error) {
    return failure(error);
  }
}
