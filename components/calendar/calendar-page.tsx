'use client';

import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useState } from 'react';
import type { MeetingDraft } from '../app/actions/calendar';
import type { PageProps } from '../app/page-props';
import { MeetingView } from '../meetings/meeting-view';
import { EmptySection } from '../shared/empty';
import { PageIntro } from '../shared/page-intro';
import { useIsNarrow } from '../shared/use-media';
import { useUiQuery } from '../shared/use-ui-query';
import { AgendaList } from './agenda-list';
import { DayTimeline, WeekGrid } from './calendar-grid';
import { calendarClock, calendarRows, dayStarts, type RowItem } from './rows';
import { ScheduleSheet } from './schedule-sheet';
import type { CalendarEntry } from '@/lib/contracts';
import { startOfDay } from '@/lib/time';
import { uiApi } from '@/lib/ui-api';
import './calendar.css';

const DAY_MS = 86_400_000;
/** How far either side of today a deep link is looked for, inside the range one read may span. */
const LOOKUP_DAYS = 31;
const WEEK_RANGE = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const DAY_TITLE = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

/** Monday of the week an instant falls in, in the workspace's zone. */
function weekStart(at: number, timezone: string) {
  const midnight = startOfDay(at, timezone);
  const back = (new Date(midnight).getDay() + 6) % 7;
  return startOfDay(midnight - back * DAY_MS + 12 * 3_600_000, timezone);
}

export function CalendarPage({
  dashboard,
  actions,
  configured,
  run,
  go,
  selectedMeeting,
  onSelectMeeting,
  onSelectTask,
}: PageProps) {
  const [now] = useState(() => Date.now());
  const [view, setView] = useState<'week' | 'day'>('week');
  const [anchor, setAnchor] = useState(now);
  const [sheet, setSheet] = useState<{ entry?: CalendarEntry } | null>(null);
  const narrow = useIsNarrow();

  const clock = calendarClock(dashboard.schedule);
  const days = view === 'week' ? 7 : 1;
  const bounds = dayStarts(
    view === 'week' ? weekStart(anchor, clock.timezone) : anchor,
    days,
    clock.timezone,
  );
  const entries =
    useUiQuery(uiApi.calendarEntries, configured ? { from: bounds[0], to: bounds[days] } : 'skip') ?? [];

  // A meeting linked to from another page may sit outside the week being read, so it is looked up.
  const inView = entries.find((entry) => entry.id === selectedMeeting);
  const elsewhere = useUiQuery(
    uiApi.calendarEntries,
    selectedMeeting && !inView && configured
      ? { from: now - LOOKUP_DAYS * DAY_MS, to: now + LOOKUP_DAYS * DAY_MS }
      : 'skip',
  );
  const meetingEntry = inView ?? elsewhere?.find((entry) => entry.id === selectedMeeting);

  const openEntry = (entry: CalendarEntry) => {
    if (entry.kind === 'meeting') {
      onSelectMeeting(entry.id);
      return;
    }
    if (!entry.taskId) return;
    onSelectTask(entry.taskId);
    go('tasks');
  };
  const openItem = (item: RowItem) => {
    if (item.entry) openEntry(item.entry);
  };

  const submit = async (draft: MeetingDraft) => {
    const editing = sheet?.entry;
    setSheet(null);
    if (editing) {
      await run(() => actions.rescheduleMeeting(editing.id, draft), 'Meeting moved.');
      return;
    }
    await run(() => actions.scheduleMeeting(draft), 'Meeting scheduled. Attendees will prepare for it.');
  };

  if (meetingEntry)
    return (
      <>
        <MeetingView
          entry={meetingEntry}
          actions={actions}
          run={run}
          onBack={() => onSelectMeeting(null)}
          onReschedule={() => setSheet({ entry: meetingEntry })}
          onOpenTask={(taskId) => {
            onSelectTask(taskId);
            go('tasks');
          }}
          onOpenMeeting={onSelectMeeting}
        />
        {sheet && (
          <ScheduleSheet
            entry={sheet.entry}
            employees={dashboard.employees}
            clock={clock}
            startAt={anchor}
            onClose={() => setSheet(null)}
            onSubmit={(draft) => void submit(draft)}
            onCancelMeeting={() => {
              setSheet(null);
              onSelectMeeting(null);
              void run(() => actions.cancelMeeting(meetingEntry.id), 'Meeting cancelled.');
            }}
          />
        )}
      </>
    );

  const rows = calendarRows(entries, dashboard.employees, bounds, clock);
  const today = new Date(now).toDateString();
  const heading =
    view === 'week'
      ? `${WEEK_RANGE.format(bounds[0])} – ${WEEK_RANGE.format(bounds[7] - DAY_MS)}`
      : DAY_TITLE.format(bounds[0]);

  return (
    <div>
      <PageIntro
        eyebrow="SCHEDULE"
        title="Calendar"
        description="Shifts, deadlines, audits, and meetings, one row per instance, on the workspace's clock."
        action={
          <button className="primary-button" disabled={!configured} onClick={() => setSheet({})}>
            <Plus size={17} />
            Schedule meeting
          </button>
        }
      />
      <div className="cal-toolbar">
        <div className="cal-nav">
          <button
            className="icon-button"
            aria-label={view === 'week' ? 'Previous week' : 'Previous day'}
            onClick={() => setAnchor(bounds[0] - 12 * 3_600_000)}
          >
            <ChevronLeft size={16} />
          </button>
          <strong>{heading}</strong>
          <button
            className="icon-button"
            aria-label={view === 'week' ? 'Next week' : 'Next day'}
            onClick={() => setAnchor(bounds[days] + 12 * 3_600_000)}
          >
            <ChevronRight size={16} />
          </button>
          <button className="text-button" onClick={() => setAnchor(now)}>
            Today
          </button>
        </div>
        <div className="segmented">
          {(['week', 'day'] as const).map((option) => (
            <button key={option} data-active={view === option} onClick={() => setView(option)}>
              {option === 'week' ? 'Week' : 'Day'}
            </button>
          ))}
        </div>
      </div>
      {configured ? (
        narrow ? (
          <AgendaList entries={entries} bounds={bounds} today={today} onOpen={openEntry} />
        ) : view === 'week' ? (
          <WeekGrid
            rows={rows}
            bounds={bounds}
            clock={clock}
            today={today}
            onOpen={openItem}
            onOpenDay={(start) => {
              setAnchor(start + 12 * 3_600_000);
              setView('day');
            }}
          />
        ) : (
          <DayTimeline rows={rows} bounds={bounds} clock={clock} now={now} onOpen={openItem} />
        )
      ) : (
        <EmptySection
          icon={<CalendarDays size={28} />}
          title="No workspace yet"
          text="Create a workspace and hire an employee; their shifts, deadlines, and meetings appear here."
        />
      )}
      {sheet && (
        <ScheduleSheet
          entry={sheet.entry}
          employees={dashboard.employees}
          clock={clock}
          startAt={bounds[0] + 10 * 3_600_000}
          onClose={() => setSheet(null)}
          onSubmit={(draft) => void submit(draft)}
        />
      )}
    </div>
  );
}
