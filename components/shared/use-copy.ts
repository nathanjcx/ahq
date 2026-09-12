'use client';

import { useCallback, useState } from 'react';

/** How long the confirmation stays on the button. */
const FLASH_MS = 1500;

/**
 * Puts text on the clipboard and flashes a confirmation. A browser can refuse — an insecure origin,
 * or a permission the person denied — so the refusal is a state the caller can show rather than a
 * silent failure.
 */
export function useCopy() {
  const [state, setState] = useState<'idle' | 'copied' | 'blocked'>('idle');
  const copy = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(
      () => {
        setState('copied');
        window.setTimeout(() => setState('idle'), FLASH_MS);
      },
      () => setState('blocked'),
    );
  }, []);
  return { state, copy };
}
