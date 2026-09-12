import { api } from '@/convex/_generated/api';

/** Convex references for the triage domain, under the names the interface uses. */
export const triageApi = {
  alerts: api.triage.alerts,
  alertTimeline: api.triage.timeline,
  acknowledgeAlert: api.triage.acknowledgeAlert,
  assignAlertFloors: api.triage.assignFloors,
  dismissAlert: api.triage.dismiss,
  closeAlert: api.triage.close,
  incidentReports: api.triage.incidentReports,
  triageIntake: api.triage.intake,
  triageRules: api.triage.rules,
  setTriageRules: api.triage.setRules,
  ensureTriageFloor: api.triage.ensureTriageFloor,
  notifications: api.notifications.list,
  acknowledgeNotification: api.notifications.acknowledge,
  acknowledgeNotifications: api.triage.acknowledgeNotifications,
} as const;
