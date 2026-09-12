'use client';

import { Activity, LockKeyhole } from 'lucide-react';
import type { ActivityEvent } from '@/lib/contracts';
import { EmptyPane } from '../shared/empty';
import { relativeTime } from '../shared/format';
import { PageIntro } from '../shared/page-intro';

export function ActivityPage({ events }: { events: ActivityEvent[] }) {
  return (
    <div>
      <PageIntro
        eyebrow="HISTORY"
        title="Activity"
        description="A read-only account of work, reviews, and actions across your workspace."
      />
      <div className="activity-card card">
        <div className="activity-notice">
          <LockKeyhole size={15} />
          <span>Replay shows recorded history. It never reruns a model or repeats an external action.</span>
        </div>
        {events.length ? (
          <ol className="activity-list">
            {events.map((event) => (
              <li key={event.id}>
                <span className="timeline-mark">
                  <i />
                </span>
                <div>
                  <span className="eyebrow">{event.type.replaceAll('_', ' ')}</span>
                  <h3>{event.text}</h3>
                  <p>
                    {event.employeeName ? `${event.employeeName} · ` : ''}
                    {relativeTime(event.createdAt)}
                  </p>
                  {event.gap && <span className="event-gap">Some intermediate events were unavailable</span>}
                </div>
                <span className="sequence">#{event.sequence}</span>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyPane
            icon={<Activity size={25} />}
            title="History starts with real work"
            text="Task events and reviewed external actions will appear here after the backend is connected."
          />
        )}
      </div>
    </div>
  );
}
