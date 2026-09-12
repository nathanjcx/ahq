'use client';

import { Archive, Building2, Check, ChevronDown, Plus } from 'lucide-react';
import { useState } from 'react';
import { Sheet } from '../shared/sheet';
import { countsLabel, type FloorEntry } from './floor-stats';

/**
 * The building directory, folded into one control. A phone has no room for the rail, so the floor
 * you are on names itself and opens the rest in a sheet.
 */
export function FloorSwitcher({
  activeFloors,
  archivedFloors,
  selected,
  unassignedTaskCount,
  canCreate,
  onSelectFloor,
  onNewFloor,
}: {
  activeFloors: FloorEntry[];
  archivedFloors: FloorEntry[];
  selected: FloorEntry | null;
  unassignedTaskCount: number;
  canCreate: boolean;
  onSelectFloor: (id: string | null) => void;
  onNewFloor: () => void;
}) {
  const [open, setOpen] = useState(false);
  const choose = (id: string | null) => {
    onSelectFloor(id);
    setOpen(false);
  };

  return (
    <div className="floor-switcher">
      <button className="floor-switcher-trigger" aria-expanded={open} onClick={() => setOpen(true)}>
        <span className="building-mark" aria-hidden="true">
          <Building2 size={17} />
        </span>
        <span>
          <small>{selected ? `FLOOR ${Number(selected.number)}` : 'GROUND FLOOR'}</small>
          <strong>{selected ? selected.floor.name : 'Lobby'}</strong>
        </span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <Sheet
          title="Building directory"
          subtitle="Every floor floor, and the lobby for work with no floor of its own."
          onClose={() => setOpen(false)}
          footer={
            <button
              className="primary-button full"
              disabled={!canCreate}
              onClick={() => {
                setOpen(false);
                onNewFloor();
              }}
            >
              <Plus size={16} /> New floor floor
            </button>
          }
        >
          <div className="directory-list switcher-list">
            <button data-active={!selected} onClick={() => choose(null)}>
              <span className="floor-number">L</span>
              <span>
                <strong>
                  <span>Lobby</span>
                </strong>
                <small>{unassignedTaskCount} unassigned tasks</small>
              </span>
              {!selected && <Check size={16} />}
            </button>
            {activeFloors.map(({ floor, number, summary }) => {
              const active = selected?.floor.id === floor.id;
              return (
                <button key={floor.id} data-active={active} onClick={() => choose(floor.id)}>
                  <span className="floor-number">{number}</span>
                  <span>
                    <strong>
                      <span>{floor.name}</span>
                      {floor.openHandoffs > 0 && <em className="handoff-badge">{floor.openHandoffs}</em>}
                    </strong>
                    <small>{countsLabel(summary)}</small>
                  </span>
                  {active && <Check size={16} />}
                </button>
              );
            })}
          </div>
          {archivedFloors.length > 0 && (
            <div className="directory-archive">
              <span>ARCHIVED</span>
              {archivedFloors.map(({ floor, number }) => (
                <button
                  key={floor.id}
                  data-active={selected?.floor.id === floor.id}
                  onClick={() => choose(floor.id)}
                >
                  <Archive size={14} />
                  <span>
                    {number} · {floor.name}
                  </span>
                </button>
              ))}
            </div>
          )}
        </Sheet>
      )}
    </div>
  );
}
