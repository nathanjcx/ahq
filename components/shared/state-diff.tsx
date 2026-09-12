'use client';

import { JsonView, jsonText } from './json-view';

/** States arrive parsed from the audit timeline and as JSON text on a proposal. */
function asFields(value: unknown): Record<string, unknown> | null {
  let state = value;
  if (typeof state === 'string')
    try {
      state = JSON.parse(state) as unknown;
    } catch {
      return null;
    }
  return state !== null && typeof state === 'object' && !Array.isArray(state)
    ? (state as Record<string, unknown>)
    : null;
}

/** Field names of a captured state, for sentences like "restores title, description". */
export function stateFields(value: unknown): string[] {
  return Object.keys(asFields(value) ?? {});
}

function cell(value: unknown) {
  if (value === undefined) return 'not set';
  return typeof value === 'string' ? value : jsonText(value);
}

function FieldRow({
  field,
  values,
  changed = false,
}: {
  field: string;
  values: unknown[];
  changed?: boolean;
}) {
  return (
    <div className={`diff-row ${changed ? 'diff-changed' : ''}`}>
      <span className="diff-field">{field}</span>
      {values.map((value, index) => (
        <span key={index} className={`diff-value ${index === 1 ? 'diff-after' : ''}`}>
          {cell(value)}
        </span>
      ))}
    </div>
  );
}

/**
 * Field-level before/after view. With no after state it shows what was captured, which is all a
 * proposal has until it executes. Non-object states fall back to plain JSON.
 */
export function StateDiff({ before, after }: { before: unknown; after?: unknown }) {
  const beforeFields = asFields(before);
  const afterFields = after === undefined ? null : asFields(after);
  if (!beforeFields || (after !== undefined && !afterFields))
    return (
      <>
        <JsonView label="Before" value={before} />
        {after !== undefined && <JsonView label="After" value={after} />}
      </>
    );

  if (!afterFields)
    return (
      <div className="state-diff">
        <p className="state-diff-note">Captured before state</p>
        {Object.keys(beforeFields).map((field) => (
          <FieldRow key={field} field={field} values={[beforeFields[field]]} />
        ))}
      </div>
    );

  const fields = [...new Set([...Object.keys(beforeFields), ...Object.keys(afterFields)])];
  const changed = fields.filter((field) => jsonText(beforeFields[field]) !== jsonText(afterFields[field]));
  const unchanged = fields.filter((field) => !changed.includes(field));
  return (
    <div className="state-diff state-diff-pair">
      <div className="diff-head">
        <span>Field</span>
        <span>Before</span>
        <span>After</span>
      </div>
      {changed.length ? (
        changed.map((field) => (
          <FieldRow key={field} field={field} values={[beforeFields[field], afterFields[field]]} changed />
        ))
      ) : (
        <p className="state-diff-note">No field changed between the captured states.</p>
      )}
      {unchanged.length > 0 && (
        <details className="diff-unchanged">
          <summary>
            {unchanged.length} unchanged {unchanged.length === 1 ? 'field' : 'fields'}
          </summary>
          {unchanged.map((field) => (
            <FieldRow key={field} field={field} values={[beforeFields[field]]} />
          ))}
        </details>
      )}
    </div>
  );
}
