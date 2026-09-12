'use client';

import { ArrowRight, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Employee, Project } from '@/lib/contracts';
import { Sheet } from '../shared/sheet';

export function NewTaskPanel({
  employees,
  projects,
  defaultEmployee,
  defaultProjectId,
  configured,
  onClose,
  onCreate,
}: {
  employees: Employee[];
  projects: Project[];
  defaultEmployee: string | null;
  defaultProjectId: string | null;
  configured: boolean;
  onClose: () => void;
  onCreate: (employeeId: string, title: string, prompt: string, projectId?: string) => Promise<void>;
}) {
  const activeProjects = projects.filter((project) => !project.archivedAt);
  const [projectId, setProjectId] = useState(
    defaultProjectId && activeProjects.some((project) => project.id === defaultProjectId)
      ? defaultProjectId
      : '',
  );
  const selectedProject = activeProjects.find((project) => project.id === projectId);
  const ready = employees.filter(
    (employee) =>
      employee.status === 'ready' && (!selectedProject || selectedProject.employeeIds.includes(employee.id)),
  );
  const [employeeId, setEmployeeId] = useState(
    defaultEmployee && ready.some((e) => e.id === defaultEmployee) ? defaultEmployee : (ready[0]?.id ?? ''),
  );
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const unavailableProject = Boolean(projectId && !selectedProject);
  useEffect(() => {
    if (!ready.some((employee) => employee.id === employeeId)) setEmployeeId(ready[0]?.id ?? '');
  }, [employeeId, ready]);
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
            unavailableProject ||
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
          if (submitting || unavailableProject || !employeeId || !title.trim() || !prompt.trim()) return;
          setSubmitting(true);
          try {
            await onCreate(employeeId, title.trim(), prompt.trim(), projectId || undefined);
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <label>
          Project floor
          <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            <option value="">Lobby · Unassigned</option>
            {activeProjects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <small>
            {unavailableProject
              ? 'This floor is no longer active. Choose another floor or the lobby.'
              : selectedProject
                ? selectedProject.brief
                : 'This task will stay in the lobby.'}
          </small>
        </label>
        <label>
          Employee
          <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} required>
            <option value="" disabled>
              Select an employee
            </option>
            {ready.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.name} · {employee.role}
              </option>
            ))}
          </select>
          {selectedProject && !ready.length && (
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
