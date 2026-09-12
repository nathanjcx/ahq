'use client';

import { useState } from 'react';
import { hourLabel } from '../../shared/time';
import { useUiQuery } from '../../shared/use-ui-query';
import { formId, LockedNote, type SectionProps } from './sections';
import type { OvernightPolicy } from '@/lib/contracts';
import { uiApi } from '@/lib/ui-api';

const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const hours = Array.from({ length: 25 }, (_, hour) => hour);

const overnightOptions: { value: OvernightPolicy; label: string; hint: string }[] = [
  { value: 'off', label: 'Off', hint: 'Nothing runs outside working hours.' },
  { value: 'audits_only', label: 'Audits only', hint: 'The auditors work; nobody else does.' },
  { value: 'cheap', label: 'Cheap shifts', hint: 'Shifts continue on each instance’s overnight model.' },
];

/** The list of IANA zones the browser knows, so a person picks rather than types one. */
const timezones = Intl.supportedValuesOf('timeZone');

function clock(hour: number, timezone: string) {
  return hour === 24 ? 'Midnight' : hourLabel(hour, timezone);
}

/**
 * The hours the tower keeps. Working hours are when employees work; attended hours are when a person
 * is around to approve things, and they sit inside working hours.
 */
export function ScheduleSection({ settings, canManage, save }: SectionProps) {
  const [draft, setDraft] = useState(settings);
  const summary = useUiQuery(uiApi.scheduleSummary, {});
  const toggleDay = (day: number) =>
    setDraft({
      ...draft,
      workingDays: draft.workingDays.includes(day)
        ? draft.workingDays.filter((entry) => entry !== day)
        : [...draft.workingDays, day].sort((a, b) => a - b),
    });

  return (
    <form
      id={formId('schedule')}
      className="form-stack"
      onSubmit={(event) => {
        event.preventDefault();
        void save(draft, 'Schedule saved');
      }}
    >
      {summary && (
        <p className="settings-now">
          Right now the workspace is{' '}
          <strong>{summary.working ? 'inside working hours' : 'outside working hours'}</strong> and{' '}
          <strong>{summary.attended ? 'attended' : 'unattended'}</strong>.
        </p>
      )}
      <label>
        Timezone
        <select
          value={draft.timezone}
          disabled={!canManage}
          onChange={(event) => setDraft({ ...draft, timezone: event.target.value })}
        >
          {(timezones.includes(draft.timezone) ? timezones : [draft.timezone, ...timezones]).map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
        <small>Every hour below, and every deadline, is read in this zone.</small>
      </label>

      <div className="settings-field">
        <span className="settings-label">Working days</span>
        <div className="day-picker">
          {dayNames.map((name, day) => (
            <button
              key={name}
              type="button"
              disabled={!canManage}
              data-active={draft.workingDays.includes(day)}
              aria-pressed={draft.workingDays.includes(day)}
              onClick={() => toggleDay(day)}
            >
              <span className="sr-only">{name}</span>
              <span aria-hidden="true">{name.slice(0, 3)}</span>
            </button>
          ))}
        </div>
        <small>A daily task runs one shift on each of these days.</small>
      </div>

      <div className="settings-pair">
        <label>
          Working day starts
          <select
            value={draft.startHour}
            disabled={!canManage}
            onChange={(event) => setDraft({ ...draft, startHour: Number(event.target.value) })}
          >
            {hours.slice(0, 24).map((hour) => (
              <option key={hour} value={hour}>
                {clock(hour, draft.timezone)}
              </option>
            ))}
          </select>
        </label>
        <label>
          and ends
          <select
            value={draft.endHour}
            disabled={!canManage}
            onChange={(event) => setDraft({ ...draft, endHour: Number(event.target.value) })}
          >
            {hours.slice(1).map((hour) => (
              <option key={hour} value={hour}>
                {clock(hour, draft.timezone)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="settings-pair">
        <label>
          Attended from
          <select
            value={draft.attendedStartHour}
            disabled={!canManage}
            onChange={(event) => setDraft({ ...draft, attendedStartHour: Number(event.target.value) })}
          >
            {hours.slice(0, 24).map((hour) => (
              <option key={hour} value={hour}>
                {clock(hour, draft.timezone)}
              </option>
            ))}
          </select>
        </label>
        <label>
          until
          <select
            value={draft.attendedEndHour}
            disabled={!canManage}
            onChange={(event) => setDraft({ ...draft, attendedEndHour: Number(event.target.value) })}
          >
            {hours.slice(1).map((hour) => (
              <option key={hour} value={hour}>
                {clock(hour, draft.timezone)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="field-hint">
        Attended hours sit inside working hours. Merges, deploys, and anything else that needs a person
        wait for them.
      </p>

      <div className="settings-field">
        <span className="settings-label">Overnight</span>
        <div className="settings-choices">
          {overnightOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={!canManage}
              data-active={draft.overnightPolicy === option.value}
              onClick={() => setDraft({ ...draft, overnightPolicy: option.value })}
            >
              <strong>{option.label}</strong>
              <small>{option.hint}</small>
            </button>
          ))}
        </div>
        <small>
          The model a cheap overnight shift runs on belongs to the instance, not the workspace: set it on
          the employee.
        </small>
      </div>
      {!canManage && <LockedNote what="Working hours" />}
    </form>
  );
}
