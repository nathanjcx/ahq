import { useMemo } from 'react';
import type { OfficeEvent } from '../../shared/office-events';
import type { OfficeStation } from '../../shared/office-tool-atlas';
import { deriveOfficePresence, officeStationAnchor } from '../lib/office-presence';
import Office from '../../studio/app/office';
import type { Employee } from '../../shared/types';
export default function OfficeScene({
  employees,
  animate,
  onSelect,
  zoom,
  timeSeconds,
  live,
  listening,
  microphoneLevel,
  angle = 0,
  events = [],
  eventTimeMs,
  sample = false,
  selectedEmployeeId = null,
  onStation,
}: {
  employees: Employee[];
  animate: boolean;
  onSelect: (e: Employee) => void;
  zoom: number;
  timeSeconds: number;
  live: boolean;
  listening: boolean;
  microphoneLevel: number;
  angle?: number;
  events?: OfficeEvent[];
  eventTimeMs?: number;
  sample?: boolean;
  selectedEmployeeId?: string | null;
  onStation?: (station: OfficeStation) => void;
}) {
  const clock = eventTimeMs ?? timeSeconds * 1000;
  const presence = useMemo(() => {
    const derived = deriveOfficePresence(employees, events, clock, sample);
    if (!animate) {
      employees.forEach((employee, index) => {
        const person = derived.employees[employee.id];
        person.position = officeStationAnchor(index, person.station);
        person.walking = false;
        person.phase = 0;
        person.cueStrength = person.cue === 'none' ? 0 : 0.7;
      });
      derived.handoffs.forEach((handoff) => {
        handoff.pulse = 1;
        handoff.progress = handoff.status === 'queued' ? 0.35 : 1;
      });
      Object.values(derived.stations).forEach((station) => {
        if (station) station.phase = 1;
      });
    }
    return derived;
  }, [employees, events, clock, sample, animate]);
  return (
    <Office
      team={employees.map((e) => ({
        id: e.id,
        name: e.name,
        role: e.jobTitle,
        personality: e.personality,
        skills: e.skills,
        color: e.color,
        initials: e.name.slice(0, 2),
        task: e.activity,
        status: e.status === 'offline' ? 'ready' : e.status,
        position: [0.25, 0, 0.6],
        appearance: e.appearance,
        sessionId: e.sessionId,
        activityLocation: e.location,
      }))}
      presence={presence}
      selected={selectedEmployeeId}
      onStation={onStation}
      onSelect={(id) => {
        const e = employees.find((e) => e.id === id);
        if (e) onSelect(e);
      }}
      motion={animate}
      timeline={0}
      zoom={zoom * 37}
      angle={angle}
      timeSeconds={timeSeconds}
      live={live}
      listening={listening}
      microphoneLevel={microphoneLevel}
      onRoom={(room) => window.dispatchEvent(new CustomEvent('ahq:room', { detail: room }))}
    />
  );
}
