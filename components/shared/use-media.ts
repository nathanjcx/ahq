'use client';

import { useEffect, useState } from 'react';

/** The one phone breakpoint, matching the stylesheets. */
const NARROW = '(max-width: 640px)';

/**
 * Whether a media query matches. Server rendering and the first paint answer false, so use this only
 * where two layouts need different markup; prefer a media query when CSS can do it.
 */
export function useMedia(query: string) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(query);
    const sync = () => setMatches(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, [query]);
  return matches;
}

/** Whether the viewport is phone-sized. */
export function useIsNarrow() {
  return useMedia(NARROW);
}
