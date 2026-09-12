/**
 * A fixed-window counter held in process memory. It is per instance, not per cluster: with several
 * web instances behind a load balancer the effective limit is the configured rate times the number
 * of instances. That is enough for the two things it guards — revealing a relay secret and webhook
 * floods — where the point is to blunt a burst, not to meter usage exactly.
 */
const windows = new Map<string, { count: number; expiresAt: number }>();

const MAX_KEYS = 10_000;

/**
 * Keys come from callers who have not authenticated yet — a header, a path segment, a forwarded
 * address — so neither map below may grow with them. Expired entries go first; a burst of distinct
 * keys inside one window then evicts the oldest live ones, insertion order being iteration order.
 * Evicting a live entry resets that key's count, which is the right trade: a caller flooding
 * distinct keys spends memory rather than taking the process down.
 */
function bound(map: Map<string, { expiresAt: number }>, now: number) {
  for (const [key, entry] of map) if (entry.expiresAt <= now) map.delete(key);
  for (const key of map.keys()) {
    if (map.size < MAX_KEYS) break;
    map.delete(key);
  }
}

export function withinRateLimit(key: string, limit: number, windowMs = 60_000): boolean {
  const now = Date.now();
  const current = windows.get(key);
  if (!current || current.expiresAt <= now) {
    if (windows.size >= MAX_KEYS) bound(windows, now);
    windows.set(key, { count: 1, expiresAt: now + windowMs });
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}

/**
 * What one signed request already produced.
 *
 * A signature stays valid for the whole of its acceptance window, so the same signed body can be
 * sent again inside it. Answering the first result instead of repeating the work makes that replay
 * inert: it cannot open a second alert for an incident somebody has since closed.
 */
const replies = new Map<string, { value: string; expiresAt: number }>();

export function recallReply(key: string): string | undefined {
  const entry = replies.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    replies.delete(key);
    return undefined;
  }
  return entry.value;
}

export function rememberReply(key: string, value: string, ttlMs: number) {
  const now = Date.now();
  if (replies.size >= MAX_KEYS) bound(replies, now);
  replies.set(key, { value, expiresAt: now + ttlMs });
}

/** Test seam: the counters are module state, so a test that exercises a limit can start clean. */
export function resetRateLimits() {
  windows.clear();
  replies.clear();
}
