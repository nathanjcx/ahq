'use client';

import { AlertTriangle, Plus, Sparkles } from 'lucide-react';
import { useState } from 'react';
import type { MeetingDraft } from '../app/actions/calendar';
import { Sheet } from '../shared/sheet';
import { useUiQuery } from '../shared/use-ui-query';
import type { Attendee, CalendarEntry, Employee, WorkingHours } from '@/lib/contracts';
import { isAttendedTime } from '@/lib/time';
import { uiApi } from '@/lib/ui-api';

const DURATIONS = [15, 30, 45, 60, 90];

/** The date and time inputs speak the viewer's own clock, which is the clock the calendar draws in. */
function fieldsFor(at: number) {
  const local = new Date(at);
  const pad = (value: number) => String(value).padStart(2, '0');
  return {
    date: `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`,
    time: `${pad(local.getHours())}:${pad(local.getMinutes())}`,
  };
}

function timestampOf(date: string, time: string) {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  if ([year, month, day, hour, minute].some((part) => !Number.isFinite(part))) return undefined;
  return new Date(year, month - 1, day, hour, minute).getTime();
}

/**
 * Booking or rescheduling a meeting. The agenda is suggested from the work due before the time
 * chosen, so moving the meeting re-reads what would be worth discussing at the new hour.
 */
export function ScheduleSheet({
  entry,
  employees,
  clock,
  startAt,
  onClose,
  onSubmit,
  onCancelMeeting,
}: {
  /** The meeting being changed, or nothing when one is being booked. */
  entry?: CalendarEntry;
  employees: Employee[];
  clock: WorkingHours;
  /** Where the calendar is looking, so a new meeting opens on the day being read. */
  startAt: number;
  onClose: () => void;
  onSubmit: (draft: MeetingDraft) => void;
  onCancelMeeting?: () => void;
}) {
  const opening = entry?.startsAt ?? startAt;
  const initial = fieldsFor(opening);
  const [title, setTitle] = useState(entry?.title ?? '');
  const [purpose, setPurpose] = useState(entry?.purpose ?? '');
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [minutes, setMinutes] = useState(
    entry ? Math.max(15, Math.round((entry.endsAt - entry.startsAt) / 60_000)) : 30,
  );
  const [attendeeIds, setAttendeeIds] = useState<string[]>(
    entry?.attendees.filter((one) => one.kind === 'employee').map((one) => one.id) ?? [],
  );
  const [agenda, setAgenda] = useState<string[]>(entry?.agenda ?? []);
  const [addition, setAddition] = useState('');

  const startsAt = timestampOf(date, time);
  const endsAt = startsAt === undefined ? undefined : startsAt + minutes * 60_000;
  const suggestions =
    useUiQuery(uiApi.suggestAgenda, startsAt === undefined ? 'skip' : { startsAt }) ?? [];
  const unattended =
    startsAt !== undefined && endsAt !== undefined && !(isAttendedTime(startsAt, clock) && isAttendedTime(endsAt - 1, clock));
  const ready = Boolean(title.trim()) && startsAt !== undefined && attendeeIds.length > 0;

  const toggle = (id: string) =>
    setAttendeeIds((current) =>
      current.includes(id) ? current.filter((one) => one !== id) : [...current, id],
    );
  const toggleAgenda = (text: string) =>
    setAgenda((current) =>
      current.includes(text) ? current.filter((one) => one !== text) : [...current, text],
    );

  const submit = () => {
    if (!ready || startsAt === undefined || endsAt === undefined) return;
    const attendees: Attendee[] = attendeeIds.map((id) => ({
      kind: 'employee',
      id,
      name: employees.find((employee) => employee.id === id)?.name ?? 'Employee',
    }));
    onSubmit({ title: title.trim(), startsAt, endsAt, attendees, agenda, purpose });
  };

  return (
    <Sheet
      title={entry ? 'Reschedule meeting' : 'Schedule a meeting'}
      subtitle="Pick the time, the room, and what the meeting is for. Attendees prepare beforehand."
      onClose={onClose}
      footer={
        <>
          {onCancelMeeting && (
            <button className="text-button danger-text" onClick={onCancelMeeting}>
              Cancel meeting
            </button>
          )}
          <button className="primary-button full" disabled={!ready} onClick={submit}>
            {entry ? 'Save changes' : 'Schedule meeting'}
          </button>
        </>
      }
    >
      <div className="form-stack">
        <label>
          Title
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Launch review" />
        </label>
        <div className="cal-when">
          <label>
            Date
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <label>
            Start
            <input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
          </label>
          <label>
            Length
            <select value={minutes} onChange={(event) => setMinutes(Number(event.target.value))}>
              {DURATIONS.map((option) => (
                <option key={option} value={option}>
                  {option} minutes
                </option>
              ))}
            </select>
          </label>
        </div>
        {unattended && (
          <p className="cal-warning" role="status">
            <AlertTriangle size={14} />
            That time falls outside the hours this workspace is attended. Attendees will still prepare,
            but nobody is expected to be in the room.
          </p>
        )}
        <div className="cal-field">
          <span>
            Attendees <small>Instances answer questions in their own session.</small>
          </span>
          <div className="tool-checklist cal-attendees">
            {employees.map((employee) => (
              <label key={employee.id}>
                <input
                  type="checkbox"
                  checked={attendeeIds.includes(employee.id)}
                  onChange={() => toggle(employee.id)}
                />
                <span>
                  <strong>{employee.name}</strong>
                  <small>{employee.role}</small>
                </span>
              </label>
            ))}
          </div>
        </div>
        <label>
          Purpose <small>What the meeting has to decide.</small>
          <textarea
            value={purpose}
            onChange={(event) => setPurpose(event.target.value)}
            placeholder="Agree what ships on the first and who owns the gaps."
          />
        </label>
        <div className="cal-suggest">
          <strong>
            <Sparkles size={13} />
            Suggested agenda
          </strong>
          {suggestions.length ? (
            <div className="tool-checklist">
              {suggestions.map((suggestion) => (
                <label key={suggestion.text}>
                  <input
                    type="checkbox"
                    checked={agenda.includes(suggestion.text)}
                    onChange={() => toggleAgenda(suggestion.text)}
                  />
                  <span>
                    <strong>{suggestion.text}</strong>
                    <small>{suggestion.reason}</small>
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <p className="cal-quiet">Nothing is due before this time.</p>
          )}
          {agenda
            .filter((item) => !suggestions.some((suggestion) => suggestion.text === item))
            .map((item) => (
              <label key={item} className="cal-suggest-own">
                <input type="checkbox" checked onChange={() => toggleAgenda(item)} />
                <span>{item}</span>
              </label>
            ))}
          <div className="cal-suggest-add">
            <input
              value={addition}
              placeholder="Add your own item"
              onChange={(event) => setAddition(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || !addition.trim()) return;
                event.preventDefault();
                toggleAgenda(addition.trim());
                setAddition('');
              }}
            />
            <button
              className="secondary-button"
              disabled={!addition.trim()}
              onClick={() => {
                toggleAgenda(addition.trim());
                setAddition('');
              }}
            >
              <Plus size={14} />
              Add
            </button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}
