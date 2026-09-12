import { tokenEstimate } from '../../convex/lib/memory';
import type { Memory, MemoryBudgets, MemoryKind, TaskSummary } from '../contracts';

/** The sections of a working memory block, in the order an employee reads them. */
export type WorkingMemorySection = 'workspace' | 'project' | 'floor' | 'agent' | 'summaries';

/** Everything the compiler needs; `services/memory:compileInputs` returns exactly this. */
export interface WorkingMemoryInputs {
  budgets: MemoryBudgets;
  entries: { workspace: Memory[]; project: Memory[]; floor: Memory[]; agent: Memory[] };
  summaries: TaskSummary[];
}

/** Extra sections a caller adds after memory, such as meeting context or the pacing note. */
export interface WorkingMemoryOptions {
  title?: string;
  sections?: { heading: string; lines: string[] }[];
}

export interface WorkingMemory {
  text: string;
  tokens: number;
  omitted: { scope: WorkingMemorySection; count: number }[];
}

// A decision binds the work, a procedure tells it how, a preference shapes it; status ages fastest.
const kindOrder: Record<MemoryKind, number> = {
  decision: 0,
  procedure: 1,
  preference: 2,
  fact: 3,
  glossary: 4,
  status: 5,
};

const headings: Record<WorkingMemorySection, string> = {
  workspace: 'Workspace',
  project: 'Project',
  floor: 'Floor',
  agent: 'Agent notes',
  summaries: 'Recent summaries',
};

/** Importance first, then confidence, then recency. Ties keep a stable, readable order. */
function byImportance(a: Memory, b: Memory) {
  return kindOrder[a.kind] - kindOrder[b.kind] || b.confidence - a.confidence || b.createdAt - a.createdAt;
}

function entryLine(entry: Memory) {
  const tags = entry.tags.length ? ` ${entry.tags.map((tag) => `#${tag}`).join(' ')}` : '';
  return `- [${entry.kind}] ${entry.text}${tags}`;
}

function summaryLine(summary: TaskSummary) {
  const parts = [summary.outcome.trim() || summary.text.trim()];
  if (summary.decisions.length) parts.push(`Decisions: ${summary.decisions.join('; ')}`);
  if (summary.openQuestions.length) parts.push(`Open: ${summary.openQuestions.join('; ')}`);
  return `- ${parts.join('. ')}`;
}

/** Fills one section up to its budget in priority order and reports what did not fit. */
function fill(lines: string[], budget: number) {
  const kept: string[] = [];
  let tokens = 0;
  for (const [index, line] of lines.entries()) {
    const cost = tokenEstimate(line);
    if (tokens + cost > budget) return { kept, omitted: lines.length - index };
    kept.push(line);
    tokens += cost;
  }
  return { kept, omitted: 0 };
}

/**
 * The Working memory block injected at the start of a turn: each scope trimmed to its budget by
 * importance, contested and unapproved claims left out, and an honest note about what was omitted.
 */
export function compileWorkingMemory(
  inputs: WorkingMemoryInputs,
  options: WorkingMemoryOptions = {},
): WorkingMemory {
  const order = ['workspace', 'project', 'floor', 'agent'] as const;
  const blocks: string[] = [];
  const omitted: { scope: WorkingMemorySection; count: number }[] = [];
  for (const scope of order) {
    const active = inputs.entries[scope].filter((entry) => entry.status === 'active');
    if (!active.length) continue;
    const section = fill([...active].sort(byImportance).map(entryLine), inputs.budgets[scope]);
    if (section.kept.length) blocks.push([headings[scope], ...section.kept].join('\n'));
    if (section.omitted) omitted.push({ scope, count: section.omitted });
  }
  if (inputs.summaries.length) {
    const recent = [...inputs.summaries].sort((a, b) => b.createdAt - a.createdAt);
    const section = fill(recent.map(summaryLine), inputs.budgets.summaries);
    if (section.kept.length) blocks.push([headings.summaries, ...section.kept].join('\n'));
    if (section.omitted) omitted.push({ scope: 'summaries', count: section.omitted });
  }
  for (const section of options.sections ?? [])
    if (section.lines.length) blocks.push([section.heading, ...section.lines].join('\n'));
  if (omitted.length)
    blocks.push(
      `Omitted over budget: ${omitted.map(({ scope, count }) => `${count} ${headings[scope].toLowerCase()}`).join(', ')}.`,
    );
  const text = blocks.length ? [options.title ?? 'Working memory', ...blocks].join('\n\n') : '';
  return { text, tokens: tokenEstimate(text), omitted };
}
