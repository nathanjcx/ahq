/**
 * A fixed-window counter held in process memory. It is per instance, not per cluster: with several
 * web instances behind a load balancer the effective limit is the configured rate times the number
 * of instances. That is enough for the two things it guards — revealing a relay secret and webhook
 * floods — where the point is to blunt a burst, not to meter usage exactly.
 */
const windows = new Map<string, { count: number; resetAt: number }>();

export function withinRateLimit(key: string, limit: number, windowMs = 60_000): boolean {
  const now = Date.now();
  const current = windows.get(key);
  if (!current || current.resetAt <= now) {
    if (windows.size > 10_000) for (const [k, v] of windows) if (v.resetAt <= now) windows.delete(k);
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}

/** Test seam: the counters are module state, so a test that exercises a limit can start clean. */
export function resetRateLimits() {
  windows.clear();
}
