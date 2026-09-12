'use client';

import { LockKeyhole } from 'lucide-react';
import type { SettingsInput } from '../actions/schedule';
import type { WorkspaceSettings } from '@/lib/contracts';

export type SectionId = 'workspace' | 'schedule' | 'plan' | 'policies' | 'standards';

export const sections: { id: SectionId; label: string; hint: string; save: string }[] = [
  { id: 'workspace', label: 'Workspace', hint: 'Name, usage, and setup', save: 'Save token cap' },
  { id: 'schedule', label: 'Schedule', hint: 'Working hours and overnight', save: 'Save schedule' },
  { id: 'plan', label: 'Plan and budgets', hint: 'Allowance, caps, memory', save: 'Save plan and budgets' },
  { id: 'policies', label: 'Policies', hint: 'Hiring, audit, triage authority', save: 'Save policies' },
  { id: 'standards', label: 'Standards', hint: 'What the auditors measure against', save: 'Save standards' },
];

export function formId(id: SectionId) {
  return `settings-${id}-form`;
}

/** Everything a settings section needs: what is saved, whether it may change it, and one way to save. */
export type SectionProps = {
  settings: WorkspaceSettings;
  canManage: boolean;
  /** Saves the whole settings object and reports whether it went through. */
  save: (next: SettingsInput, success: string) => Promise<boolean>;
};

/** Why a member is looking at controls they cannot use. */
export function LockedNote({ what }: { what: string }) {
  return (
    <div className="settings-status">
      <LockKeyhole size={18} />
      <span>
        <strong>{what} are set by an administrator</strong>
        <small>You can read them here; your workspace owner or an administrator changes them.</small>
      </span>
    </div>
  );
}
