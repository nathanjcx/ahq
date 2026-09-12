'use client';

import { ArrowRight, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Sheet } from '../shared/sheet';
import type { Employee, Floor } from '@/lib/contracts';

export function NewTaskPanel({
  employees,
  floors,
  defaultEmployee,
  defaultFloorId,
  configured,
  onClose,
  onCreate,
}: {
  employees: Employee[];
  floors: Floor[];
  defaultEmployee: string | null;
  defaultFloorId: string | null;
  configured: boolean;
  onClose: () => void;
  onCreate: (employeeId: string, title: string, prompt: string, floorId?: string) => Promise<void>;
}) {
  const activeFloors = floors.filter((floor) => !floor.archivedAt);
  const [floorId, setFloorId] = useState(
    defaultFloorId && activeFloors.some((floor) => floor.id === defaultFloorId) ? defaultFloorId : '',
  );
  const selectedFloor = activeFloors.find((floor) => floor.id === floorId);
  const ready = employees.filter(
    (employee) =>
      employee.status === 'ready' && (!selectedFloor || selectedFloor.employeeIds.includes(employee.id)),
  );
  const [chosen, setChosen] = useState(
    defaultEmployee && ready.some((e) => e.id === defaultEmployee) ? defaultEmployee : '',
  );
  // Changing floor narrows the list, so the choice falls back to the first person still on it.
  const employeeId = ready.some((employee) => employee.id === chosen) ? chosen : (ready[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const unavailableFloor = Boolean(floorId && !selectedFloor);
  return (
    <Sheet
      title="Assign new work"
      subtitle="Describe the outcome. Your employee will ask for review before sensitive external actions."
      onClose={onClose}
      footer={
        <button
          className="primary-button full"
          type="submit"
          form="new-task-form"
          disabled={
            !configured ||
            !employeeId ||
            !ready.length ||
            submitting ||
            unavailableFloor ||
            !title.trim() ||
            !prompt.trim()
          }
        >
          {submitting ? 'Starting task…' : employees.length ? 'Start task' : 'Hire an employee first'}
          <ArrowRight size={16} />
        </button>
      }
    >
      <form
        id="new-task-form"
        className="form-stack task-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (submitting || unavailableFloor || !employeeId || !title.trim() || !prompt.trim()) return;
          setSubmitting(true);
          try {
            await onCreate(employeeId, title.trim(), prompt.trim(), floorId || undefined);
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <label>
          Floor
          <select value={floorId} onChange={(event) => setFloorId(event.target.value)}>
            <option value="">Lobby · Unassigned</option>
            {activeFloors.map((floor) => (
              <option key={floor.id} value={floor.id}>
                {floor.name}
              </option>
            ))}
          </select>
          <small>
            {unavailableFloor
              ? 'This floor is no longer active. Choose another floor or the lobby.'
              : selectedFloor
                ? selectedFloor.brief
                : 'This task will stay in the lobby.'}
          </small>
        </label>
        <label>
          Employee
          <select value={employeeId} onChange={(e) => setChosen(e.target.value)} required>
            <option value="" disabled>
              Select an employee
            </option>
            {ready.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.name} · {employee.role}
              </option>
            ))}
          </select>
          {selectedFloor && !ready.length && (
            <small>Add a ready employee to this floor before assigning work.</small>
          )}
        </label>
        <label>
          Task title
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Prepare the weekly customer review"
            maxLength={200}
            required
          />
        </label>
        <label>
          What needs to be done?
          <textarea
            className="large-textarea"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Include the outcome, relevant context, and any limits the employee should respect."
            maxLength={50000}
            required
          />
        </label>
        <div className="task-safety">
          <ShieldCheck size={16} />
          <span>External writes still follow workspace permissions and action review rules.</span>
        </div>
      </form>
    </Sheet>
  );
}
