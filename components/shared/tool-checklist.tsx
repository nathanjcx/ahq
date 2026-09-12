'use client';

export function ToolChecklist({
  tools,
  selected,
  onChange,
}: {
  tools: { name: string; description?: string }[];
  selected: string[];
  onChange: (tools: string[]) => void;
}) {
  return (
    <div className="tool-checklist">
      {tools.map((tool) => {
        const checked = selected.includes(tool.name);
        return (
          <label key={tool.name}>
            <input
              type="checkbox"
              checked={checked}
              onChange={() =>
                onChange(checked ? selected.filter((name) => name !== tool.name) : [...selected, tool.name])
              }
            />
            <span>
              <strong>{tool.name}</strong>
              {tool.description && <small>{tool.description}</small>}
            </span>
          </label>
        );
      })}
    </div>
  );
}
