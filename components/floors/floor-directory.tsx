'use client';

import { Archive, Building2, ChevronRight } from 'lucide-react';
import { relativeTime } from '../shared/time';
import { countsLabel, type FloorEntry } from './floor-stats';
import { FloorSwitcher } from './floor-switcher';

export function FloorDirectory({
  workspaceName,
  activeFloors,
  archivedFloors,
  selectedFloorId,
  unassignedTaskCount,
  canCreate,
  onSelectFloor,
  onNewFloor,
}: {
  workspaceName?: string;
  /** Active floors, most recently active first. */
  activeFloors: FloorEntry[];
  archivedFloors: FloorEntry[];
  selectedFloorId: string | null;
  unassignedTaskCount: number;
  canCreate: boolean;
  onSelectFloor: (id: string | null) => void;
  onNewFloor: () => void;
}) {
  return (
    <aside className="floor-directory" aria-label="Building directory">
      <FloorSwitcher
        activeFloors={activeFloors}
        archivedFloors={archivedFloors}
        selected={
          activeFloors.concat(archivedFloors).find((entry) => entry.floor.id === selectedFloorId) ?? null
        }
        unassignedTaskCount={unassignedTaskCount}
        canCreate={canCreate}
        onSelectFloor={onSelectFloor}
        onNewFloor={onNewFloor}
      />
      <div className="directory-rail card">
        <div className="directory-head">
          <span className="building-mark" aria-hidden="true">
            <Building2 size={19} />
          </span>
          <div>
            <span className="eyebrow">BUILDING DIRECTORY</span>
            <h2>{workspaceName || 'Astra HQ'}</h2>
          </div>
        </div>
        <div className="directory-list">
          <button
            data-active={!selectedFloorId}
            aria-pressed={!selectedFloorId}
            onClick={() => onSelectFloor(null)}
          >
            <span className="floor-number">L</span>
            <span>
              <strong>
                <span>Lobby</span>
              </strong>
              <small>{unassignedTaskCount} unassigned tasks</small>
            </span>
            <ChevronRight size={14} />
          </button>
          {activeFloors.map(({ floor, number, summary }) => (
            <button
              key={floor.id}
              data-active={selectedFloorId === floor.id}
              aria-pressed={selectedFloorId === floor.id}
              onClick={() => onSelectFloor(floor.id)}
            >
              <span className="floor-number">{number}</span>
              <span>
                <strong>
                  <span>{floor.name}</span>
                  {floor.openHandoffs > 0 && (
                    <em className="handoff-badge" title={`${floor.openHandoffs} open handoffs`}>
                      {floor.openHandoffs}
                    </em>
                  )}
                </strong>
                <small>{countsLabel(summary)}</small>
                <small>{relativeTime(summary.lastActivity)}</small>
              </span>
              <ChevronRight size={14} />
            </button>
          ))}
        </div>
        {!activeFloors.length && (
          <div className="directory-empty">
            <p>Create a floor for each floor, then staff it with the employees it needs.</p>
            <button className="text-button" onClick={onNewFloor} disabled={!canCreate}>
              Add first floor
            </button>
          </div>
        )}
        {archivedFloors.length > 0 && (
          <div className="directory-archive">
            <span>ARCHIVED</span>
            {archivedFloors.map(({ floor, number }) => (
              <button
                key={floor.id}
                data-active={selectedFloorId === floor.id}
                aria-pressed={selectedFloorId === floor.id}
                onClick={() => onSelectFloor(floor.id)}
              >
                <Archive size={13} />
                <span>
                  {number} · {floor.name}
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="directory-footer">
          <span>{activeFloors.length}</span>
          <p>active {activeFloors.length === 1 ? 'floor' : 'floors'}</p>
        </div>
      </div>
    </aside>
  );
}
