'use client';

import { ArrowRight, FileText } from 'lucide-react';
import { EmptyMini } from '../shared/empty';
import type { Artifact, TaskSummary } from '@/lib/contracts';

function Points({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="dossier-points">
      <span className="eyebrow">{title}</span>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

/** The structured outcome of a finished task: what it settled, what it left open, what it produced. */
export function TaskDossier({
  summary,
  artifacts,
  onOpenTask,
}: {
  summary: TaskSummary | null;
  artifacts: Artifact[];
  onOpenTask: () => void;
}) {
  if (!summary)
    return (
      <EmptyMini
        icon={<FileText size={18} />}
        title="No dossier yet"
        text="A summary is written when the task finishes, or inferred from its journal."
      />
    );
  const produced = artifacts.filter((artifact) => summary.artifactIds.includes(artifact.id));
  return (
    <section className="task-dossier">
      <div className="dossier-head">
        <span className="eyebrow">OUTCOME{summary.inferred ? ' · INFERRED' : ''}</span>
        <button className="text-button" onClick={onOpenTask}>
          Open the task <ArrowRight size={14} />
        </button>
      </div>
      <p className="dossier-outcome">{summary.outcome}</p>
      {summary.text && <p className="dossier-text">{summary.text}</p>}
      <Points title="DECISIONS" items={summary.decisions} />
      <Points title="OPEN QUESTIONS" items={summary.openQuestions} />
      {produced.length > 0 && (
        <div className="dossier-points">
          <span className="eyebrow">ARTIFACTS</span>
          <ul>
            {produced.map((artifact) => (
              <li key={artifact.id}>{artifact.name}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
