'use client';

import { Tag, Volume2, VolumeX } from 'lucide-react';
import type { ReactNode } from 'react';
import { OfficeStage, type OfficeSceneData } from '../office/office-stage';
import type { OfficeEmployee, OfficeRoom } from '../office/office-view';
import { useSound } from '../office/sound';
import { useLabelMode } from '../office/use-labels';
import type { Dashboard } from '@/lib/contracts';
import { pluralize } from '@/lib/text';

const LABEL_TITLE = {
  names: 'Labels: names. Show status dots only.',
  dots: 'Labels: dots. Hide labels.',
  off: 'Labels: off. Show names.',
};

/** The 3D office, framed by its toolbar and legend. Used by the lobby and by a floor's team rail. */
export function FloorScene({
  label,
  archived = false,
  compact = false,
  employeeCount,
  officeEmployees,
  emptyMessage,
  floorId,
  room,
  dashboard,
  live = false,
  scene,
  stage,
  controls,
  onEmployee,
}: {
  label: string;
  archived?: boolean;
  compact?: boolean;
  employeeCount: number;
  officeEmployees: OfficeEmployee[];
  emptyMessage: string;
  /** The floor on show. Omit for the lobby. */
  floorId?: string;
  /** Which room of the tower this is. A floor by default. */
  room?: OfficeRoom;
  /** The workspace the page is showing, which is what the office dresses itself from. */
  dashboard: Dashboard;
  /** Whether a Convex client exists, so the office may subscribe for live work. */
  live?: boolean;
  /** Replaces live work, so replay never touches the subscription. */
  scene?: OfficeSceneData;
  /** Replaces the stage entirely, for a view that brings its own timeline, such as the day replay. */
  stage?: ReactNode;
  /** A control for this scene, such as replay. Sits in its own dock under the canvas. */
  controls?: ReactNode;
  onEmployee: (id: string) => void;
}) {
  const sound = useSound();
  const labels = useLabelMode();
  return (
    <div className={`office-canvas floor-canvas ${compact ? 'floor-canvas-compact' : ''}`}>
      <div className="office-toolbar">
        <span>
          <span className="live-dot" />{' '}
          {archived ? 'ARCHIVED OFFICE' : !live ? 'OFFICE' : (scene ?? stage) ? 'REPLAY' : 'LIVE OFFICE'}
        </span>
        <span>{pluralize(employeeCount, 'employee')}</span>
      </div>
      <div className={`office-stage floor-stage ${stage ? 'floor-stage-day' : ''}`}>
        {stage ?? (
          <OfficeStage
            employees={officeEmployees}
            onSelect={onEmployee}
            label={label}
            emptyMessage={emptyMessage}
            archived={archived}
            floorId={floorId}
            room={room}
            dashboard={dashboard}
            live={live && !archived}
            scene={scene}
            labels={labels.mode}
          />
        )}
      </div>
      {controls && <div className="office-dock">{controls}</div>}
      <div className="office-legend">
        <span>
          <i className="status-dot working" /> Working
        </span>
        <span>
          <i className="status-dot waiting" /> Needs review
        </span>
        <span>
          <i className="status-dot idle" /> Available
        </span>
        <button
          type="button"
          className="office-labels"
          data-mode={labels.mode}
          title={LABEL_TITLE[labels.mode]}
          onClick={labels.cycle}
        >
          <Tag size={12} />
          Labels: {labels.mode}
        </button>
        <button
          type="button"
          className="office-sound"
          aria-pressed={sound.on}
          title={sound.on ? 'Turn office sound off' : 'Turn office sound on'}
          onClick={sound.toggle}
        >
          {sound.on ? <Volume2 size={12} /> : <VolumeX size={12} />}
          {sound.on ? 'Sound on' : 'Sound off'}
        </button>
      </div>
    </div>
  );
}
