import { flushSync } from 'react-dom';

/**
 * Runs a state change inside a document view transition where the browser has one and the person
 * has not asked for reduced motion: the old and new page cross-fade on the compositor. Anywhere
 * else the change is a cut, exactly as before.
 */
export function withViewTransition(update: () => void) {
  if (
    typeof document === 'undefined' ||
    !('startViewTransition' in document) ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    update();
    return;
  }
  (document as Document & { startViewTransition: (cb: () => void) => unknown }).startViewTransition(() =>
    flushSync(update),
  );
}
