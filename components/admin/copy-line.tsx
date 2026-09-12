'use client';

import { Check, Copy } from 'lucide-react';
import { useCopy } from '../shared/use-copy';

/** A URL an administrator has to paste into a provider console, with a copy button. */
export function CopyLine({ label, value }: { label: string; value: string }) {
  const { state, copy } = useCopy();
  return (
    <div className="ops-copy">
      <span>
        <small>{label}</small>
        <code>{value || 'Available once the page loads in a browser'}</code>
      </span>
      <button
        type="button"
        className="secondary-button compact"
        disabled={!value}
        onClick={() => copy(value)}
      >
        {state === 'copied' ? <Check size={13} /> : <Copy size={13} />}
        {state === 'copied' ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
