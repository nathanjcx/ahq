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
}) {
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
      selected={null}
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
