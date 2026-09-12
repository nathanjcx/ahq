import { Activity, FileText, Inbox, LayoutGrid, Link2, ListTodo, Store, Users } from 'lucide-react';

export type Page =
  | 'office'
  | 'inbox'
  | 'employees'
  | 'tasks'
  | 'files'
  | 'activity'
  | 'marketplace'
  | 'integrations'
  | 'admin';

export const nav: Array<{ id: Page; label: string; icon: typeof LayoutGrid }> = [
  { id: 'office', label: 'Office', icon: LayoutGrid },
  { id: 'inbox', label: 'Inbox', icon: Inbox },
  { id: 'employees', label: 'Employees', icon: Users },
  { id: 'tasks', label: 'Tasks', icon: ListTodo },
  { id: 'files', label: 'Files', icon: FileText },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'marketplace', label: 'Marketplace', icon: Store },
  { id: 'integrations', label: 'Integrations', icon: Link2 },
];

export function pageTitle(page: Page) {
  return page === 'admin' ? 'Marketplace admin' : (nav.find((item) => item.id === page)?.label ?? 'Office');
}
