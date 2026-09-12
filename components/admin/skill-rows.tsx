'use client';

import { FileText, X } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import { EmptyMini } from '../shared/empty';

export type SkillRow = { rowId: string; name: string; version: string; sha256: string; content: string };

export function SkillRows({
  skills,
  onChange,
}: {
  skills: SkillRow[];
  onChange: Dispatch<SetStateAction<SkillRow[]>>;
}) {
  return (
    <div className="editor-rows">
      {skills.map((skill, index) => (
        <div className="editor-row" key={skill.rowId}>
          <div className="editor-row-head">
            <strong>Skill {index + 1}</strong>
            <button
              type="button"
              className="icon-button danger-text"
              aria-label="Remove skill"
              onClick={() => onChange((items) => items.filter((item) => item.rowId !== skill.rowId))}
            >
              <X size={16} />
            </button>
          </div>
          <div className="form-grid">
            <label>
              Name
              <input
                value={skill.name}
                maxLength={120}
                required
                onChange={(event) =>
                  onChange((items) =>
                    items.map((item) =>
                      item.rowId === skill.rowId ? { ...item, name: event.target.value } : item,
                    ),
                  )
                }
                placeholder="triage-issues"
              />
            </label>
            <label>
              Version
              <input
                value={skill.version}
                maxLength={80}
                required
                onChange={(event) =>
                  onChange((items) =>
                    items.map((item) =>
                      item.rowId === skill.rowId ? { ...item, version: event.target.value } : item,
                    ),
                  )
                }
              />
            </label>
            <label className="full-field">
              Skill content
              <textarea
                className="code-area"
                value={skill.content}
                required
                onChange={(event) =>
                  onChange((items) =>
                    items.map((item) =>
                      item.rowId === skill.rowId ? { ...item, content: event.target.value } : item,
                    ),
                  )
                }
                spellCheck={false}
                placeholder="# Skill instructions"
              />
            </label>
          </div>
        </div>
      ))}
      {!skills.length && (
        <EmptyMini
          icon={<FileText size={19} />}
          title="No private skills"
          text="Add only the instructions this employee needs."
        />
      )}
    </div>
  );
}
