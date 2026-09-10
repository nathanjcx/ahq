import type { AppState, CloudSession, Commitment } from '../../shared/types';
import { timeNow, uid } from './store';
import { applySession } from './workflow';

/** Reserve the SessionSchema envelope (500 events) plus the user's assignment before dispatch. */
export function assertCanAssignTask(state: AppState): void {
  if (
    state.commitments.length >= 1000 ||
    (state.roadmap?.milestoneIds.length ?? 0) >= 1000 ||
    state.messages.length + 501 > 10000 ||
    state.events.length + 501 > 20000 ||
    state.approvals.length >= 1000
  )
    throw new Error('This workspace is full. Make room before assigning another task.');
}

/** Records a confirmed manual assignment without starting or resuming goal delegation. */
export function recordAssignedTask(
  state: AppState,
  employeeId: string,
  assignment: string,
  session: CloudSession,
): AppState {
  const employee = state.employees.find((item) => item.id === employeeId);
  if (!employee) throw new Error('This employee is no longer in the office.');
  if (!session.id) throw new Error('The assignment does not have a confirmed session.');

  const existing = state.commitments.find((item) => item.sessionId === session.id);
  if (existing) {
    if (existing.ownerId !== employeeId)
      throw new Error('This session is already assigned to another employee.');
    return applySession(state, employeeId, session);
  }
  assertCanAssignTask(state);
  if (!assignment.trim()) throw new Error('Describe the task you want to assign.');
  if (assignment.length > 12000) throw new Error('Keep the task under 12,000 characters.');

  const knownEvents = new Set(state.events.map((item) => item.id));
  let newEvents = 0;
  for (const event of session.events) {
    const id = `${session.id}:${event.id}`;
    if (knownEvents.has(id)) continue;
    knownEvents.add(id);
    newEvents++;
  }
  const newApproval =
    !session.reviewed &&
    session.output &&
    !state.approvals.some((item) => item.sessionId === session.id && item.version >= session.output!.version)
      ? 1
      : 0;
  if (
    state.messages.length + 1 + newEvents > 10000 ||
    state.events.length + 1 + newEvents > 20000 ||
    state.approvals.length + newApproval > 1000
  )
    throw new Error('This workspace is full. Make room before assigning another task.');

  const firstLine = assignment.trim().split(/\r?\n/, 1)[0].replace(/\s+/g, ' ');
  const title = firstLine.length > 120 ? `${firstLine.slice(0, 117)}...` : firstLine;
  const commitment: Commitment = {
    id: uid(),
    title,
    description: assignment.slice(0, 2000),
    assignment,
    ownerId: employeeId,
    recipient: 'You',
    deadline: '',
    firm: false,
    status: 'in-progress',
    progress: 10,
    nextStep: session.activity,
    dependencies: [],
    source: 'Assigned by you',
    definitionOfDone: 'Complete the requested task and return the result for review.',
    sessionId: session.id,
  };
  const time = timeNow();
  return applySession(
    {
      ...state,
      demo: false,
      commitments: [...state.commitments, commitment],
      ...(state.roadmap
        ? {
            roadmap: {
              ...state.roadmap,
              milestoneIds: [...state.roadmap.milestoneIds, commitment.id],
              ...(state.roadmap.status === 'complete'
                ? {
                    status: 'paused' as const,
                    message: 'This task is being tracked. Automatic delegation is paused.',
                  }
                : {}),
            },
          }
        : {}),
      messages: [
        ...state.messages,
        { id: uid(), authorId: 'you', channel: employeeId, text: assignment, time },
      ],
      events: [
        ...state.events,
        {
          id: uid(),
          employeeId,
          text: `Assigned “${title}” to ${employee.name}.`,
          time,
          kind: 'work',
          source: 'local',
        },
      ],
    },
    employeeId,
    session,
  );
}
