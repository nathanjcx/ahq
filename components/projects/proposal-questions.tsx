'use client';

import { CircleHelp, UserPlus } from 'lucide-react';
import { useState } from 'react';
import type { RoadmapProposal } from '@/lib/contracts';

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
  floorName: string;
  count: number;
  reason: string;
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
 * that is short, move the deadlines, or accept the plan as it stands. Hiring opens the workspace's
 * own hire sheet, so a roadmap hire asks the same questions and obeys the same policy as any other.
 */
export function ProposalQuestions({
  prompts,
  suggestions,
  busy,
  onHire,
  onShift,
  onAccept,
}: {
  prompts: RoadmapProposal['prompts'];
  suggestions: HireSuggestion[];
  busy: boolean;
  /** Opens the hire sheet on this suggestion, which is where the hire is settled. */
  onHire: (suggestion: HireSuggestion) => void;
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
              <div className="question-answer" key={`${suggestion.listingId}-${suggestion.floorId}`}>
                <button
                  className="secondary-button compact"
                  disabled={busy}
                  onClick={() => onHire(suggestion)}
                >
                  <UserPlus size={15} />
                  Hire {suggestion.count} × {suggestion.name} onto {suggestion.floorName}
                </button>
                <small>{suggestion.reason}</small>
              </div>
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
