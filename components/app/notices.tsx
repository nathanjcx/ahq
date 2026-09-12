'use client';

import { ArrowRight, CheckCircle2, Cloud, X } from 'lucide-react';

export function SetupBanner({ onSetup }: { onSetup: () => void }) {
  return (
    <div className="setup-banner" role="status">
      <span className="setup-banner-icon">
        <Cloud size={16} />
      </span>
      <span>
        <strong>Preview mode</strong> Add Clerk and Convex environment variables to connect this interface to
        your workspace.
      </span>
      <button className="setup-link" onClick={onSetup}>
        View setup <ArrowRight size={14} />
      </button>
    </div>
  );
}

export function Toast({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  return (
    <div className="toast" role="status">
      <CheckCircle2 size={17} />
      <span>{text}</span>
      <button onClick={onDismiss} aria-label="Dismiss">
        <X size={14} />
      </button>
    </div>
  );
}
