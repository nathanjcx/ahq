import type { AppState, CloudSession } from '../../shared/types';
import { timeNow, uid } from './store';
export function applyDecision(
  state: AppState,
  id: string,
  version: number,
  decision: 'approved' | 'changes-requested',
  feedback = '',
): AppState {
  const approval = state.approvals.find((a) => a.id === id);
  if (!approval || approval.status !== 'pending' || approval.version !== version)
    throw new Error('This review is no longer current. Open the latest version.');
  if (decision === 'changes-requested' && !feedback.trim())
    throw new Error('Please include the changes you would like to see.');
  return {
    ...state,
    approvals: state.approvals.map((a) => (a.id === id ? { ...a, status: decision } : a)),
    commitments: state.commitments.map((c) =>
      c.id === approval.commitmentId
        ? {
            ...c,
            status: decision === 'approved' ? 'done' : 'in-progress',
            progress: decision === 'approved' ? 100 : Math.min(c.progress, 70),
            nextStep: decision === 'approved' ? 'Reviewed and approved' : feedback,
          }
        : c,
    ),
    employees: state.employees.map((e) =>
      e.id === approval.employeeId
        ? {
            ...e,
            status: approval.sessionId && decision === 'changes-requested' ? 'working' : 'ready',
            activity:
              decision === 'approved'
                ? 'Review complete · ready for the next step'
                : approval.sessionId
                  ? 'Changes requested'
                  : 'Revision requested · awaiting a cloud session',
          }
        : e,
    ),
    events: [
      ...state.events,
      {
        id: uid(),
        text: `${decision === 'approved' ? 'Approved' : 'Requested changes to'} “${approval.title}”`,
        time: timeNow(),
        kind: 'review',
        source: approval.sessionId ? 'cloud' : 'local',
      },
    ],
    messages:
      decision === 'changes-requested'
        ? [
            ...state.messages,
            {
              id: uid(),
              authorId: 'you',
              channel: approval.employeeId,
              text: `Changes requested for “${approval.title}”: ${feedback}`,
              time: timeNow(),
            },
          ]
        : state.messages,
  };
}
export function applySession(state: AppState, employeeId: string, session: CloudSession): AppState {
  const existingEvents = new Set(state.events.map((e) => e.id));
  const freshEvents = session.events.filter((event) => {
    const key = `${session.id}:${event.id}`;
    if (existingEvents.has(key)) return false;
    existingEvents.add(key);
    return true;
  });
  const nextStatus =
    session.status === 'waiting_for_approval'
      ? 'review'
      : session.status === 'failed'
        ? 'offline'
        : session.status === 'completed' || session.status === 'cancelled'
          ? 'ready'
          : 'working';
  const existing = state.employees.find((e) => e.id === employeeId);
  const output = session.output;
  const replyId = output ? `${session.id}:reply:${output.version}` : '';
  const needsReply = output?.recipient === 'You' && !state.messages.some((message) => message.id === replyId);
  const newOutput =
    output && !state.approvals.some((a) => a.sessionId === session.id && a.version >= output.version);
  if (
    existing?.status === nextStatus &&
    existing.activity === session.activity &&
    existing.location === session.location &&
    !freshEvents.length &&
    !newOutput &&
    !needsReply &&
    !(session.reviewed && state.approvals.some((a) => a.sessionId === session.id && a.status === 'pending'))
  )
    return state;
  return {
    ...state,
    employees: state.employees.map((e) =>
      e.id === employeeId
        ? {
            ...e,
            sessionId: session.id,
            status: nextStatus,
            activity: session.activity,
            location: session.location,
          }
        : e,
    ),
    events: [
      ...state.events,
      ...freshEvents.map((event) => ({
        ...event,
        id: `${session.id}:${event.id}`,
        employeeId,
        kind: 'work' as const,
        source: 'cloud' as const,
      })),
    ],
    messages: [
      ...state.messages,
      ...(needsReply && output
        ? [{ id: replyId, authorId: employeeId, channel: employeeId, text: output.content, time: timeNow() }]
        : []),
      ...freshEvents.map((event) => ({
        id: `${session.id}:${event.id}`,
        authorId: employeeId,
        channel: 'team',
        text: event.text,
        time: event.time,
      })),
    ],
    approvals:
      session.reviewed && !newOutput
        ? state.approvals.map((a) =>
            a.sessionId === session.id && a.version === output?.version
              ? { ...a, status: 'approved' as const }
              : a,
          )
        : newOutput
          ? [
              ...state.approvals.map((a) =>
                a.sessionId === session.id && a.status === 'pending'
                  ? { ...a, status: 'changes-requested' as const }
                  : a,
              ),
              {
                id: uid(),
                employeeId,
                title: output.title,
                summary: 'Astra cloud output is ready for review.',
                content: output.content,
                createdAt: timeNow(),
                status: session.reviewed ? 'approved' : 'pending',
                kind: output.recipient === 'You' ? 'document' : 'decision',
                recipient: output.recipient,
                sources: output.sources,
                version: output.version,
                sessionId: session.id,
              },
            ]
          : !session.output && session.status !== 'waiting_for_approval'
            ? state.approvals.map((a) =>
                a.sessionId === session.id && a.status === 'pending'
                  ? { ...a, status: 'changes-requested' as const }
                  : a,
              )
            : state.approvals,
  };
}
