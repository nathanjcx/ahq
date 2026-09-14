'use client';

import { useEffect, useRef, useState } from 'react';
import { toOfficeEmployees } from '../floors/office-employees';
import { OfficeStage } from '../office/office-stage';
import { useMedia } from '../shared/use-media';
import type { Dashboard } from '@/lib/contracts';

const ACTIVE = new Set(['queued', 'running', 'awaiting_approval', 'needs_input']);

/**
 * A porthole onto the building at the foot of the sidebar: the floor last looked at, live, so the
 * room is present on every page. It draws only while on screen in a visible tab, and not at all on
 * the Office page, which has the room already, or on a phone, where a second canvas costs more than
 * it says. One button over the whole frame opens the Office.
 */
export function Porthole({
  dashboard,
  floorId,
  onOpen,
}: {
  dashboard: Dashboard;
  floorId: string | null;
  onOpen: () => void;
}) {
  const wide = useMedia('(min-width: 1100px)');
  const frame = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    observer.observe(element);
    const onVisibility = () => setHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [wide]);
  if (!wide) return null;
  const floor = dashboard.floors.find((item) => item.id === floorId && !item.archivedAt) ?? null;
  const tasks = dashboard.tasks.filter((task) => (floor ? task.floorId === floor.id : !task.floorId));
  const staff = floor
    ? dashboard.employees.filter((employee) => floor.employeeIds.includes(employee.id))
    : dashboard.employees.filter(
        (employee) => !dashboard.floors.some((item) => item.employeeIds.includes(employee.id)),
      );
  return (
    <div ref={frame} className="porthole">
      <OfficeStage
        employees={toOfficeEmployees(
          staff,
          tasks.filter((task) => ACTIVE.has(task.status)),
        )}
        floorId={floor?.id}
        room={floor ? undefined : 'lobby'}
        dashboard={dashboard}
        live
        labels="off"
        paused={!visible || hidden}
        emptyMessage=""
      />
      <button type="button" className="porthole-open" onClick={onOpen}>
        <span className="porthole-label">{floor?.name ?? 'Lobby'}</span>
        <span className="sr-only">Open the office</span>
      </button>
    </div>
  );
}
