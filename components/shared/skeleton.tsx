/**
 * Placeholder rows shaped like the content that is loading. Every stream that waits on a
 * subscription or a fetch shows these instead of a spinner in an empty box.
 */

export type SkeletonKind = 'message' | 'post' | 'entry' | 'member';

const WIDTHS: Record<SkeletonKind, string[][]> = {
  message: [['38%'], ['100%', '92%', '64%']],
  post: [
    ['30%', '18%'],
    ['100%', '78%'],
  ],
  entry: [
    ['26%', '15%'],
    ['100%', '55%'],
  ],
  member: [['44%'], ['62%']],
};

export function SkeletonList({
  kind,
  rows = 3,
  label = 'Loading',
}: {
  kind: SkeletonKind;
  rows?: number;
  label?: string;
}) {
  const [head, body] = WIDTHS[kind];
  return (
    <div className={`skeleton-list skeleton-${kind}`} role="status" aria-label={label} aria-busy="true">
      {Array.from({ length: rows }, (_, row) => (
        <div className="skeleton-row" key={row}>
          {(kind === 'message' || kind === 'member') && <span className="skeleton-mark" />}
          <div>
            <div className="skeleton-head">
              {head.map((width, index) => (
                <span key={index} className="skeleton-bar" style={{ width }} />
              ))}
            </div>
            {body.map((width, index) => (
              <span key={index} className="skeleton-bar" style={{ width }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
