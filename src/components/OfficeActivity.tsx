import { ArrowRight, History, Radio } from 'lucide-react';
import type { Employee } from '../../shared/types';
import type { OfficeEvent } from '../../shared/office-events';
import { officeAnalogyForTool } from '../../shared/office-tool-atlas';
import './office-activity.css';

const action: Partial<Record<OfficeEvent['kind'], string>> = {
  'session.started': 'Opened an assignment',
  'session.completed': 'Finished the assignment',
  'session.failed': 'Raised a help flag',
  'session.cancelled': 'Stopped work',
  'message.queued': 'Placed an envelope in the out tray',
  'message.delivered': 'Received an envelope in the inbox',
  'message.acknowledged': 'Stamped the message received',
  'memory.proposed': 'Offered a memory card for review',
  'memory.saved': 'Filed a memory card',
  'memory.updated': 'Updated a memory card',
  'memory.forgotten': 'Removed a memory card',
  'artifact.created': 'Placed a document in the out tray',
  'approval.requested': 'Brought work to your desk',
  'approval.decided': 'Received your decision',
  'employee.configured': 'Updated the role charter',
  'reasoning.summary': 'Recorded a progress summary',
};

export default function OfficeActivity({
  events,
  employees,
  replay,
  onReplay,
}: {
  events: OfficeEvent[];
  employees: Employee[];
  replay: boolean;
  onReplay: (at: number) => void;
}) {
  const recent = events
    .filter(
      (event) => event.employeeId && event.kind !== 'session.status' && event.kind !== 'checkpoint.saved',
    )
    .slice(-4)
    .reverse();
  return (
    <section className="team-chat office-activity" aria-label="Recorded office activity">
      <div className="section-heading">
        <h2>
          <Radio size={17} />
          Around the office
        </h2>
        <span className="oa-recorded">{replay ? 'REPLAY' : 'RECORDED'}</span>
      </div>
      <p className="oa-intro">Every movement has a story you can inspect.</p>
      <div className="oa-events">
        {recent.map((event) => {
          const employee = employees.find((person) => person.id === event.employeeId);
          const recipient = employees.find((person) => person.id === event.targetEmployeeId);
          const analogy = event.toolName ? officeAnalogyForTool(event.toolName) : undefined;
          const text =
            action[event.kind] ??
            (event.kind === 'tool.started'
              ? `Using the ${analogy?.object.toLowerCase() ?? 'desk tools'}`
              : event.kind === 'tool.failed'
                ? 'An operation needs attention'
                : event.toolName === 'memory_remember'
                  ? 'Memory request completed'
                  : `${analogy?.label ?? 'Office operation'} completed`);
          const receiverAction = event.kind === 'message.delivered' || event.kind === 'message.acknowledged';
          return (
            <button
              key={event.id}
              className="oa-event"
              onClick={() => onReplay(Math.max(Date.parse(event.occurredAt), Date.parse(event.recordedAt)))}
              aria-label={`Replay event ${event.sequence}: ${text}`}
            >
              <span className={`oa-event-mark ${event.kind.includes('failed') ? 'oa-error' : ''}`}>
                {(receiverAction ? recipient?.name : employee?.name)?.slice(0, 1) ?? 'A'}
              </span>
              <span className="oa-event-copy">
                <span className="oa-byline">
                  <strong>{(receiverAction ? recipient?.name : employee?.name) ?? 'Office'}</strong>
                  <time>
                    {new Date(event.occurredAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </time>
                </span>
                <span>{text}</span>
                {recipient && (
                  <small>
                    {receiverAction ? `From ${employee?.name ?? 'a teammate'}` : `To ${recipient.name}`}
                  </small>
                )}
                <small className="oa-trace">
                  <History size={10} />
                  Event #{event.sequence} · inspect this moment
                  <ArrowRight size={10} />
                </small>
              </span>
            </button>
          );
        })}
        {recent.length === 0 && (
          <div className="oa-empty">
            <Radio size={22} />
            <strong>The next move starts with an assignment.</strong>
            <p>Tool use, filed memories, and teammate handoffs will appear here as they are recorded.</p>
          </div>
        )}
      </div>
    </section>
  );
}
