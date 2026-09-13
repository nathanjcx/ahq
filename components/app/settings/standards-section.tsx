'use client';

import { useState } from 'react';
import { formId, LockedNote, type SectionProps } from './sections';

/**
 * The standard the auditors measure copy and code against. It is the one piece of settings written
 * in prose, and it reaches every employee through workspace memory.
 */
export function StandardsSection({ settings, canManage, save }: SectionProps) {
  const [standards, setStandards] = useState(settings.standards);
  return (
    <form
      id={formId('standards')}
      className="form-stack"
      onSubmit={(event) => {
        event.preventDefault();
        void save({ ...settings, standards }, 'Standards saved');
      }}
    >
      <label>
        Copy and code standard
        <textarea
          className="large-textarea"
          disabled={!canManage}
          value={standards}
          placeholder="Copy: say what changed and what the reader has to do, in that order.&#10;&#10;Code: one concern per module, and a test for anything a person could get wrong twice."
          onChange={(event) => setStandards(event.target.value)}
        />
        <small>
          The auditors quote this back at an employee when its work misses it, so write it as rules
          somebody could fail.
        </small>
      </label>
      {!canManage && <LockedNote what="Standards" />}
    </form>
  );
}
