'use client';

import { ChevronLeft } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useIsNarrow } from './use-media';

/**
 * Tracks whether the detail pane is the thing on screen. Desktop shows both panes at once, so it
 * never opens and never touches history; a phone pushes an entry when the detail opens, so the
 * browser back button returns to the list.
 */
export function useMasterDetail() {
  const narrow = useIsNarrow();
  const [wanted, setOpen] = useState(false);
  const open = narrow && wanted;

  useEffect(() => {
    if (!open) return;
    window.history.pushState({ ahqDetail: true }, '');
    const onPopState = () => setOpen(false);
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
      // Only ours to remove: a popstate already took it off the stack before this ran.
      if (window.history.state?.ahqDetail) window.history.back();
    };
  }, [open]);

  const close = useCallback(() => {
    if (window.history.state?.ahqDetail) window.history.back();
    else setOpen(false);
  }, []);

  return { open, openDetail: useCallback(() => setOpen(true), []), closeDetail: close };
}

/**
 * Two panes on a desktop, one at a time on a phone. The list is the default view; opening an item
 * replaces it with the detail behind a back header.
 */
export function MasterDetail({
  className = '',
  open,
  backLabel,
  onBack,
  list,
  detail,
}: {
  /** Layout classes for the pair, for example `task-layout card`. */
  className?: string;
  open: boolean;
  /** What the back button returns to, for example `Tasks`. */
  backLabel: string;
  onBack: () => void;
  list: ReactNode;
  detail: ReactNode;
}) {
  return (
    <div className={`master-detail ${className}`} data-detail={open ? 'open' : 'closed'}>
      <div className="md-list">{list}</div>
      <div className="md-detail">
        <button type="button" className="md-back" onClick={onBack}>
          <ChevronLeft size={16} />
          {backLabel}
        </button>
        {detail}
      </div>
    </div>
  );
}
