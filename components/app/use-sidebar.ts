'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Route } from './nav';

export type SidebarMode = 'rail' | 'expanded';
const KEY = 'ahq.sidebar';

/** Pages where the content is the point, so the sidebar rests as a rail unless pinned open. */
function restingMode(route: Route): SidebarMode {
  if (route.page === 'office' && route.tab !== '2d') return 'rail';
  if (route.page === 'work' && route.tab === 'threads') return 'rail';
  return 'expanded';
}

/**
 * The sidebar's width: a pinned preference if the person set one, otherwise the page's resting
 * mode. The preference lives in this browser; `[` toggles it from anywhere but a field.
 */
const listeners = new Set<() => void>();
function readPinned(): SidebarMode | null {
  const stored = window.localStorage.getItem(KEY);
  return stored === 'rail' || stored === 'expanded' ? stored : null;
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}
function writePinned(mode: SidebarMode) {
  window.localStorage.setItem(KEY, mode);
  for (const listener of listeners) listener();
}

export function useSidebarMode(route: Route) {
  // The stored preference is an external store: read on the client, absent on the server.
  const pinned = useSyncExternalStore(subscribe, readPinned, () => null);
  const mode = pinned ?? restingMode(route);
  const toggle = useCallback(() => writePinned(mode === 'rail' ? 'expanded' : 'rail'), [mode]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '[' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName))) return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggle]);
  return { mode, pinned: pinned !== null, toggle };
}

/** Whether the pointer has rested on the rail long enough to mean it, and left it long enough to be gone. */
export function useHoverIntent(enabled: boolean, openAfter = 150, closeAfter = 250) {
  const [hovering, setHovering] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const arm = useCallback(
    (next: boolean) => {
      if (timer.current) clearTimeout(timer.current);
      if (!enabled) return;
      timer.current = setTimeout(() => setHovering(next), next ? openAfter : closeAfter);
    },
    [enabled, openAfter, closeAfter],
  );
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return {
    hovering: enabled && hovering,
    enter: useCallback(() => arm(true), [arm]),
    leave: useCallback(() => arm(false), [arm]),
  };
}
