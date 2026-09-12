/**
 * Text the interface shows to a person. Every function is pure and works on plain strings, so a
 * component, a route, and a test all shorten and count the same way.
 */

/** Collapses every run of whitespace, including newlines, into one space and trims the ends. */
export function normalizeWhitespace(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Shortens to at most `max` characters, ending in an ellipsis when anything was cut. The ellipsis
 * counts towards the limit, so the result never exceeds it.
 */
export function clip(text: string, max: number) {
  if (max <= 0) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Sentence terminators followed by a space or the end of the text. */
const SENTENCE_END = /[.!?](?=\s|$)/;

/**
 * The opening sentence of a longer passage, whitespace collapsed and clipped to `max`. Text with no
 * terminator is treated as one sentence.
 */
export function firstSentence(text: string, max: number) {
  const flat = normalizeWhitespace(text);
  const end = SENTENCE_END.exec(flat);
  return clip(end ? flat.slice(0, end.index + 1) : flat, max);
}

/** A lowercase, hyphenated form safe for an element id, a file name, or a screenshot name. */
export function slug(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * A count with its noun agreeing: `pluralize(1, 'task')` is "1 task" and `pluralize(3, 'task')` is
 * "3 tasks". Pass `plural` for a noun an "s" does not fix, such as "person" and "people".
 */
export function pluralize(count: number, noun: string, plural = `${noun}s`) {
  return `${count.toLocaleString()} ${count === 1 ? noun : plural}`;
}
