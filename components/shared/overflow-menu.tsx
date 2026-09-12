'use client';

import { MoreHorizontal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export type OverflowAction = {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
};

/** The actions of a row, folded into one touchable control where a row of text buttons will not fit. */
export function OverflowMenu({ label, actions }: { label: string; actions: OverflowAction[] }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  return (
    <div
      className="overflow-menu"
      ref={wrapperRef}
      onKeyDown={(event) => event.key === 'Escape' && setOpen(false)}
    >
      <button
        type="button"
        className="icon-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen(!open)}
      >
        <MoreHorizontal size={18} />
      </button>
      {open && (
        <div className="overflow-options" role="menu" aria-label={label}>
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              disabled={action.disabled}
              className={action.danger ? 'danger-text' : undefined}
              onClick={() => {
                setOpen(false);
                action.onSelect();
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
