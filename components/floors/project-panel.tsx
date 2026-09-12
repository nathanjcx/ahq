'use client';

import { Archive, Check, LoaderCircle, RotateCcw, Users } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { Employee, Project } from '@/lib/contracts';
import { Sheet } from '../shared/sheet';
import { Avatar } from '../shared/marks';

export function ProjectPanel({
  project,
  employees,
  configured,
  onClose,
  onSave,
  onArchive,
}: {
  project: Project | null;
  employees: Employee[];
  configured: boolean;
  onClose: () => void;
  onSave: (name: string, brief: string, employeeIds: string[]) => Promise<void>;
  onArchive: (project: Project, archived: boolean) => Promise<void>;
}) {
  const [name, setName] = useState(project?.name ?? '');
  const [brief, setBrief] = useState(project?.brief ?? '');
  const [employeeIds, setEmployeeIds] = useState<string[]>(project?.employeeIds ?? []);
  const [busy, setBusy] = useState(false);
  const archived = Boolean(project?.archivedAt);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !brief.trim() || busy) return;
    setBusy(true);
    await onSave(name.trim(), brief.trim(), employeeIds);
    setBusy(false);
  }

  return (
    <Sheet
      title={project ? `Edit ${project.name}` : 'Create project floor'}
      subtitle="A project floor groups its shared brief, staffing, and your private task queue."
      onClose={onClose}
      footer={
        <button
          className="primary-button full"
          type="submit"
          form="project-form"
          disabled={!configured || busy || !name.trim() || !brief.trim()}
        >
          {busy ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}
          {project ? 'Save floor' : 'Create floor'}
        </button>
      }
    >
      <form id="project-form" className="form-stack project-form" onSubmit={save}>
        <label>
          Project name
          <input
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            placeholder="Client research"
            required
          />
        </label>
        <label>
          Project brief
          <textarea
            className="large-textarea"
            value={brief}
            maxLength={5000}
            onChange={(event) => setBrief(event.target.value)}
            placeholder="Describe the mandate, priorities, and standing constraints for this project."
            required
          />
          <small>Shared with your workspace. New tasks receive a copy of this brief.</small>
        </label>
        <fieldset className="staffing-picker">
          <legend>Staff this floor</legend>
          <p>Employees can work on more than one project.</p>
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
      {project && (
        <div className="project-archive-control">
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
              await onArchive(project, !archived);
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
