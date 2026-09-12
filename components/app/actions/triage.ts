'use client';

import { useMutation } from 'convex/react';
import { asId, uiApi } from '@/lib/ui-api';

/** Everything a person can do about an incident, plus the notification ledger the pages land in. */
export type TriageActions = {
  acknowledgeAlert: (alertId: string) => Promise<unknown>;
  assignAlertFloors: (alertId: string, floorIds: string[]) => Promise<unknown>;
  dismissAlert: (alertId: string) => Promise<unknown>;
  closeAlert: (alertId: string) => Promise<unknown>;
  ensureTriageFloor: () => Promise<{ floorId: string } | undefined>;
  acknowledgeNotification: (id: string) => Promise<unknown>;
  acknowledgeNotifications: () => Promise<unknown>;
};

const unavailable = async () => undefined;

export const offlineTriageActions: TriageActions = {
  acknowledgeAlert: unavailable,
  assignAlertFloors: unavailable,
  dismissAlert: unavailable,
  closeAlert: unavailable,
  ensureTriageFloor: unavailable,
  acknowledgeNotification: unavailable,
  acknowledgeNotifications: unavailable,
};

export function useTriageActions(): TriageActions {
  const acknowledgeAlert = useMutation(uiApi.acknowledgeAlert);
  const assignAlertFloors = useMutation(uiApi.assignAlertFloors);
  const dismissAlert = useMutation(uiApi.dismissAlert);
  const closeAlert = useMutation(uiApi.closeAlert);
  const ensureTriageFloor = useMutation(uiApi.ensureTriageFloor);
  const acknowledgeNotification = useMutation(uiApi.acknowledgeNotification);
  const acknowledgeNotifications = useMutation(uiApi.acknowledgeNotifications);

  return {
    acknowledgeAlert: (alertId) => acknowledgeAlert({ alertId: asId(alertId) }),
    assignAlertFloors: (alertId, floorIds) =>
      assignAlertFloors({ alertId: asId(alertId), floorIds: floorIds.map((id) => asId<'floors'>(id)) }),
    dismissAlert: (alertId) => dismissAlert({ alertId: asId(alertId) }),
    closeAlert: (alertId) => closeAlert({ alertId: asId(alertId) }),
    ensureTriageFloor: () => ensureTriageFloor({}),
    acknowledgeNotification: (id) => acknowledgeNotification({ id: asId(id) }),
    acknowledgeNotifications: () => acknowledgeNotifications({}),
  };
}
