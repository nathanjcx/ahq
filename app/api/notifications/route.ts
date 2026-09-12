import { type NotificationsResponse } from '@/lib/api/schemas';
import { query } from '@/lib/server/backend';
import { actor, failure, jsonOk } from '@/lib/server/http';

export const runtime = 'nodejs';

/** The signed-in person's notifications, for the browser and for a service worker. */
export async function GET() {
  try {
    const identity = await actor();
    const rows = await query<NotificationsResponse>('services/notifications:listForSubject', {
      subject: identity.authSubject,
    });
    return jsonOk(rows satisfies NotificationsResponse);
  } catch (error) {
    return failure(error);
  }
}
