'use client';

import { CircleHelp, UserPlus } from 'lucide-react';
import { useState } from 'react';
import type { Floor, RoadmapProposal } from '@/lib/contracts';

/** What a bottleneck question is about, in the words the panel uses. */
const KIND_LABEL: Record<RoadmapProposal['prompts'][number]['kind'], string> = {
  capacity: 'Capacity',
  deadline: 'Deadline',
  order: 'Order',
  cost: 'Cost',
};

/** One employee the roadmap would like more of, ready to hire onto a floor. */
export interface HireSuggestion {
  listingId: string;
  name: string;
  floorId: string;
  count: number;
  reason: string;
}

function HireAnswer({
  suggestion,
  floors,
  busy,
  onHire,
}: {
  suggestion: HireSuggestion;
  floors: Floor[];
  busy: boolean;
  onHire: (listingId: string, floorId: string, count: number) => void;
}) {
  const [floorId, setFloorId] = useState(suggestion.floorId);
  const [count, setCount] = useState(suggestion.count);
  return (
    <div className="question-answer">
      <label>
        <span className="sr-only">How many to hire</span>
        <input
          type="number"
          min={1}
          max={20}
          value={count}
          onChange={(event) => setCount(Math.min(20, Math.max(1, Number(event.target.value) || 1)))}
        />
      </label>
      <strong>× {suggestion.name}</strong>
      <label>
        <span className="sr-only">Floor to hire onto</span>
        <select value={floorId} onChange={(event) => setFloorId(event.target.value)}>
          {floors.map((floor) => (
            <option key={floor.id} value={floor.id}>
              {floor.name}
            </option>
          ))}
        </select>
      </label>
      <button
        className="secondary-button compact"
        disabled={busy || !floorId}
        onClick={() => onHire(suggestion.listingId, floorId, count)}
      >
        <UserPlus size={15} />
        Hire
      </button>
      <small>{suggestion.reason}</small>
    </div>
  );
}

function ShiftAnswer({ busy, onShift }: { busy: boolean; onShift: (days: number) => void }) {
  const [days, setDays] = useState(7);
  return (
    <div className="question-answer">
      <span>Move every deadline by</span>
      <label>
        <span className="sr-only">Days to move the deadlines by</span>
        <input
          type="number"
          min={1}
          max={120}
          value={days}
          onChange={(event) => setDays(Math.min(120, Math.max(1, Number(event.target.value) || 1)))}
        />
      </label>
      <span>days</span>
      <button className="secondary-button compact" disabled={busy} onClick={() => onShift(days)}>
        Move
      </button>
    </div>
  );
}

/**
 * The planner's bottleneck questions, each with the control that answers it: hire onto the floor
 * that is short, move the deadlines, or accept the plan as it stands.
 */
export function ProposalQuestions({
  prompts,
  floors,
  suggestions,
  busy,
  onHire,
  onShift,
  onAccept,
}: {
  prompts: RoadmapProposal['prompts'];
  /** The floors this project runs on. */
  floors: Floor[];
  suggestions: HireSuggestion[];
  busy: boolean;
  onHire: (listingId: string, floorId: string, count: number) => void;
  onShift: (days: number) => void;
  onAccept: (index: number) => void;
}) {
  if (!prompts.length) return null;
  return (
    <section className="roadmap-questions">
      <div className="section-title">
        <CircleHelp size={16} />
        <h2>Answer before confirming</h2>
      </div>
      {prompts.map((prompt, index) => (
        <article key={`${prompt.kind}-${prompt.text}`} className="question-card">
          <header>
            <span className="question-kind" data-kind={prompt.kind}>
              {KIND_LABEL[prompt.kind]}
            </span>
            <p>{prompt.text}</p>
          </header>
          {prompt.kind === 'capacity' &&
            suggestions.map((suggestion) => (
              <HireAnswer
                key={`${suggestion.listingId}-${suggestion.floorId}`}
                suggestion={suggestion}
                floors={floors}
                busy={busy}
                onHire={onHire}
              />
            ))}
          {(prompt.kind === 'capacity' || prompt.kind === 'deadline') && (
            <ShiftAnswer busy={busy} onShift={onShift} />
          )}
          <div className="question-foot">
            <button className="text-button" disabled={busy} onClick={() => onAccept(index)}>
              Accept as planned
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
