import { mutate } from '../../../lib/server/backend';
import { deliverNotifications, type NotificationAttempt } from '../../../lib/server/notify';
import type { Job } from '../../types';
import type { WorkerRuntime } from '../state';
import { payload } from './context';

/**
 * One page: for an incident, or for the job's own task while it waits on a person. Not a turn: no
 * model runs here.
 *
 * The scheduler decides when a page is due and Convex writes the attempt; this job exists because
 * delivery needs the transports, which only a Node process has. An attempt counts towards the
 * emergency rule only once a channel reports delivery, so what opens the emergency allow-list is
 * what this actually managed to send rather than what the ledger meant to.
 */
export async function pageAlert(_runtime: WorkerRuntime, job: Job) {
  const { alertId } = payload(job);
  const attempts = alertId
    ? await mutate<NotificationAttempt[]>('services/triage:pageAlert', { alertId })
    : await mutate<NotificationAttempt[]>('services/sessions:pageTask', { taskId: job.taskId });
  return deliverNotifications(attempts);
}
