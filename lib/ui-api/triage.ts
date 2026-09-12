import { api } from '@/convex/_generated/api';

/** Convex references for the triage domain, under the names the interface uses. */
export const triageApi = {
  alerts: api.triage.alerts,
  dismissAlert: api.triage.dismiss,
  closeAlert: api.triage.close,
  triageRules: api.triage.rules,
  setTriageRules: api.triage.setRules,
  ensureTriageFloor: api.triage.ensureTriageFloor,
  notifications: api.notifications.list,
  acknowledgeNotification: api.notifications.acknowledge,
} as const;
