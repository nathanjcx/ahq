'use client';

import { useMutation } from 'convex/react';
import { asId, uiApi } from '@/lib/ui-api';

/** Where a confirmed outcome went: a task that started, or a meeting that was booked. */
export type OutcomeResult = { taskId?: string; entryId?: string };

/** Boardroom mutations: the meeting's lifecycle, its questions, and its outcomes. */
export type MeetingsActions = {
  /** Creates the meeting and its per-attendee preparation on first use. */
  ensureMeeting: (calendarEntryId: string) => Promise<{ meetingId: string } | undefined>;
  openMeeting: (meetingId: string) => Promise<unknown>;
  /** Addressed to named attendees, or to everyone when none are named. */
  askMeeting: (meetingId: string, text: string, addressedTo?: string[]) => Promise<unknown>;
  closeMeeting: (meetingId: string) => Promise<unknown>;
  finalizeMeeting: (meetingId: string) => Promise<{ closed: boolean } | undefined>;
  confirmOutcome: (turnId: string) => Promise<OutcomeResult>;
  dismissOutcome: (turnId: string) => Promise<unknown>;
};

const unavailable = async () => undefined;
const noOutcome = async (): Promise<OutcomeResult> => ({});

export const offlineMeetingsActions: MeetingsActions = {
  ensureMeeting: unavailable,
  openMeeting: unavailable,
  askMeeting: unavailable,
  closeMeeting: unavailable,
  finalizeMeeting: unavailable,
  confirmOutcome: noOutcome,
  dismissOutcome: unavailable,
};

export function useMeetingsActions(): MeetingsActions {
  const ensure = useMutation(uiApi.ensureMeeting);
  const open = useMutation(uiApi.openMeeting);
  const ask = useMutation(uiApi.askMeeting);
  const close = useMutation(uiApi.closeMeeting);
  const finalize = useMutation(uiApi.finalizeMeeting);
  const confirmOutcome = useMutation(uiApi.confirmOutcome);
  const dismissOutcome = useMutation(uiApi.dismissOutcome);

  return {
    ensureMeeting: (calendarEntryId) => ensure({ calendarEntryId: asId(calendarEntryId) }),
    openMeeting: (meetingId) => open({ meetingId: asId(meetingId) }),
    askMeeting: (meetingId, text, addressedTo) =>
      ask({
        meetingId: asId(meetingId),
        text,
        addressedTo: addressedTo?.length ? addressedTo.map((id) => asId<'installations'>(id)) : undefined,
      }),
    closeMeeting: (meetingId) => close({ meetingId: asId(meetingId) }),
    finalizeMeeting: (meetingId) => finalize({ meetingId: asId(meetingId) }),
    confirmOutcome: (turnId) => confirmOutcome({ turnId: asId(turnId) }),
    dismissOutcome: (turnId) => dismissOutcome({ turnId: asId(turnId) }),
  };
}
