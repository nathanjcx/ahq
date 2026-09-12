'use client';

import dynamic from 'next/dynamic';
import type { OfficeEmployee } from '../office/office-view';

const OfficeView = dynamic(() => import('../office/office-view'), { ssr: false });

/** The 3D office, framed by its toolbar and legend. Used by the lobby and by a floor's team rail. */
export function FloorScene({
  label,
  archived = false,
  compact = false,
  employeeCount,
  officeEmployees,
  emptyMessage,
  onEmployee,
}: {
  label: string;
  archived?: boolean;
  compact?: boolean;
  employeeCount: number;
  officeEmployees: OfficeEmployee[];
  emptyMessage: string;
  onEmployee: (id: string) => void;
}) {
  return (
    <div className={`office-canvas floor-canvas ${compact ? 'floor-canvas-compact' : ''}`}>
      <div className="office-toolbar">
        <span>
          <span className="live-dot" /> {archived ? 'ARCHIVED OFFICE' : 'LIVE OFFICE'}
        </span>
        <span>
          {employeeCount} {employeeCount === 1 ? 'employee' : 'employees'}
        </span>
      </div>
      <div className="office-stage floor-stage">
        <OfficeView
          employees={officeEmployees}
          onSelect={onEmployee}
          label={label}
          emptyMessage={emptyMessage}
        />
      </div>
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
      </div>
    </div>
  );
}
