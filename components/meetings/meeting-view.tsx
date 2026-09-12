'use client';

import { ChevronLeft, DoorClosed, DoorOpen, SendHorizontal } from 'lucide-react';
import { useState } from 'react';
import type { MeetingsActions, OutcomeResult } from '../app/actions/meetings';
import { shortDate, shortTime } from '../shared/time';
import { useUiQuery } from '../shared/use-ui-query';
import { OutcomeCard } from './outcome-card';
import { PrepReports, Transcript } from './transcript';
import { usageLine } from './usage';
import type { CalendarEntry, Meeting, MeetingStatus } from '@/lib/contracts';
import { asId, uiApi } from '@/lib/ui-api';
import './meetings.css';

const STATE_LABEL: Record<MeetingStatus, string> = {
  preparing: 'Preparing',
  ready: 'Ready',
  live: 'In session',
  closing: 'Wrapping up',
  closed: 'Closed',
};

/**
 * The boardroom. Text only: who is in the room, what they prepared, what was asked and answered,
 * what it cost, and the outcomes a person confirms before any of them becomes work.
 */
export function MeetingView({
  entry,
  actions,
  run,
  onBack,
  onReschedule,
  onOpenTask,
  onOpenMeeting,
}: {
  entry: CalendarEntry;
  actions: MeetingsActions;
  run: (work: () => Promise<unknown>, success: string) => Promise<boolean>;
  onBack: () => void;
  /** The calendar owns booking, so rescheduling this meeting goes back to it. */
  onReschedule?: () => void;
  onOpenTask: (taskId: string) => void;
  onOpenMeeting: (entryId: string) => void;
}) {
  const meeting: Meeting | null | undefined = useUiQuery(uiApi.meeting, {
    calendarEntryId: asId<'calendarEntries'>(entry.id),
  });
  const [question, setQuestion] = useState('');
  const [addressee, setAddressee] = useState('');
  const [results, setResults] = useState<Record<string, OutcomeResult>>({});

  const attendees = entry.attendees.filter((attendee) => attendee.kind === 'employee');
  const turns = meeting?.turns ?? [];
  const status = meeting?.status;
  const live = status === 'live';

  const openRoom = () =>
    run(async () => {
      const meetingId = meeting?.id ?? (await actions.ensureMeeting(entry.id))?.meetingId;
      if (meetingId) await actions.openMeeting(meetingId);
    }, 'The boardroom is open.');

  const ask = () => {
    const text = question.trim();
    if (!text || !meeting) return;
    setQuestion('');
    void run(
      () => actions.askMeeting(meeting.id, text, addressee ? [addressee] : undefined),
      addressee ? 'Put to that attendee.' : 'Put to the room.',
    );
  };

  const confirm = (turnId: string) =>
    run(async () => {
      const result = await actions.confirmOutcome(turnId);
      setResults((current) => ({ ...current, [turnId]: result }));
    }, 'Confirmed.');

  return (
    <div className="meeting-view card">
      <header className="meeting-head">
        <button className="text-button" onClick={onBack}>
          <ChevronLeft size={15} />
          Calendar
        </button>
        <div>
          <span className="eyebrow">
            {shortDate(entry.startsAt)} · {shortTime(entry.startsAt)} – {shortTime(entry.endsAt)}
          </span>
          <h2>{entry.title}</h2>
          <p className="meeting-attendees">
            {attendees.length
              ? attendees.map((attendee) => attendee.name).join(', ')
              : 'Nobody from the building is attending.'}
          </p>
        </div>
        <div className="meeting-head-actions">
          <span className="meeting-state" data-state={status ?? 'scheduled'}>
            {status ? STATE_LABEL[status] : 'Scheduled'}
          </span>
          {(!status || status === 'preparing' || status === 'ready') && (
            <button className="primary-button" onClick={openRoom} disabled={!attendees.length}>
              <DoorOpen size={15} />
              Open the boardroom
            </button>
          )}
          {live && meeting && (
            <button
              className="secondary-button"
              onClick={() => run(() => actions.closeMeeting(meeting.id), 'Wrap-ups are running.')}
            >
              <DoorClosed size={15} />
              Close meeting
            </button>
          )}
          {onReschedule && status !== 'closed' && (
            <button className="text-button" onClick={onReschedule}>
              Reschedule
            </button>
          )}
          {status === 'closing' && meeting && (
            <button
              className="secondary-button"
              onClick={() => run(() => actions.finalizeMeeting(meeting.id), 'The meeting is closed.')}
            >
              Finish closing
            </button>
          )}
        </div>
      </header>

      {meeting?.usage && <p className="meeting-total-usage">{usageLine(meeting.usage)}</p>}

      <div className="meeting-body">
        {(entry.purpose || entry.agenda.length > 0) && (
          <section className="meeting-section">
            <h3>Agenda</h3>
            {entry.purpose && <p className="meeting-purpose">{entry.purpose}</p>}
            {entry.agenda.length > 0 && (
              <ol className="meeting-agenda-list">
                {entry.agenda.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ol>
            )}
          </section>
        )}

        <PrepReports reports={turns.filter((turn) => turn.kind === 'report')} />
        <Transcript turns={turns} attendees={attendees} />

        {turns.some((turn) => turn.outcome) && (
          <section className="meeting-section">
            <h3>Wrap-up</h3>
            {turns
              .filter((turn) => turn.outcome)
              .map((turn) => (
                <OutcomeCard
                  key={turn.id}
                  turn={turn}
                  result={results[turn.id]}
                  onConfirm={() => void confirm(turn.id)}
                  onDismiss={() => void run(() => actions.dismissOutcome(turn.id), 'Dismissed.')}
                  onOpenTask={onOpenTask}
                  onOpenMeeting={onOpenMeeting}
                />
              ))}
          </section>
        )}
      </div>

      {live && (
        <div className="meeting-composer composer">
          <textarea
            value={question}
            placeholder="Ask the room a question…"
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.shiftKey) return;
              event.preventDefault();
              ask();
            }}
          />
          <div>
            <label className="meeting-address">
              <span className="sr-only">Who the question is for</span>
              <select value={addressee} onChange={(event) => setAddressee(event.target.value)}>
                <option value="">Everyone</option>
                {attendees.map((attendee) => (
                  <option key={attendee.id} value={attendee.id}>
                    {attendee.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="send-button" onClick={ask} disabled={!question.trim()} aria-label="Ask">
              <SendHorizontal size={15} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
