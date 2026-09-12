'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

/** Pretty-prints JSON, or already-serialized JSON, without throwing on odd values. */
export function jsonText(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="json-copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? 'Copied' : 'Copy JSON'}
    </button>
  );
}

/** Collapsible pretty JSON with a copy button. Reused by the audit tab and the proposal card. */
export function JsonView({
  label,
  value,
  defaultOpen = false,
}: {
  label: string;
  value: unknown;
  defaultOpen?: boolean;
}) {
  const text = jsonText(value);
  return (
    <details className="json-view" open={defaultOpen}>
      <summary>{label}</summary>
      <div className="json-view-body">
        <CopyButton text={text} />
        <pre>{text || 'Nothing recorded.'}</pre>
      </div>
    </details>
  );
}
