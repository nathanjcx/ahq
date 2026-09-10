import { useCallback, useEffect, useRef, useState } from 'react';
import Office from '../../studio/app/office';
import type { Employee } from '../../shared/types';
export default function OfficeScene({
  employees,
  requestedCelebrationId,
  animate,
  onSelect,
  reviewEmployeeIds,
  onReview,
  zoom,
  timeSeconds,
  live,
  listening,
  microphoneLevel,
  angle = 0,
  resetKey = 0,
  slapMode = false,
  partyMode = false,
  slapTarget,
  onSlap,
}: {
  employees: Employee[];
  requestedCelebrationId?: string | null;
  animate: boolean;
  onSelect: (e: Employee) => void;
  reviewEmployeeIds: string[];
  onReview: (e: Employee) => void;
  zoom: number;
  timeSeconds: number;
  live: boolean;
  listening: boolean;
  microphoneLevel: number;
  angle?: number;
  resetKey?: number;
  slapMode?: boolean;
  partyMode?: boolean;
  slapTarget?: { employeeId: string; token: number } | null;
  onSlap?: (employeeId: string) => void;
}) {
  const [celebrationId, setCelebrationId] = useState<string | null>(null);
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const seenCelebrations = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const celebrate = useCallback((id?: string | null) => {
    if (!id || seenCelebrations.current.has(id)) return;
    seenCelebrations.current.add(id);
    setCelebrationId(id);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCelebrationId(null), 8000);
  }, []);
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(preference.matches);
    preference.addEventListener('change', update);
    const onCelebrate = (event: Event) => celebrate((event as CustomEvent<{ id?: string }>).detail?.id);
    const restore = () => {
      clearTimeout(timer.current);
      setCelebrationId(null);
    };
    window.addEventListener('ahq:celebrate', onCelebrate);
    window.addEventListener('ahq:launch-restored', restore);
    return () => {
      window.removeEventListener('ahq:celebrate', onCelebrate);
      window.removeEventListener('ahq:launch-restored', restore);
      preference.removeEventListener('change', update);
      clearTimeout(timer.current);
    };
  }, [celebrate]);
  useEffect(() => {
    celebrate(requestedCelebrationId);
  }, [celebrate, requestedCelebrationId]);
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
      reviewEmployeeIds={reviewEmployeeIds}
      onReview={(id) => {
        const employee = employees.find((item) => item.id === id);
        if (employee) onReview(employee);
      }}
      celebrationId={celebrationId}
      motion={animate && !reducedMotion}
      timeline={0}
      zoom={zoom * 37}
      angle={angle}
      resetKey={resetKey}
      timeSeconds={timeSeconds}
      live={live}
      listening={listening}
      microphoneLevel={microphoneLevel}
      slapMode={slapMode}
      partyMode={partyMode || (!!celebrationId && animate && !reducedMotion)}
      slapTarget={slapTarget}
      onSlap={onSlap}
      onRoom={(room) => window.dispatchEvent(new CustomEvent('ahq:room', { detail: room }))}
    />
  );
}
