import { tokenEstimate } from '../../convex/lib/memory';
import type { Memory, MemoryBudgets, MemoryKind, TaskSummary } from '../contracts';
import { untrustedBlock } from './untrusted';

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
  /** The claims that actually reached the block. Only these count as used for the agent budget. */
  usedIds: string[];
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

/**
 * One section of the block: the heading this platform wrote, then the claims another employee wrote
 * behind the untrusted fence, so nothing inside them reads as an instruction to the shift.
 */
function fenced(scope: WorkingMemorySection, lines: string[]) {
  return `${headings[scope]}\n${untrustedBlock(lines.join('\n'))}`;
}

/** Fills one section up to its budget in priority order and reports what did not fit. */
function fill(rows: { id?: string; line: string }[], budget: number) {
  const kept: string[] = [];
  const usedIds: string[] = [];
  let tokens = 0;
  for (const [index, row] of rows.entries()) {
    const cost = tokenEstimate(row.line);
    if (tokens + cost > budget) return { kept, usedIds, omitted: rows.length - index };
    kept.push(row.line);
    if (row.id) usedIds.push(row.id);
    tokens += cost;
  }
  return { kept, usedIds, omitted: 0 };
}

/**
 * The Working memory block injected at the start of a turn: each scope trimmed to its budget by
 * importance, contested and unapproved claims left out, and an honest note about what was omitted.
 * Claims and summaries are another agent's words, so every scope goes behind the untrusted fence; the
 * caller's own sections do not, because a caller fences whatever material it adds.
 */
export function compileWorkingMemory(
  inputs: WorkingMemoryInputs,
  options: WorkingMemoryOptions = {},
): WorkingMemory {
  const order = ['workspace', 'project', 'floor', 'agent'] as const;
  const blocks: string[] = [];
  const omitted: { scope: WorkingMemorySection; count: number }[] = [];
  const usedIds: string[] = [];
  for (const scope of order) {
    const active = inputs.entries[scope].filter((entry) => entry.status === 'active');
    if (!active.length) continue;
    const section = fill(
      [...active].sort(byImportance).map((entry) => ({ id: entry.id, line: entryLine(entry) })),
      inputs.budgets[scope],
    );
    if (section.kept.length) blocks.push(fenced(scope, section.kept));
    usedIds.push(...section.usedIds);
    if (section.omitted) omitted.push({ scope, count: section.omitted });
  }
  if (inputs.summaries.length) {
    const recent = [...inputs.summaries].sort((a, b) => b.createdAt - a.createdAt);
    const section = fill(
      recent.map((summary) => ({ line: summaryLine(summary) })),
      inputs.budgets.summaries,
    );
    if (section.kept.length) blocks.push(fenced('summaries', section.kept));
    if (section.omitted) omitted.push({ scope: 'summaries', count: section.omitted });
  }
  for (const section of options.sections ?? [])
    if (section.lines.length) blocks.push([section.heading, ...section.lines].join('\n'));
  if (omitted.length)
    blocks.push(
      `Omitted over budget: ${omitted.map(({ scope, count }) => `${count} ${headings[scope].toLowerCase()}`).join(', ')}.`,
    );
  const text = blocks.length ? [options.title ?? 'Working memory', ...blocks].join('\n\n') : '';
  return { text, tokens: tokenEstimate(text), omitted, usedIds };
}
