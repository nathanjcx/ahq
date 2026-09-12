import type { TokenUsage } from '@/lib/contracts';

/** One total from several turns, for a question priced with the answers it drew. */
export function totalUsage(parts: (TokenUsage | undefined)[]): TokenUsage | undefined {
  const known = parts.filter((part): part is TokenUsage => part !== undefined);
  if (!known.length) return undefined;
  return known.reduce(
    (total, part) => ({
      input: total.input + part.input,
      cached: total.cached + part.cached,
      output: total.output + part.output,
    }),
    { input: 0, cached: 0, output: 0 },
  );
}
