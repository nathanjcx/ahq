'use client';

import { useEffect, useState } from 'react';

/** The one phone breakpoint, matching the stylesheets. */
const NARROW = '(max-width: 640px)';

/**
 * Whether the viewport is phone-sized. Server rendering and the first paint answer false, so use
 * this only where the two layouts need different markup; prefer a media query when CSS can do it.
 */
export function useIsNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(NARROW);
    const sync = () => setNarrow(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);
  return narrow;
}
