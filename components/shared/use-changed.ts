'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * True for a moment after `value` changes, never on mount. A row uses it to pulse once when the
 * live subscription moves it, so a change is seen without a timer or a re-render elsewhere.
 */
export function useChanged(value: string, ms = 700): boolean {
  const previous = useRef(value);
  const [changed, setChanged] = useState(false);
  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    setChanged(true);
    const timer = setTimeout(() => setChanged(false), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return changed;
}
