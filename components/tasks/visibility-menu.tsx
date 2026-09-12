'use client';

import { Check, ChevronDown, Lock, Users } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { TaskVisibility } from '@/lib/contracts';

const OPTIONS: { value: TaskVisibility; label: string }[] = [
  { value: 'private', label: 'Private' },
  { value: 'workspace', label: 'Shared with workspace' },
];

/** Who can see one task. Only its owner sees this control. */
export function VisibilityMenu({
  visibility,
  onChange,
}: {
  visibility: TaskVisibility;
  onChange: (visibility: TaskVisibility) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const current = OPTIONS.find((option) => option.value === visibility) ?? OPTIONS[0];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && open) {
      event.stopPropagation();
      setOpen(false);
      wrapperRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = Array.from(
      wrapperRef.current?.querySelectorAll<HTMLButtonElement>('[role=menuitemradio]') ?? [],
    );
    if (!items.length) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'ArrowDown' ? index + 1 : index - 1;
    items[(next + items.length) % items.length].focus();
  }

  return (
    <div className="visibility-menu" ref={wrapperRef} onKeyDown={keyDown}>
      <button
        type="button"
        className="visibility-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Task visibility: ${current.label}`}
        onClick={() => setOpen(!open)}
      >
        {visibility === 'workspace' ? <Users size={13} /> : <Lock size={13} />}
        {current.label}
        <ChevronDown size={13} />
      </button>
      {open && (
        <div className="visibility-options" role="menu" aria-label="Task visibility">
          {OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={option.value === visibility}
              onClick={() => {
                setOpen(false);
                if (option.value !== visibility) onChange(option.value);
              }}
            >
              <span>{option.value === visibility && <Check size={13} />}</span>
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
