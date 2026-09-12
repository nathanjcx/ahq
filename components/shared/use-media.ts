'use client';

import { useEffect, useState } from 'react';

/**
 * Whether the viewport is phone-sized. Server rendering and the first paint answer false, so use
 * this only where the two layouts need different markup; prefer a media query when CSS can do it.
 */
export function useIsNarrow(query = '(max-width: 640px)') {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(query);
    const sync = () => setNarrow(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, [query]);
  return narrow;
}
