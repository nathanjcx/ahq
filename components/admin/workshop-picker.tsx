'use client';

import { DELIVERABLES, STUDIO_TOOLS, WORKSHOP_LIBRARIES, type Workshop } from '@/lib/contracts';

const GROUPS: { key: keyof Workshop; title: string; options: Record<string, string> }[] = [
  { key: 'deliverables', title: 'Deliverables the listing promises', options: DELIVERABLES },
  { key: 'libraries', title: 'Libraries installed in its environment', options: WORKSHOP_LIBRARIES },
  { key: 'tools', title: 'Studio tools it may call', options: STUDIO_TOOLS },
];

/** Three allow lists, each a row of checkboxes; an employee with none checked has no workshop. */
export function WorkshopPicker({
  workshop,
  onChange,
}: {
  workshop: Workshop;
  onChange: (next: Workshop) => void;
}) {
  return (
    <div className="editor-rows workshop-picker">
      {GROUPS.map((group) => (
        <fieldset key={group.key} className="editor-row">
          <legend>{group.title}</legend>
          <div className="workshop-options">
            {Object.entries(group.options).map(([value, label]) => {
              const chosen = (workshop[group.key] as string[]).includes(value);
              return (
                <label key={value} className={chosen ? 'chosen' : undefined}>
                  <input
                    type="checkbox"
                    checked={chosen}
                    onChange={(event) => {
                      const current = workshop[group.key] as string[];
                      const next = event.target.checked
                        ? [...current, value]
                        : current.filter((item) => item !== value);
                      onChange({ ...workshop, [group.key]: next });
                    }}
                  />
                  <code>{value}</code>
                  <small>{label}</small>
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
