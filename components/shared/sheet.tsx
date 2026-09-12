'use client';

import { X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode, type TouchEvent } from 'react';

/** Past this far down, letting go dismisses the sheet instead of snapping it back. */
const DISMISS_AT = 90;

export function Sheet({
  title,
  subtitle,
  onClose,
  children,
  footer,
  wide = false,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: ReactNode;
  /** The primary action, pinned to the bottom of the sheet on every viewport. */
  footer?: ReactNode;
  wide?: boolean;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const dragFrom = useRef<number | null>(null);
  const [drag, setDrag] = useState(0);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), video[controls], [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!panel.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  /** Swipe down on the handle or the header to dismiss. Upward drag does nothing. */
  const onTouchStart = (event: TouchEvent) => {
    dragFrom.current = event.touches[0].clientY;
  };
  const onTouchMove = (event: TouchEvent) => {
    if (dragFrom.current === null) return;
    setDrag(Math.max(0, event.touches[0].clientY - dragFrom.current));
  };
  const onTouchEnd = () => {
    dragFrom.current = null;
    if (drag > DISMISS_AT) onClose();
    setDrag(0);
  };

  return (
    <div className="sheet-layer">
      <button className="sheet-scrim" tabIndex={-1} aria-label="Close panel" onClick={onClose} />
      <aside
        ref={panelRef}
        className={`sheet ${wide ? 'sheet-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={drag ? { transform: `translateY(${drag}px)`, transition: 'none' } : undefined}
      >
        <span
          className="sheet-handle"
          aria-hidden="true"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        />
        <header onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
          <div>
            <span className="eyebrow">ASTRA HQ</span>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          <button ref={closeRef} className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-footer">{footer}</div>}
      </aside>
    </div>
  );
}
