'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { LABEL_MODES, type LabelMode } from './office-labels';

const LABEL_KEY = 'ahq.labels';

function stored(): LabelMode | undefined {
  try {
    const value = window.localStorage.getItem(LABEL_KEY);
    return LABEL_MODES.find((mode) => mode === value);
  } catch {
    return undefined;
  }
}

/**
 * One preference for the whole page, kept outside React so the server's render
 * and the browser's first render agree and the stored choice arrives without a
 * second pass. Phones open on dots, because a name pill per person is more than
 * a phone-width stage can hold.
 */
const serverSnapshot = (): LabelMode => 'names';
const listeners = new Set<() => void>();
let mode: LabelMode | undefined;

function snapshot(): LabelMode {
  mode ??= stored() ?? (window.matchMedia('(max-width: 700px)').matches ? 'dots' : 'names');
  return mode;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** What the office shows above its figures. Anything the viewer chooses is remembered. */
export function useLabelMode() {
  const current = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const cycle = useCallback(() => {
    mode = LABEL_MODES[(LABEL_MODES.indexOf(snapshot()) + 1) % LABEL_MODES.length];
    try {
      window.localStorage.setItem(LABEL_KEY, mode);
    } catch {
      // A blocked storage is not worth an error; the control still works for this session.
    }
    listeners.forEach((listener) => listener());
  }, []);
  return { mode: current, cycle };
}
