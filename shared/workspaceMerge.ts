import type { AppState } from './types';

// The renderer owns profile edits; the desktop owns generated plans and session progress.
export function mergeWorkspace(previous: AppState | null, incoming: AppState): AppState {
  if (!previous) return { ...incoming, roadmap: undefined };
  const combine = <T extends { id: string }>(a: T[], b: T[]) => [
    ...new Map([...a, ...b].map((item) => [item.id, item])).values(),
  ];
  const roadmap = previous.roadmap ? { ...previous.roadmap } : undefined;
  if (roadmap && roadmap.id === incoming.roadmap?.id && roadmap.status !== 'planning') {
    const existing = new Set(previous.commitments.map((c) => c.id));
    roadmap.milestoneIds = [
      ...new Set([
        ...roadmap.milestoneIds,
        ...incoming.commitments.filter((c) => !existing.has(c.id)).map((c) => c.id),
      ]),
    ];
  }
  const assigned = new Set([
    ...(roadmap?.assignments.map((a) => a.commitmentId) ?? []),
    ...previous.commitments.filter((c) => c.assignment !== undefined).map((c) => c.id),
  ]);
  const planned = new Set(roadmap?.milestoneIds);
  const incomingCommitments = new Map(incoming.commitments.map((c) => [c.id, c]));
  return {
    ...incoming,
    goal: roadmap ? previous.goal : incoming.goal,
    roadmap,
    employees: [
      ...previous.employees.filter(
        (employee) => employee.temporary && !incoming.employees.some((item) => item.id === employee.id),
      ),
      ...incoming.employees,
    ].map((employee) => {
      const saved = previous.employees.find((e) => e.id === employee.id);
      return saved && (saved.sessionId || employee.sessionId)
        ? {
            ...employee,
            temporary: saved.temporary,
            sessionId: saved.sessionId,
            status: saved.status,
            activity: saved.activity,
            location: saved.location,
          }
        : employee;
    }),
    commitments: combine(
      incoming.commitments,
      previous.commitments.map((saved) => {
        let edited = incomingCommitments.get(saved.id);
        if (!edited || (roadmap?.id !== incoming.roadmap?.id && planned.has(saved.id))) return saved;
        if (roadmap?.automatic && planned.has(saved.id)) edited = { ...edited, taskKind: saved.taskKind };
        // Once dispatched, completion is driven by review of its actual session output.
        return assigned.has(saved.id)
          ? {
              ...edited,
              status: saved.status,
              progress: saved.progress,
              nextStep: saved.nextStep,
              ownerId: saved.ownerId,
              ...(saved.assignment !== undefined
                ? { assignment: saved.assignment, sessionId: saved.sessionId }
                : {}),
            }
          : edited;
      }),
    ),
    messages: combine(previous.messages, incoming.messages),
    events: combine(previous.events, incoming.events),
    approvals: combine(
      incoming.approvals.filter(
        (a) => !a.sessionId || previous.employees.some((e) => e.sessionId === a.sessionId),
      ),
      previous.approvals.filter(
        (a) => !!a.sessionId || incoming.approvals.some((i) => i.id === a.id && !!i.sessionId),
      ),
    ),
  };
}
