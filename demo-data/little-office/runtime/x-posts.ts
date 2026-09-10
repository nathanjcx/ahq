import { AI_NEWS_ACCOUNTS, type NewsCollection } from '../src/shared/news';

export interface XPost { account: string; url: string; publishedAt: string; text: string }
export interface XCollection { posts: XPost[]; coverage: NewsCollection['coverage'] }

// Read public SSR records as data. Never execute the scripts supplied by a page.
export function parseXProfile(html: string, account: string): XPost[] {
  const headers = [...html.matchAll(/__id:("(?:\\.|[^"\\])*"),__typename:"([A-Za-z0-9_]+)"/g)];
  const records = new Map<string, { type: string; body: string }>();
  for (let index = 0; index < headers.length; index++) {
    const match = headers[index];
    records.set(JSON.parse(match[1]), { type: match[2], body: html.slice(match.index, headers[index + 1]?.index ?? html.length) });
  }
  const field = (body: string | undefined, key: string): string | undefined => {
    const match = body?.match(new RegExp(`\\b${key}:("(?:\\\\.|[^"\\\\])*")`));
    return match ? JSON.parse(match[1]) : undefined;
  };
  const posts = new Map<string, XPost>();
  for (const [key, record] of records) {
    if (record.type !== 'TBirdData' || !key.endsWith(':details')) continue;
    const tweet = key.slice('client:'.length, -':details'.length);
    const id = field(records.get(tweet)?.body, 'rest_id');
    const userResult = field(records.get(`client:${tweet}:core`)?.body, '__ref');
    const user = userResult && field(records.get(userResult)?.body, '__ref');
    const handle = user && field(records.get(`client:${user}:core`)?.body, 'screen_name');
    const text = field(record.body, 'full_text');
    const timestamp = Number(record.body.match(/\bcreated_at_ms:(\d+)/)?.[1]);
    if (!id || !/^\d{15,20}$/.test(id) || !handle || handle.toLowerCase() !== account.toLowerCase() || !text || !Number.isFinite(timestamp)) continue;
    const idTime = Number((BigInt(id) >> 22n) + 1288834974657n);
    if (Math.abs(idTime - timestamp) > 60_000) continue;
    posts.set(id, { account, url: `https://x.com/${account}/status/${id}`, publishedAt: new Date(timestamp).toISOString(), text });
  }
  return [...posts.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

export async function collectXPosts(window: { since: string; until: string }, signal?: AbortSignal): Promise<XCollection> {
  const results = [];
  // Small batches keep the public source requests bounded.
  for (let start = 0; start < AI_NEWS_ACCOUNTS.length; start += 3) {
    signal?.throwIfAborted();
    results.push(...await Promise.all(AI_NEWS_ACCOUNTS.slice(start, start + 3).map(async account => {
      try {
        const response = await fetch(`https://x.com/${account}`, { signal: AbortSignal.any([AbortSignal.timeout(15_000), ...(signal ? [signal] : [])]) });
        if (!response.ok) throw new Error(`Public profile returned HTTP ${response.status}`);
        const posts = parseXProfile(await response.text(), account);
        if (!posts.length) throw new Error('Public profile contained no readable authored posts');
        const current = posts.filter(post => post.publishedAt > window.since && post.publishedAt <= window.until);
        return { posts: current, coverage: { account, status: 'partial' as const, note: `Read ${posts.length} authored posts directly from the public profile; ${current.length} are in this window. The public page is a limited timeline, so full coverage is not established.` } };
      } catch (error) {
        signal?.throwIfAborted();
        return { posts: [], coverage: { account, status: 'unavailable' as const, note: error instanceof Error ? error.message : 'Public profile could not be read' } };
      }
    })));
  }
  return { posts: results.flatMap(result => result.posts), coverage: results.map(result => result.coverage) };
}
