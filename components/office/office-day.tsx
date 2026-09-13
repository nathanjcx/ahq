'use client';

import { useMemo, useState } from 'react';
import { dateInputValue } from '../shared/time';
import {
  DAY_MS,
  dayAt,
  dayMoments,
  dayOf,
  momentAt,
  yesterday,
  type DayRecord,
} from './day-replay';
import type { LabelMode } from './office-labels';
import type { SelectProp } from './office-props';
import type { OfficeDressing, OfficeEmployee } from './office-scene';
import { OfficeStage, type OfficeSceneData } from './office-stage';
import { useDayQueries } from './use-day';
import './office-view.css';

/** The scrubber runs in minutes, which is fine enough to land on any one moment. */
const STEP_MS = 60_000;
/** Mid-morning: far enough in that a working day has started. */
const DEFAULT_OFFSET = 10 * 3_600_000;

type ReplayProps = {
  employees: OfficeEmployee[];
  floorId?: string;
  label?: string;
  labels?: LabelMode;
  /** Where the scrubber starts, as milliseconds into the day. */
  startAt?: number;
  /** Props the room carries whatever the day did: the board, the memory, the room itself. */
  dressing?: OfficeDressing;
  onSelect?: (id: string) => void;
  onSelectProp?: SelectProp;
};

/**
 * A day on this floor, replayed. Pick a day, drag the scrubber, and the office
 * acts it out: people arriving and leaving, the meeting filling up, the night's
 * audit, and any incident that came in — all from the same derivation the live
 * office runs on, so a replay cannot show a day the office could not.
 */
export function OfficeDay(props: ReplayProps) {
  const [from, setFrom] = useState(() => yesterday(Date.now()).from);
  const record = useDayRecord(props.employees, from);
  return <DayReplay {...props} record={record} onPickDay={setFrom} />;
}

/**
 * The replay itself, over a day somebody has already collected. The lab and the
 * unit tests drive this one; the live office wraps it in its subscriptions.
 */
export function DayReplay({
  employees,
  floorId,
  label,
  labels,
  startAt,
  dressing,
  onSelect,
  onSelectProp,
  record,
  onPickDay,
}: ReplayProps & { record: DayRecord; onPickDay?: (from: number) => void }) {
  const [offset, setOffset] = useState(startAt ?? DEFAULT_OFFSET);
  const at = record.from + offset;
  const { activities, signals, day } = useMemo(() => dayAt(record, floorId, at), [record, floorId, at]);
  const moments = useMemo(() => dayMoments(record), [record]);
  const when = new Date(at);
  const scene: OfficeSceneData = {
    ...dressing,
    activities,
    providers: [],
    lightBudget: 0,
    hour: when.getHours() + when.getMinutes() / 60,
    ...(signals.incident ? { incident: true, incidentCount: signals.incidentCount } : {}),
    ...(signals.emergency ? { emergency: signals.emergency } : {}),
    ...(signals.meeting ? { meeting: signals.meeting } : {}),
    ...(signals.findings.size ? { findings: signals.findings } : {}),
    ...(day.schedule
      ? {
          schedule: {
            working: day.schedule.working,
            attended: day.schedule.working,
            overnightCheap: day.schedule.overnightPolicy === 'cheap',
          },
        }
      : {}),
  };

  return (
    <div className="office-day">
      <OfficeStage
        live={false}
        scene={scene}
        employees={employees}
        label={label}
        labels={labels}
        onSelect={onSelect}
        onSelectProp={onSelectProp}
      />
      <div className="office-day-bar">
        <label className="office-day-date">
          <span>Day</span>
          <input
            type="date"
            value={dateInputValue(record.from)}
            disabled={!onPickDay}
            onChange={(event) => {
              const picked = dayOf(event.target.value);
              if (picked) onPickDay?.(picked.from);
            }}
          />
        </label>
        <button type="button" disabled={!onPickDay} onClick={() => onPickDay?.(yesterday(Date.now()).from)}>
          Yesterday
        </button>
        <input
          className="office-day-scrub"
          type="range"
          min={0}
          max={DAY_MS - STEP_MS}
          step={STEP_MS}
          value={offset}
          onChange={(event) => setOffset(Number(event.target.value))}
          aria-label={`Time of day, ${clock(at)}`}
          list="office-day-moments"
        />
        <datalist id="office-day-moments">
          {moments.map((moment) => (
            <option key={`${moment.at} ${moment.text}`} value={moment.at - record.from} />
          ))}
        </datalist>
        <output className="office-day-clock">{clock(at)}</output>
      </div>
      <p className="office-day-moment" role="status">
        {momentAt(record, at) || 'Nothing has happened on this floor yet.'}
      </p>
    </div>
  );
}

function clock(at: number): string {
  const when = new Date(at);
  return `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
}


/** A recorded day, from the same subscriptions the live office uses. */
function useDayRecord(employees: OfficeEmployee[], from: number): DayRecord {
  const day = useDayQueries(from);
  const people = useMemo(
    () => employees.map((employee) => ({ id: employee.id, name: employee.name })),
    [employees],
  );
  return useMemo(
    () => ({
      from,
      to: from + DAY_MS,
      employees: people,
      // The replay plays the day's shape; one task's journal is the other replay's job.
      tasks: [],
      shifts: day.shifts ?? [],
      meetings: day.meetings ?? [],
      findings: day.findings ?? [],
      alerts: day.alerts ?? [],
      notifications: day.notifications ?? [],
    }),
    [from, people, day],
  );
}
