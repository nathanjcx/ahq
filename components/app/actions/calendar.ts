'use client';

import { useMutation } from 'convex/react';
import type { Attendee } from '@/lib/contracts';
import { asId, uiApi } from '@/lib/ui-api';

/** Everything a person chooses when booking a meeting, and everything rescheduling may change. */
export type MeetingDraft = {
  title: string;
  startsAt: number;
  endsAt: number;
  projectId?: string;
  floorId?: string;
  attendees: Attendee[];
  agenda: string[];
  purpose?: string;
};

/** Calendar mutations. Meetings are the only entries a person creates; the rest are derived. */
export type CalendarActions = {
  scheduleMeeting: (draft: MeetingDraft) => Promise<{ entryId: string } | undefined>;
  rescheduleMeeting: (entryId: string, draft: MeetingDraft) => Promise<unknown>;
  cancelMeeting: (entryId: string) => Promise<unknown>;
};

const unavailable = async () => undefined;

export const offlineCalendarActions: CalendarActions = {
  scheduleMeeting: unavailable,
  rescheduleMeeting: unavailable,
  cancelMeeting: unavailable,
};

/** The draft as Convex takes it: ids converted, blank purpose dropped. */
function meetingArgs(draft: MeetingDraft) {
  return {
    title: draft.title,
    startsAt: draft.startsAt,
    endsAt: draft.endsAt,
    projectId: draft.projectId ? asId<'projects'>(draft.projectId) : undefined,
    floorId: draft.floorId ? asId<'floors'>(draft.floorId) : undefined,
    attendees: draft.attendees,
    agenda: draft.agenda,
    purpose: draft.purpose?.trim() ? draft.purpose : undefined,
  };
}

export function useCalendarActions(): CalendarActions {
  const createMeeting = useMutation(uiApi.createMeeting);
  const updateMeeting = useMutation(uiApi.updateMeeting);
  const cancelMeeting = useMutation(uiApi.cancelMeeting);

  return {
    scheduleMeeting: (draft) => createMeeting(meetingArgs(draft)),
    rescheduleMeeting: (entryId, draft) =>
      updateMeeting({ entryId: asId(entryId), ...meetingArgs(draft) }),
    cancelMeeting: (entryId) => cancelMeeting({ entryId: asId(entryId) }),
  };
}
