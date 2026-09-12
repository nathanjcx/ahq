'use client';

import { useState } from 'react';
import { Sheet } from '../shared/sheet';
import type { MemoryBudgets } from '@/lib/contracts';

const fields: { key: keyof MemoryBudgets; label: string; hint: string }[] = [
  { key: 'workspace', label: 'Workspace', hint: 'The tower’s standing orders, injected into every shift.' },
  { key: 'project', label: 'Project', hint: 'Carried by everyone working on the project.' },
  { key: 'floor', label: 'Floor', hint: 'The floor binder, shared by its team.' },
  { key: 'agent', label: 'Employee notebook', hint: 'One instance’s own notes.' },
  { key: 'summaries', label: 'Recent summaries', hint: 'Outcomes of tasks that finished recently.' },
];

/** How many tokens each scope may spend in a working-memory block. Administrators only. */
export function BudgetsSheet({
  budgets,
  onClose,
  onSave,
}: {
  budgets: MemoryBudgets;
  onClose: () => void;
  onSave: (budgets: MemoryBudgets) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(budgets);
  const total = fields.reduce((sum, field) => sum + (draft[field.key] || 0), 0);
  return (
    <Sheet
      title="Memory budgets"
      subtitle="The token ceiling each scope may take in a working-memory block."
      onClose={onClose}
      footer={
        <button className="primary-button full" type="submit" form="budgets-form">
          Save budgets
        </button>
      }
    >
      <form
        id="budgets-form"
        className="form-stack"
        onSubmit={async (event) => {
          event.preventDefault();
          if (await onSave(draft)) onClose();
        }}
      >
        {fields.map((field) => (
          <label key={field.key}>
            {field.label}
            <input
              type="number"
              min="0"
              step="100"
              value={draft[field.key]}
              onChange={(event) =>
                setDraft({ ...draft, [field.key]: Math.max(0, Math.floor(Number(event.target.value) || 0)) })
              }
            />
            <small>{field.hint}</small>
          </label>
        ))}
        <p className="field-hint">
          {total.toLocaleString()} tokens of working memory at most, before the schedule and pacing notes
          every shift also carries.
        </p>
      </form>
    </Sheet>
  );
}
