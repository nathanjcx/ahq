import type { Actions } from './actions';
import type { Destination } from './nav';
import type { Dashboard } from '@/lib/contracts';

/**
 * What the shell hands every page. A page takes what it needs from here; selection state lives in
 * the shell so a link from one page can open a record on another.
 */
export type PageProps = {
  dashboard: Dashboard;
  actions: Actions;
  configured: boolean;
  canManageWorkspace: boolean;
  /** Runs a mutation, shows the success text or the error, and reports whether it succeeded. */
  run: (work: () => Promise<unknown>, success: string) => Promise<boolean>;
  /** Navigates to a destination, or to one of the page ids the interface used to have. */
  go: (page: Destination) => void;
  onNotice: (text: string) => void;
  selectedFloorId: string | null;
  onSelectFloor: (id: string | null) => void;
  selectedEmployee: string | null;
  onSelectEmployee: (id: string | null) => void;
  selectedTask: string | null;
  onSelectTask: (id: string | null) => void;
  selectedProject: string | null;
  onSelectProject: (id: string | null) => void;
  selectedMeeting: string | null;
  onSelectMeeting: (id: string | null) => void;
  onNewTask: (floorId?: string | null, employeeId?: string | null) => void;
};
