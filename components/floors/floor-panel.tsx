'use client';

import { Archive, Check, LoaderCircle, RotateCcw, Users } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Avatar } from '../shared/marks';
import { Sheet } from '../shared/sheet';
import type { Employee, Floor } from '@/lib/contracts';

export function FloorPanel({
  floor,
  employees,
  configured,
  onClose,
  onSave,
  onArchive,
}: {
  floor: Floor | null;
  employees: Employee[];
  configured: boolean;
  onClose: () => void;
  onSave: (name: string, brief: string, employeeIds: string[]) => Promise<void>;
  onArchive: (floor: Floor, archived: boolean) => Promise<void>;
}) {
  const [name, setName] = useState(floor?.name ?? '');
  const [brief, setBrief] = useState(floor?.brief ?? '');
  const [employeeIds, setEmployeeIds] = useState<string[]>(floor?.employeeIds ?? []);
  const [busy, setBusy] = useState(false);
  const archived = Boolean(floor?.archivedAt);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !brief.trim() || busy) return;
    setBusy(true);
    await onSave(name.trim(), brief.trim(), employeeIds);
    setBusy(false);
  }

  return (
    <Sheet
      title={floor ? `Edit ${floor.name}` : 'Create floor'}
      subtitle="A floor groups its shared brief, staffing, and your private task queue."
      onClose={onClose}
      footer={
        <button
          className="primary-button full"
          type="submit"
          form="floor-form"
          disabled={!configured || busy || !name.trim() || !brief.trim()}
        >
          {busy ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}
          {floor ? 'Save floor' : 'Create floor'}
        </button>
      }
    >
      <form id="floor-form" className="form-stack floor-form" onSubmit={save}>
        <label>
          Floor name
          <input
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            placeholder="Client research"
            required
          />
        </label>
        <label>
          Floor brief
          <textarea
            className="large-textarea"
            value={brief}
            maxLength={5000}
            onChange={(event) => setBrief(event.target.value)}
            placeholder="Describe the mandate, priorities, and standing constraints for this floor."
            required
          />
          <small>Shared with your workspace. New tasks receive a copy of this brief.</small>
        </label>
        <fieldset className="staffing-picker">
          <legend>Staff this floor</legend>
          <p>Employees can work on more than one floor.</p>
          {employees.length ? (
            <div>
              {employees.map((employee) => {
                const checked = employeeIds.includes(employee.id);
                return (
                  <label key={employee.id} data-checked={checked}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setEmployeeIds((current) =>
                          checked ? current.filter((id) => id !== employee.id) : [...current, employee.id],
                        )
                      }
                    />
                    <Avatar employee={employee} />
                    <span>
                      <strong>{employee.name}</strong>
                      <small>{employee.role}</small>
                    </span>
                    <Check size={15} />
                  </label>
                );
              })}
            </div>
          ) : (
            <div className="staffing-picker-empty">
              <Users size={18} /> Hire an employee before staffing this floor.
            </div>
          )}
        </fieldset>
      </form>
      {floor && (
        <div className="floor-archive-control">
          <div>
            <strong>{archived ? 'Restore this floor' : 'Archive this floor'}</strong>
            <p>
              {archived
                ? 'Restoring returns it to the building directory and task forms.'
                : 'Archived floors stay available for history and can be restored.'}
            </p>
          </div>
          <button
            className="secondary-button"
            disabled={busy || !configured}
            onClick={async () => {
              setBusy(true);
              await onArchive(floor, !archived);
              setBusy(false);
            }}
          >
            {archived ? <RotateCcw size={15} /> : <Archive size={15} />}
            {archived ? 'Restore' : 'Archive'}
          </button>
        </div>
      )}
    </Sheet>
  );
}
