import {
  Archive,
  Building2,
  CalendarRange,
  Inbox,
  Link2,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';

/** The six destinations plus platform admin. Everything the product does lives under one of them. */
export type Page = 'work' | 'office' | 'team' | 'plan' | 'records' | 'integrations' | 'admin';

export type TabSpec = { id: string; label: string };

export const destinations: Array<{ id: Page; label: string; icon: LucideIcon; tabs: TabSpec[] }> = [
  {
    id: 'work',
    label: 'Work',
    icon: Inbox,
    tabs: [
      { id: 'threads', label: 'Threads' },
      { id: 'inbox', label: 'Inbox' },
      { id: 'incidents', label: 'Incidents' },
    ],
  },
  { id: 'office', label: 'Office', icon: Building2, tabs: [] },
  {
    id: 'team',
    label: 'Team',
    icon: Users,
    tabs: [
      { id: 'employees', label: 'Employees' },
      { id: 'hire', label: 'Hire' },
    ],
  },
  {
    id: 'plan',
    label: 'Plan',
    icon: CalendarRange,
    tabs: [
      { id: 'projects', label: 'Projects' },
      { id: 'calendar', label: 'Calendar' },
    ],
  },
  {
    id: 'records',
    label: 'Records',
    icon: Archive,
    tabs: [
      { id: 'files', label: 'Files' },
      { id: 'activity', label: 'Activity' },
      { id: 'memory', label: 'Memory' },
      { id: 'audit', label: 'Audit' },
    ],
  },
  { id: 'integrations', label: 'Integrations', icon: Link2, tabs: [] },
  {
    id: 'admin',
    label: 'Platform admin',
    icon: ShieldCheck,
    tabs: [
      { id: 'marketplace', label: 'Marketplace' },
      { id: 'operations', label: 'Operations' },
    ],
  },
];

/** The page ids the interface used before the six destinations; links inside pages still name them. */
export type LegacyPage =
  | 'tasks'
  | 'inbox'
  | 'triage'
  | 'employees'
  | 'marketplace'
  | 'projects'
  | 'calendar'
  | 'files'
  | 'activity'
  | 'audit'
  | 'operations';

export type Destination = Page | LegacyPage;

export type Route = { page: Page; tab?: string };

const LEGACY: Record<LegacyPage, Route> = {
  tasks: { page: 'work', tab: 'threads' },
  inbox: { page: 'work', tab: 'inbox' },
  triage: { page: 'work', tab: 'incidents' },
  employees: { page: 'team', tab: 'employees' },
  marketplace: { page: 'team', tab: 'hire' },
  projects: { page: 'plan', tab: 'projects' },
  calendar: { page: 'plan', tab: 'calendar' },
  files: { page: 'records', tab: 'files' },
  activity: { page: 'records', tab: 'activity' },
  audit: { page: 'records', tab: 'audit' },
  operations: { page: 'admin', tab: 'operations' },
};

/** A hash or a legacy id, resolved to a destination and one of its tabs. Null for anything else. */
export function resolveRoute(value: string): Route | null {
  const [head, tail] = value.split('/');
  if (head in LEGACY) return LEGACY[head as LegacyPage];
  const destination = destinations.find((item) => item.id === head);
  if (!destination) return null;
  const tab = destination.tabs.find((item) => item.id === tail)?.id ?? destination.tabs[0]?.id;
  return tab ? { page: destination.id, tab } : { page: destination.id };
}

export function routeHash(route: Route) {
  return route.tab ? `${route.page}/${route.tab}` : route.page;
}

export function pageTitle(page: Page) {
  return destinations.find((item) => item.id === page)?.label ?? 'Work';
}

export function pageTabs(page: Page): TabSpec[] {
  return destinations.find((item) => item.id === page)?.tabs ?? [];
}
