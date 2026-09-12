'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

/** A URL an administrator has to paste into a provider console, with a copy button. */
export function CopyLine({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
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
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1800);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
