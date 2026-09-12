'use client';

import { MessageSquareText } from 'lucide-react';
import { EmptyMini } from '../shared/empty';
import { shortTime } from '../shared/time';
import { totalUsage, usageLine } from './usage';
import type { Attendee, MeetingTurn } from '@/lib/contracts';

/** Who a question was put to. A question with nobody named is put to the room. */
function addressLine(turn: MeetingTurn, attendees: Attendee[]) {
  if (!turn.addressedTo?.length) return 'Asked the room';
  const names = turn.addressedTo.map(
    (id) => attendees.find((attendee) => attendee.id === id)?.name ?? 'an attendee',
  );
  return `Asked ${names.join(' and ')}`;
}

/** The preparation each attendee wrote against the agenda, folded away until it is wanted. */
export function PrepReports({ reports }: { reports: MeetingTurn[] }) {
  if (!reports.length) return null;
  return (
    <section className="meeting-section">
      <h3>Preparation</h3>
      {reports.map((report) => (
        <details key={report.id} className="meeting-report">
          <summary>
            <strong>{report.authorName}</strong>
            <small>{shortTime(report.createdAt)}</small>
          </summary>
          <p>{report.text}</p>
        </details>
      ))}
    </section>
  );
}

/**
 * The meeting as it was spoken: each question with the answers it drew, and what the room spent
 * getting them. Answers sit under the question they reply to, whoever answered first.
 */
export function Transcript({
  turns,
  attendees,
}: {
  turns: MeetingTurn[];
  attendees: Attendee[];
}) {
  const questions = turns.filter((turn) => turn.kind === 'question');
  if (!questions.length)
    return (
      <section className="meeting-section">
        <h3>Transcript</h3>
        <EmptyMini
          icon={<MessageSquareText size={18} />}
          title="Nothing asked yet"
          text="Read the preparation, then put a question to the room or to one attendee."
        />
      </section>
    );
  return (
    <section className="meeting-section">
      <h3>Transcript</h3>
      {questions.map((question) => {
        const answers = turns.filter((turn) => turn.kind === 'answer' && turn.inReplyTo === question.id);
        const usage = totalUsage([question.usage, ...answers.map((answer) => answer.usage)]);
        return (
          <article key={question.id} className="meeting-exchange">
            <div className="meeting-question">
              <span className="eyebrow">
                {question.authorName} · {addressLine(question, attendees)}
              </span>
              <p>{question.text}</p>
              <time>{shortTime(question.createdAt)}</time>
            </div>
            {answers.map((answer) => (
              <div key={answer.id} className="meeting-answer">
                <span className="eyebrow">{answer.authorName}</span>
                <p>{answer.text}</p>
                <time>{shortTime(answer.createdAt)}</time>
              </div>
            ))}
            {!answers.length && <p className="meeting-pending">Waiting on the room…</p>}
            {usage && <p className="meeting-usage">{usageLine(usage)}</p>}
          </article>
        );
      })}
    </section>
  );
}
