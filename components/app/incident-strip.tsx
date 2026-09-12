'use client';

import { Check, Siren } from 'lucide-react';
import { useUiQuery } from '../shared/use-ui-query';
import { pagingSentence } from '../triage/triage-labels';
import type { PageProps } from './page-props';
import { uiApi } from '@/lib/ui-api';

/**
 * One line above every page while an incident is open. It is loudest when triage is paging a person
 * and nobody has answered, because that is the window in which it may fix production on its own.
 */
export function IncidentStrip(props: Pick<PageProps, 'dashboard' | 'actions' | 'run' | 'go'>) {
  // Preview mode has no Convex client to subscribe through, and nothing to be on fire about.
  return props.dashboard.workspace ? <OpenIncident {...props} /> : null;
}

function OpenIncident({ actions, run, go }: Pick<PageProps, 'actions' | 'run' | 'go'>) {
  const alerts = useUiQuery(uiApi.alerts, { status: 'open' });
  const open = alerts?.filter((alert) => alert.status === 'open') ?? [];
  // The incident asking for an answer leads; otherwise the newest open one does.
  const alert = open.find((row) => row.paging.attempts && !row.paging.acknowledged) ?? open[0];
  if (!alert) return null;

  const paging = pagingSentence(alert.paging);
  const urgent = alert.paging.attempts >= alert.paging.required && !alert.paging.acknowledged;

  return (
    <aside className="incident-strip" data-urgent={urgent} aria-label="Open incident">
      <Siren size={16} />
      <p>
        <strong>{paging ? 'Triage needs you' : 'Triage is on an incident'}:</strong> {alert.title}
        {paging && <span> {paging}</span>}
        {open.length > 1 && <small>+{open.length - 1} more open</small>}
      </p>
      <button className="secondary-button compact" onClick={() => go('triage')}>
        Open
      </button>
      {paging && (
        <button
          className="primary-button compact"
          onClick={() => void run(() => actions.acknowledgeAlert(alert.id), 'Incident acknowledged')}
        >
          <Check size={14} /> Acknowledge
        </button>
      )}
    </aside>
  );
}
