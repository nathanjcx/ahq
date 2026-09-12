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
  onSelectProject,
  onNewProject,
}: {
  activeFloors: FloorEntry[];
  archivedFloors: FloorEntry[];
  selected: FloorEntry | null;
  unassignedTaskCount: number;
  canCreate: boolean;
  onSelectProject: (id: string | null) => void;
  onNewProject: () => void;
}) {
  const [open, setOpen] = useState(false);
  const choose = (id: string | null) => {
    onSelectProject(id);
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
          <strong>{selected ? selected.project.name : 'Lobby'}</strong>
        </span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <Sheet
          title="Building directory"
          subtitle="Every project floor, and the lobby for work with no floor of its own."
          onClose={() => setOpen(false)}
          footer={
            <button
              className="primary-button full"
              disabled={!canCreate}
              onClick={() => {
                setOpen(false);
                onNewProject();
              }}
            >
              <Plus size={16} /> New project floor
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
            {activeFloors.map(({ project, number, summary }) => {
              const active = selected?.project.id === project.id;
              return (
                <button key={project.id} data-active={active} onClick={() => choose(project.id)}>
                  <span className="floor-number">{number}</span>
                  <span>
                    <strong>
                      <span>{project.name}</span>
                      {project.openHandoffs > 0 && <em className="handoff-badge">{project.openHandoffs}</em>}
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
              {archivedFloors.map(({ project, number }) => (
                <button
                  key={project.id}
                  data-active={selected?.project.id === project.id}
                  onClick={() => choose(project.id)}
                >
                  <Archive size={14} />
                  <span>
                    {number} · {project.name}
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
