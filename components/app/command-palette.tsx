'use client';

import {
  Archive,
  Building2,
  CalendarRange,
  FileText,
  Inbox,
  ListTodo,
  Search,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Avatar } from '../shared/marks';
import { destinations, type Destination } from './nav';
import type { Dashboard } from '@/lib/contracts';

type Hit = {
  id: string;
  kind: 'page' | 'employee' | 'task' | 'floor' | 'file';
  title: string;
  detail: string;
  icon?: LucideIcon;
  employeeId?: string;
  run: () => void;
};

const PAGE_ICONS: Record<string, LucideIcon> = {
  work: Inbox,
  office: Building2,
  team: Users,
  plan: CalendarRange,
  records: Archive,
};

/** Scores a hit: a prefix match first, then a word match, then anywhere. */
function score(needle: string, text: string) {
  const hay = text.toLowerCase();
  if (hay.startsWith(needle)) return 3;
  if (hay.split(/\s+/).some((word) => word.startsWith(needle))) return 2;
  if (hay.includes(needle)) return 1;
  return 0;
}

/**
 * Search across the workspace: pages, employees, tasks, floors, and files. Opens with ⌘K or the
 * search button; Enter opens the chosen hit. Everything here is the dashboard, so it needs no query.
 */
export function CommandPalette({
  dashboard,
  onClose,
  go,
  onSelectEmployee,
  onSelectTask,
  onSelectFloor,
}: {
  dashboard: Dashboard;
  onClose: () => void;
  go: (page: Destination, tab?: string) => void;
  onSelectEmployee: (id: string) => void;
  onSelectTask: (id: string) => void;
  onSelectFloor: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const hits = useMemo<Hit[]>(() => {
    const needle = query.trim().toLowerCase();
    const all: Array<Hit & { rank: number }> = [];
    const push = (hit: Hit, text: string, base = 0) => {
      const rank = needle ? score(needle, text) : 1;
      if (rank) all.push({ ...hit, rank: rank * 10 + base });
    };
    for (const page of destinations)
      if (page.id !== 'admin' || dashboard.isPlatformAdmin)
        push(
          {
            id: `page:${page.id}`,
            kind: 'page',
            title: page.label,
            detail: 'Go to',
            icon: PAGE_ICONS[page.id] ?? page.icon,
            run: () => go(page.id),
          },
          page.label,
          1,
        );
    for (const employee of dashboard.employees)
      push(
        {
          id: `employee:${employee.id}`,
          kind: 'employee',
          title: employee.name,
          detail: employee.role,
          employeeId: employee.id,
          run: () => {
            onSelectEmployee(employee.id);
            go('team', 'employees');
          },
        },
        `${employee.name} ${employee.role}`,
        3,
      );
    for (const task of dashboard.tasks)
      if (!task.kind || task.kind === 'work')
        push(
          {
            id: `task:${task.id}`,
            kind: 'task',
            title: task.title,
            detail: `${task.employeeName} · ${task.status.replace('_', ' ')}`,
            icon: ListTodo,
            run: () => {
              onSelectTask(task.id);
              go('work', 'threads');
            },
          },
          `${task.title} ${task.employeeName}`,
          2,
        );
    for (const floor of dashboard.floors)
      if (!floor.archivedAt)
        push(
          {
            id: `floor:${floor.id}`,
            kind: 'floor',
            title: floor.name,
            detail: 'Floor',
            icon: Building2,
            run: () => {
              onSelectFloor(floor.id);
              go('office');
            },
          },
          floor.name,
          2,
        );
    for (const artifact of dashboard.artifacts)
      push(
        {
          id: `file:${artifact.id}`,
          kind: 'file',
          title: artifact.name,
          detail: 'File',
          icon: FileText,
          run: () => go('records', 'files'),
        },
        artifact.name,
        1,
      );
    return all.sort((a, b) => b.rank - a.rank).slice(0, 12);
  }, [query, dashboard, go, onSelectEmployee, onSelectTask, onSelectFloor]);

  const choose = (hit: Hit) => {
    hit.run();
    onClose();
  };

  return (
    <>
      <button className="palette-scrim" tabIndex={-1} aria-label="Close search" onClick={onClose} />
      <div className="palette" role="dialog" aria-label="Search">
        <div className="palette-input">
          <Search size={16} />
          <input
            ref={input}
            value={query}
            placeholder="Search pages, employees, tasks, floors, files…"
            onChange={(event) => {
              setQuery(event.target.value);
              setIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose();
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setIndex((current) => Math.min(current + 1, hits.length - 1));
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setIndex((current) => Math.max(current - 1, 0));
              }
              if (event.key === 'Enter' && hits[index]) choose(hits[index]);
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <ul className="palette-list" role="listbox">
          {hits.map((hit, position) => {
            const employee = hit.employeeId
              ? dashboard.employees.find((item) => item.id === hit.employeeId)
              : undefined;
            const Icon = hit.icon;
            return (
              <li key={hit.id} role="option" aria-selected={position === index}>
                <button onMouseEnter={() => setIndex(position)} onClick={() => choose(hit)}>
                  {employee ? <Avatar employee={employee} /> : Icon ? <Icon size={16} /> : null}
                  <span>
                    <b>{hit.title}</b>
                    <small>{hit.detail}</small>
                  </span>
                </button>
              </li>
            );
          })}
          {!hits.length && <li className="palette-empty">Nothing matches.</li>}
        </ul>
      </div>
    </>
  );
}
