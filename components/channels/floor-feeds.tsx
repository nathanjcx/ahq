'use client';

import { Rss } from 'lucide-react';
import { useState } from 'react';
import { PostView } from '../shared/channel-feed';
import { EmptyPane } from '../shared/empty';
import { SkeletonList } from '../shared/skeleton';
import { useUiQuery } from '../shared/use-ui-query';
import type { Employee } from '@/lib/contracts';
import { asId, uiApi } from '@/lib/ui-api';
import './channels.css';

/**
 * Every instance on a floor has a feed of everything it posted anywhere in the workspace. This is
 * the floor's index of them: pick an instance on the left, read its own trail on the right.
 */
export function FloorFeeds({ staff, onTask }: { staff: Employee[]; onTask: (taskId: string) => void }) {
  const [selectedId, setSelected] = useState(staff[0]?.id ?? null);
  const selected = staff.find((employee) => employee.id === selectedId) ?? staff[0] ?? null;

  if (!selected)
    return (
      <EmptyPane
        icon={<Rss size={19} />}
        title="No one is staffed here"
        text="Every instance on this floor keeps a feed of everything it posted. Add someone to the floor to see one."
      />
    );

  return (
    <div className="floor-feeds">
      <div className="floor-feeds-list" role="tablist" aria-label="Instance feeds">
        {staff.map((employee) => (
          <button
            key={employee.id}
            role="tab"
            aria-selected={employee.id === selected.id}
            aria-pressed={employee.id === selected.id}
            onClick={() => setSelected(employee.id)}
          >
            <strong>{employee.name}</strong>
            <small>{employee.role}</small>
          </button>
        ))}
      </div>
      <EmployeeFeed key={selected.id} employeeId={selected.id} name={selected.name} onTask={onTask} />
    </div>
  );
}

function EmployeeFeed({
  employeeId,
  name,
  onTask,
}: {
  employeeId: string;
  name: string;
  onTask: (taskId: string) => void;
}) {
  const posts = useUiQuery(uiApi.employeeFeed, { employeeId: asId<'installations'>(employeeId) });
  return (
    <div className="floor-feed-stream">
      {posts === undefined ? (
        <SkeletonList kind="post" rows={3} label={`Loading ${name}'s feed`} />
      ) : posts.length === 0 ? (
        <EmptyPane
          icon={<Rss size={19} />}
          title={`${name} has posted nothing yet`}
          text="Shift reports, findings, and notes appear here the moment this instance writes them."
        />
      ) : (
        posts.map((post) => <PostView key={post.id} post={post} onTask={onTask} />)
      )}
    </div>
  );
}
