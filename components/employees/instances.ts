import { shortTime } from '../shared/time';
import type { Employee, Floor, InstanceStatus } from '@/lib/contracts';

export function isReserved(employee: Employee) {
  return (employee.kind ?? 'worker') !== 'worker';
}

/** Where an instance is in its day, in the words the card and the detail both use. */
export function shiftLabel(status: InstanceStatus | undefined) {
  const shift = status?.shift;
  if (!shift || shift.state === 'off') return 'Off shift';
  if (shift.state === 'running') return `In a ${shift.kind} shift since ${shortTime(shift.startedAt ?? 0)}`;
  return `${status.shiftsToday === 1 ? 'One shift' : `${status.shiftsToday} shifts`} today, none running`;
}

export interface FloorGroup {
  floorId?: string;
  floorName: string;
  employees: Employee[];
}
/** One version of one employee, and the instances of it standing on each floor. */
export interface VersionGroup {
  key: string;
  name: string;
  role: string;
  version: number;
  listingId?: string;
  updateAvailable: boolean;
  floors: FloorGroup[];
}

/**
 * Instances grouped the way the page reads them: by the version they are instances of, and inside
 * that by the floor they stand on. Reserved staff are grouped on their own by `reservedStaff`.
 */
export function groupInstances(employees: Employee[], floors: Floor[]): VersionGroup[] {
  const floorName = (id: string | undefined) =>
    id ? (floors.find((floor) => floor.id === id)?.name ?? 'Archived floor') : 'Lobby';
  const groups = new Map<string, VersionGroup>();
  for (const employee of employees) {
    const key = employee.listingId ?? employee.versionId;
    const group = groups.get(key) ?? {
      key,
      name: employee.instanceOf,
      role: employee.role,
      version: employee.version,
      listingId: employee.listingId,
      updateAvailable: false,
      floors: [],
    };
    group.version = Math.max(group.version, employee.version);
    group.updateAvailable = group.updateAvailable || employee.updateAvailable;
    const floor = group.floors.find((entry) => entry.floorId === employee.floorId);
    if (floor) floor.employees.push(employee);
    else
      group.floors.push({
        floorId: employee.floorId,
        floorName: floorName(employee.floorId),
        employees: [employee],
      });
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      floors: group.floors.sort((a, b) => a.floorName.localeCompare(b.floorName)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The janitor, the auditors, and the triage employees: made by the workspace, never hired. */
export function reservedStaff(employees: Employee[]) {
  return employees.filter(isReserved).sort((a, b) => a.name.localeCompare(b.name));
}
