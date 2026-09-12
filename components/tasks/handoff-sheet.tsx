'use client';

import { ArrowRight } from 'lucide-react';
import { useState } from 'react';
import type { Employee, Task } from '@/lib/contracts';
import { Sheet } from '../shared/sheet';

/** Asks another employee on the same floor to continue this work. The floor board records the request. */
export function HandoffSheet({
  task,
  candidates,
  onClose,
  onSubmit,
}: {
  task: Task;
  candidates: Employee[];
  onClose: () => void;
  onSubmit: (toEmployeeId: string, brief: string) => void;
}) {
  const [toEmployeeId, setToEmployeeId] = useState(candidates[0]?.id ?? '');
  const [brief, setBrief] = useState(`Continue from: ${task.title}`);
  return (
    <Sheet
      title="Hand off this task"
      subtitle="The employee you choose picks up on the same floor once someone accepts the handoff."
      onClose={onClose}
      footer={
        <button
          className="primary-button full"
          type="submit"
          form="handoff-form"
          disabled={!toEmployeeId || !brief.trim()}
        >
          Request handoff
          <ArrowRight size={16} />
        </button>
      }
    >
      <form
        id="handoff-form"
        className="form-stack task-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!toEmployeeId || !brief.trim()) return;
          onSubmit(toEmployeeId, brief.trim());
        }}
      >
        <label>
          Hand off to
          <select
            value={toEmployeeId}
            onChange={(event) => setToEmployeeId(event.target.value)}
            required
            disabled={!candidates.length}
          >
            {candidates.length ? (
              candidates.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.name} · {employee.role}
                </option>
              ))
            ) : (
              <option value="">No other employee is staffed on this floor</option>
            )}
          </select>
        </label>
        <label>
          Brief
          <textarea
            className="large-textarea"
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
            maxLength={5000}
            required
          />
          <small>Say what is done, what is left, and anything the next employee should not repeat.</small>
        </label>
      </form>
    </Sheet>
  );
}
