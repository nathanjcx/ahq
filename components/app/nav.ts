import {
  Activity,
  Archive,
  CalendarDays,
  FileText,
  FolderKanban,
  Inbox,
  LayoutGrid,
  Link2,
  ListTodo,
  ShieldAlert,
  Siren,
  Store,
  Users,
} from 'lucide-react';

export type Page =
  | 'office'
  | 'projects'
  | 'calendar'
  | 'inbox'
  | 'employees'
  | 'tasks'
  | 'files'
  | 'activity'
  | 'records'
  | 'audit'
  | 'triage'
  | 'marketplace'
  | 'integrations'
  | 'admin'
  | 'operations';

export const nav: Array<{ id: Page; label: string; icon: typeof LayoutGrid }> = [
  { id: 'office', label: 'Office', icon: LayoutGrid },
  { id: 'projects', label: 'Projects', icon: FolderKanban },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'inbox', label: 'Inbox', icon: Inbox },
  { id: 'employees', label: 'Employees', icon: Users },
  { id: 'tasks', label: 'Tasks', icon: ListTodo },
  { id: 'files', label: 'Files', icon: FileText },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'records', label: 'Records', icon: Archive },
  { id: 'audit', label: 'Audit', icon: ShieldAlert },
  { id: 'triage', label: 'Triage', icon: Siren },
  { id: 'marketplace', label: 'Marketplace', icon: Store },
  { id: 'integrations', label: 'Integrations', icon: Link2 },
];

export function pageTitle(page: Page) {
  if (page === 'admin') return 'Marketplace admin';
  if (page === 'operations') return 'Operations';
  return nav.find((item) => item.id === page)?.label ?? 'Office';
}
