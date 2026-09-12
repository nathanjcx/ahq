import type { Alert, AlertPaging } from '@/lib/contracts';

/**
 * What an alert's status means to a person on duty. The stored statuses describe the fix; a person
 * reads the incident, so an alert that has been answered but not yet worked reads as acknowledged.
 */
export function alertStage(alert: Alert): { id: string; label: string } {
  if (alert.status === 'closed') return { id: 'resolved', label: 'Resolved' };
  if (alert.status === 'dismissed') return { id: 'dismissed', label: 'Dismissed' };
  if (alert.status === 'fixed') return { id: 'fixed', label: 'Fix filed' };
  if (alert.status === 'triaging') return { id: 'progress', label: 'In progress' };
  return alert.paging.acknowledged
    ? { id: 'acknowledged', label: 'Acknowledged' }
    : { id: 'new', label: 'New' };
}

/** How long until triage may use the emergency allow-list, in whole minutes. */
function minutesLeft(paging: AlertPaging) {
  return paging.opensAt === undefined
    ? null
    : Math.max(0, Math.round((paging.opensAt - Date.now()) / 60_000));
}

/** The one line the incident strip and the alert detail both say about an unanswered incident. */
export function pagingSentence(paging: AlertPaging) {
  if (paging.acknowledged || !paging.attempts) return null;
  const left = minutesLeft(paging);
  const attempts = `${paging.attempts} of ${paging.required} attempts`;
  if (paging.attempts >= paging.required)
    return `${attempts}, none answered — Triage may fix production on its own.`;
  return left === null || left === 0
    ? `${attempts}, none answered.`
    : `${attempts}, ${left} minute${left === 1 ? '' : 's'} left.`;
}
