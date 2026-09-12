'use client';

import {
  ArrowUpRight,
  BellRing,
  Check,
  CircleSlash,
  Hammer,
  Inbox,
  MessageSquareText,
  Play,
  ShieldAlert,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { PostText } from '../shared/channel-feed';
import { relativeTime, shortDate, shortTime } from '../shared/time';
import { useUiQuery } from '../shared/use-ui-query';
import { alertStage, pagingSentence } from './triage-labels';
import type { Alert, Floor, TriageEvent } from '@/lib/contracts';
import { asId, uiApi } from '@/lib/ui-api';

const EVENT_ICON: Record<TriageEvent['kind'], ReactNode> = {
  intake: <Inbox size={13} />,
  run: <Play size={13} />,
  tool: <Hammer size={13} />,
  page: <BellRing size={13} />,
  post: <MessageSquareText size={13} />,
};

export function AlertDetail({
  alert,
  floors,
  canAct,
  onAcknowledge,
  onResolve,
  onDismiss,
  onAssignFloors,
  onTask,
}: {
  alert: Alert;
  floors: Floor[];
  canAct: boolean;
  onAcknowledge: () => void;
  onResolve: () => void;
  onDismiss: () => void;
  onAssignFloors: (floorIds: string[]) => void;
  onTask: (taskId: string) => void;
}) {
  const events = useUiQuery(uiApi.alertTimeline, { alertId: asId<'alerts'>(alert.id) });
  const stage = alertStage(alert);
  const paging = pagingSentence(alert.paging);
  const settled = alert.status === 'closed' || alert.status === 'dismissed';

  return (
    <article className="alert-detail">
      <header>
        <span className="severity-pill" data-severity={alert.severity}>
          {alert.severity}
        </span>
        <span className="alert-stage" data-stage={stage.id}>
          {stage.label}
        </span>
        <small>
          {alert.source} · {relativeTime(alert.createdAt)}
        </small>
      </header>
      <h2>{alert.title}</h2>
      <p className="alert-fingerprint">
        {alert.fingerprint}
        {alert.occurrences > 1 && ` · ${alert.occurrences} deliveries`}
      </p>

      {paging && (
        <p className="alert-paging" data-open={alert.paging.attempts >= alert.paging.required}>
          <ShieldAlert size={15} />
          {paging}
        </p>
      )}

      <div className="alert-actions">
        <button
          className="primary-button compact"
          disabled={!canAct || alert.paging.acknowledged || !alert.paging.attempts}
          onClick={onAcknowledge}
        >
          <Check size={14} /> Acknowledge
        </button>
        <button className="secondary-button compact" disabled={!canAct || settled} onClick={onResolve}>
          Resolve
        </button>
        <button className="secondary-button compact" disabled={!canAct || settled} onClick={onDismiss}>
          <CircleSlash size={14} /> Dismiss
        </button>
        {alert.url && (
          <a className="text-button" href={alert.url} target="_blank" rel="noreferrer">
            Open the source <ArrowUpRight size={13} />
          </a>
        )}
      </div>

      <PostText text={alert.detail} />

      <fieldset className="alert-floors" disabled={!canAct}>
        <legend>Affected floors</legend>
        {floors.length === 0 ? (
          <p className="muted-note">This workspace has no floors yet.</p>
        ) : (
          floors.map((floor) => {
            const affected = alert.affectedFloorIds.includes(floor.id);
            return (
              <label key={floor.id}>
                <input
                  type="checkbox"
                  checked={affected}
                  onChange={() =>
                    onAssignFloors(
                      affected
                        ? alert.affectedFloorIds.filter((id) => id !== floor.id)
                        : [...alert.affectedFloorIds, floor.id],
                    )
                  }
                />
                {floor.name}
              </label>
            );
          })
        )}
      </fieldset>

      <h3 className="alert-timeline-title">Timeline</h3>
      {events === undefined ? (
        <p className="muted-note">Loading the timeline…</p>
      ) : (
        <ol className="alert-timeline">
          {events.map((event) => (
            <li key={event.id} data-kind={event.kind} data-authority={event.authority}>
              <span className="timeline-mark">{EVENT_ICON[event.kind]}</span>
              <div>
                <strong>{event.title}</strong>
                {event.authority === 'emergency' && <span className="emergency-pill">Emergency</span>}
                {event.outcome && <span className="timeline-outcome">{event.outcome}</span>}
                {event.detail && <p>{event.detail}</p>}
                {event.kind === 'run' && event.taskId && (
                  <button className="text-button" onClick={() => onTask(event.taskId ?? '')}>
                    Open the run <ArrowUpRight size={13} />
                  </button>
                )}
              </div>
              <small title={shortDate(event.at)}>{shortTime(event.at)}</small>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}
