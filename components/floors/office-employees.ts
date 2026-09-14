import type { OfficeEmployee } from '../office/office-view';
import type { Employee, Task } from '@/lib/contracts';

/** Maps employees to the 3D office, using their live work for presence. */
export function toOfficeEmployees(employees: Employee[], activeTasks: Task[]): OfficeEmployee[] {
  return employees
    .filter((employee) => employee.status === 'ready')
    .map((employee) => {
      const work = activeTasks.filter((task) => task.employeeId === employee.id);
      return {
        id: employee.id,
        name: employee.name,
        role: employee.role,
        color: employee.color,
        status: work.some((task) => task.status === 'awaiting_approval' || task.status === 'needs_input')
          ? 'review'
          : work.some((task) => task.status === 'running')
            ? 'working'
            : 'ready',
      };
    });
}
