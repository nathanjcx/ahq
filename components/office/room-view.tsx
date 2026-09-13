'use client';

import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import type { SelectProp } from './office-props';
import { OfficeStage, type OfficeSceneData } from './office-stage';
import type { OfficeEmployee } from './office-view';
import { useLabelMode } from './use-labels';
import { useIsNarrow } from '@/components/shared/use-media';
import './office.css';

/**
 * One of the tower's other rooms, over the page that owns it: the basement, the
 * boardroom, the Triage floor. The room is the same office the floor page mounts,
 * dressed by the page's own data; it folds away, and on a phone it starts folded,
 * since a canvas is the most expensive thing a small screen can carry.
 */
export function RoomView({
  eyebrow,
  title,
  note,
  employees,
  scene,
  onSelect,
  onSelectProp,
}: {
  eyebrow: string;
  title: string;
  /** One line saying what the room is showing, for anyone who folds it away. */
  note: string;
  employees: OfficeEmployee[];
  scene: OfficeSceneData;
  onSelect?: (id: string) => void;
  onSelectProp?: SelectProp;
}) {
  const narrow = useIsNarrow();
  const [chosen, setChosen] = useState<boolean>();
  const open = chosen ?? !narrow;
  const labels = useLabelMode();
  return (
    <section className="office-room card" data-open={open}>
      <header>
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h3>{title}</h3>
        </div>
        <p>{note}</p>
        <button
          type="button"
          className="text-button"
          aria-expanded={open}
          onClick={() => setChosen(!open)}
        >
          {open ? 'Hide the room' : 'Show the room'}
          <ChevronDown size={14} />
        </button>
      </header>
      {open && (
        <div className="office-room-stage">
          <OfficeStage
            live={false}
            scene={scene}
            employees={employees}
            label={title}
            labels={labels.mode}
            onSelect={onSelect}
            onSelectProp={onSelectProp}
          />
        </div>
      )}
    </section>
  );
}
