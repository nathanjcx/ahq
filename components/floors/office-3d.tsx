'use client';

import {
  Archive,
  CalendarClock,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Plus,
  RotateCcw,
  Tag,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { OfficeDay } from '../office/office-day';
import { OfficeStage, type OfficeSceneData } from '../office/office-stage';
import type { OfficeEmployee } from '../office/office-view';
import { useSound } from '../office/sound';
import { useLabelMode } from '../office/use-labels';
import { useMedia } from '../shared/use-media';
import { FloorReplay } from './floor-replay';
import type { FloorEntry } from './floor-stats';
import { FloorSwitcher } from './floor-switcher';
import type { Dashboard, Employee, Task } from '@/lib/contracts';

const LABEL_TITLE = {
  names: 'Labels: names. Show status dots only.',
  dots: 'Labels: dots. Hide labels.',
  off: 'Labels: off. Show names.',
};

export type PanelTab = { id: string; label: string; content: ReactNode };

/**
 * The 3D office as the whole page: the scene fills the viewport and everything else floats inside
 * it. The floor picker top left, the legend and scene controls top right, replay bottom left, the
 * camera bottom right, and the floor's panels in a rail that opens over the right edge. Nothing
 * outside the viewport scrolls; each panel scrolls within itself.
 */
export function Office3D({
  entries,
  selected,
  dashboard,
  configured,
  staff,
  officeEmployees,
  tasks,
  panels,
  unassignedTaskCount,
  onSelectFloor,
  onNewFloor,
  onEditFloor,
  onArchive,
  onNewTask,
  onEmployee,
}: {
  entries: { active: FloorEntry[]; archived: FloorEntry[] };
  /** The floor on show, or null for the lobby. */
  selected: FloorEntry | null;
  dashboard: Dashboard;
  configured: boolean;
  staff: Employee[];
  officeEmployees: OfficeEmployee[];
  tasks: Task[];
  panels: PanelTab[];
  unassignedTaskCount: number;
  onSelectFloor: (id: string | null) => void;
  onNewFloor: () => void;
  onEditFloor: () => void;
  onArchive: (archived: boolean) => void;
  onNewTask: () => void;
  onEmployee: (id: string) => void;
}) {
  const wide = useMedia('(min-width: 1100px)');
  const [railOpen, setRailOpen] = useState<boolean | null>(null);
  const [tab, setTab] = useState(panels[0]?.id ?? '');
  const [replay, setReplay] = useState<OfficeSceneData | undefined>(undefined);
  const [dayOpen, setDayOpen] = useState(false);
  const sound = useSound();
  const labels = useLabelMode();
  const floor = selected?.floor ?? null;
  const archived = Boolean(floor?.archivedAt);
  const label = floor ? `Floor ${Number(selected!.number)} · ${floor.name}` : 'Lobby';
  const open = railOpen ?? wide;
  const current = panels.find((panel) => panel.id === tab) ?? panels[0];
  const emptyMessage = staff.length
    ? 'This team needs its connections set up. Select an employee to review access.'
    : floor
      ? 'This floor is ready. Edit the floor to add its team.'
      : dashboard.employees.length
        ? 'The lobby is clear. Employees staffed on floors appear there.'
        : 'Your office is ready. Hire your first employee to get started.';

  return (
    <div className="office-3d" data-rail={open ? 'open' : 'closed'}>
      <div className="office-3d-stage">
        {dayOpen && floor ? (
          <OfficeDay
            employees={officeEmployees}
            floorId={floor.id}
            label={label}
            labels={labels.mode}
            tasks={tasks}
            schedule={dashboard.schedule}
            onSelect={onEmployee}
          />
        ) : (
          <OfficeStage
            employees={officeEmployees}
            onSelect={onEmployee}
            label={label}
            emptyMessage={emptyMessage}
            archived={archived}
            floorId={floor?.id}
            room={floor ? undefined : 'lobby'}
            dashboard={dashboard}
            live={configured && !archived}
            scene={replay}
            labels={labels.mode}
          />
        )}
      </div>

      <div className="office-3d-corner office-3d-topleft">
        <FloorSwitcher
          activeFloors={entries.active}
          archivedFloors={entries.archived}
          selected={selected}
          unassignedTaskCount={unassignedTaskCount}
          canCreate={configured}
          onSelectFloor={onSelectFloor}
          onNewFloor={onNewFloor}
        />
        <span className="office-3d-state">
          <i className="live-dot" />
          {archived
            ? 'Archived'
            : replay
              ? 'Replay'
              : dayOpen
                ? 'Day replay'
                : configured
                  ? 'Live'
                  : 'Office'}{' '}
          · {staff.length} on this {floor ? 'floor' : 'level'}
        </span>
      </div>

      <div className="office-3d-corner office-3d-topright">
        <div className="office-3d-cluster office-3d-legend" aria-label="Legend">
          <span>
            <i className="status-dot working" /> Working
          </span>
          <span>
            <i className="status-dot waiting" /> Needs you
          </span>
          <span>
            <i className="status-dot idle" /> Available
          </span>
        </div>
        <div className="office-3d-cluster" role="group" aria-label="Scene controls">
          <button
            type="button"
            data-mode={labels.mode}
            title={LABEL_TITLE[labels.mode]}
            onClick={labels.cycle}
          >
            <Tag size={13} /> {labels.mode}
          </button>
          <button
            type="button"
            aria-pressed={sound.on}
            title={sound.on ? 'Turn office sound off' : 'Turn office sound on'}
            onClick={sound.toggle}
          >
            {sound.on ? <Volume2 size={13} /> : <VolumeX size={13} />}
          </button>
          {floor && (
            <button
              type="button"
              aria-pressed={dayOpen}
              title="Replay the day"
              disabled={!configured || archived || replay !== undefined}
              onClick={() => setDayOpen((value) => !value)}
            >
              <CalendarClock size={13} /> Day
            </button>
          )}
        </div>
        <div
          className="office-3d-cluster"
          role="group"
          aria-label={floor ? 'Floor actions' : 'Lobby actions'}
        >
          <button
            type="button"
            disabled={!configured || archived || !staff.some((employee) => employee.status === 'ready')}
            onClick={onNewTask}
          >
            <Plus size={13} /> Assign
          </button>
          {floor && (
            <>
              <button type="button" onClick={onEditFloor} title="Edit floor">
                <Pencil size={13} />
              </button>
              <button
                type="button"
                disabled={!configured}
                title={archived ? 'Restore floor' : 'Archive floor'}
                onClick={() => onArchive(!archived)}
              >
                {archived ? <RotateCcw size={13} /> : <Archive size={13} />}
              </button>
            </>
          )}
          <button
            type="button"
            aria-pressed={open}
            title={open ? 'Hide the panel' : 'Show the panel'}
            onClick={() => setRailOpen(!open)}
          >
            {open ? <PanelRightClose size={13} /> : <PanelRightOpen size={13} />}
          </button>
        </div>
      </div>

      {floor && !dayOpen && (
        <div className="office-3d-corner office-3d-bottomleft">
          <FloorReplay
            floorId={floor.id}
            live={configured && !archived}
            defaultEmployeeId={staff[0]?.id}
            onScene={setReplay}
          />
        </div>
      )}

      {open && current && (
        <aside className="office-3d-rail" aria-label={`${label} panel`}>
          <div className="office-3d-rail-tabs segmented" role="tablist">
            {panels.map((panel) => (
              <button
                key={panel.id}
                role="tab"
                aria-selected={panel.id === current.id}
                data-active={panel.id === current.id}
                onClick={() => setTab(panel.id)}
              >
                {panel.label}
              </button>
            ))}
          </div>
          <div className="office-3d-rail-body" key={current.id}>
            {current.content}
          </div>
        </aside>
      )}
    </div>
  );
}
