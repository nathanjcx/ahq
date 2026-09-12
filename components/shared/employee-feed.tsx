'use client';

import { MessagesSquare } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { PostStream } from './channel-feed';
import { EmptyPane } from './empty';
import { SkeletonList } from './skeleton';
import { useUiQuery } from './use-ui-query';
import { asId, uiApi } from '@/lib/ui-api';

/**
 * Everything one instance has posted, wherever it posted it. A channel is a place; this is a person,
 * so it reads across every channel the instance writes to and has no composer — nobody posts into
 * somebody else's record of their own work.
 */
export function EmployeeFeed({
  employeeId,
  compact = false,
  onTask,
}: {
  employeeId: string;
  compact?: boolean;
  onTask?: (taskId: string) => void;
}) {
  const posts = useUiQuery(uiApi.employeeFeed, { employeeId: asId<'installations'>(employeeId) });
  const streamRef = useRef<HTMLDivElement>(null);
  const newestId = posts?.[posts.length - 1]?.id;

  useEffect(() => {
    const stream = streamRef.current;
    if (stream) stream.scrollTop = stream.scrollHeight;
  }, [newestId]);

  return (
    <div className="channel-feed" data-compact={compact}>
      <div className="channel-stream" ref={streamRef}>
        {posts === undefined ? (
          <SkeletonList kind="post" rows={3} label="Loading the feed" />
        ) : posts.length === 0 ? (
          <EmptyPane
            icon={<MessagesSquare size={19} />}
            title="Nothing posted yet"
            text="Shift reports, findings, and decisions this instance writes will appear here."
          />
        ) : (
          <PostStream posts={posts} compact={compact} onTask={onTask} />
        )}
      </div>
    </div>
  );
}
