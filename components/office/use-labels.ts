'use client';

import { useCallback, useEffect, useState } from 'react';
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
 * What the office shows above its figures. Phones open on dots, because a name
 * pill per person is more than a phone-width stage can hold; anything the viewer
 * chooses is remembered.
 */
export function useLabelMode() {
  const [mode, setMode] = useState<LabelMode>('names');
  useEffect(() => {
    const saved = stored();
    if (saved) setMode(saved);
    else if (window.matchMedia('(max-width: 700px)').matches) setMode('dots');
  }, []);
  const cycle = useCallback(() => {
    setMode((current) => {
      const next = LABEL_MODES[(LABEL_MODES.indexOf(current) + 1) % LABEL_MODES.length];
      try {
        window.localStorage.setItem(LABEL_KEY, next);
      } catch {
        // A blocked storage is not worth an error; the control still works for this session.
      }
      return next;
    });
  }, []);
  return { mode, cycle };
}
