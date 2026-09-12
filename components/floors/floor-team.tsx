'use client';

import { Pencil, Plus, Users } from 'lucide-react';
import type { Employee } from '@/lib/contracts';
import type { OfficeEmployee } from '../office/office-view';
import { EmptyMini } from '../shared/empty';
import { Avatar } from '../shared/marks';
import { FloorScene } from './floor-scene';

export function FloorTeam({
  floorName,
  archived,
  staff,
  officeEmployees,
  canAssign,
  onEmployee,
  onNewTask,
  onEditProject,
}: {
  floorName: string;
  archived: boolean;
  staff: Employee[];
  officeEmployees: OfficeEmployee[];
  canAssign: boolean;
  onEmployee: (id: string) => void;
  onNewTask: (employeeId: string) => void;
  onEditProject: () => void;
}) {
  return (
    <>
      <FloorScene
        label={floorName}
        archived={archived}
        compact
        employeeCount={staff.length}
        officeEmployees={officeEmployees}
        emptyMessage={
          staff.length
            ? 'This team needs its connections set up. Select an employee to review access.'
            : 'This floor is ready. Edit the floor to add its project team.'
        }
        onEmployee={onEmployee}
      />
      <div className="floor-team">
        <div className="section-title">
          <div>
            <span className="eyebrow">STAFFING</span>
            <h3>Project team</h3>
          </div>
          <span className="staff-count">{staff.length}</span>
        </div>
        {staff.length ? (
          <div className="floor-team-list">
            {staff.map((employee) => (
              <div key={employee.id} className="team-row">
                <button className="team-open" onClick={() => onEmployee(employee.id)}>
                  <Avatar employee={employee} />
                  <span>
                    <strong>{employee.name}</strong>
                    <small>{employee.role}</small>
                  </span>
                  <span className={`availability ${employee.status === 'ready' ? '' : 'busy'}`}>
                    {employee.status}
                  </span>
                </button>
                <button
                  className="icon-button"
                  title={`Assign work to ${employee.name}`}
                  aria-label={`Assign work to ${employee.name}`}
                  disabled={!canAssign || employee.status !== 'ready'}
                  onClick={() => onNewTask(employee.id)}
                >
                  <Plus size={15} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <EmptyMini
            icon={<Users size={19} />}
            title="No one staffed yet"
            text="Edit this floor to add one or more employees."
          />
        )}
        <button className="floor-team-edit" onClick={onEditProject}>
          <Pencil size={14} /> {archived ? 'Manage floor' : 'Edit staffing'}
        </button>
      </div>
    </>
  );
}
