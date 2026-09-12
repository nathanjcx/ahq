import { describe, expect, it } from 'vitest';
import { tokenEstimate } from '../convex/lib/memory';
import type { Memory, TaskSummary } from '../lib/contracts';
import { compileWorkingMemory, type WorkingMemoryInputs } from '../lib/server/memory';

function claim(text: string, options: Partial<Memory> = {}): Memory {
  return {
    id: `memory-${text}`,
    scope: 'floor',
    scopeId: 'floor-1',
    kind: 'fact',
    text,
    tags: [],
    author: 'agent',
    authorName: 'Analyst',
    confidence: 0.8,
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
    ...options,
  };
}

function summary(outcome: string, createdAt: number): TaskSummary {
  return {
    id: `summary-${outcome}`,
    taskId: 'task-1',
    outcome,
    decisions: [],
    openQuestions: [],
    artifactIds: [],
    text: outcome,
    inferred: false,
    createdAt,
  };
}

function inputs(over: Partial<WorkingMemoryInputs> = {}): WorkingMemoryInputs {
  return {
    budgets: { workspace: 2_000, project: 3_000, floor: 4_000, agent: 1_500, summaries: 1_500 },
    entries: { workspace: [], project: [], floor: [], agent: [] },
    summaries: [],
    ...over,
  };
}

describe('the working memory compiler', () => {
  it('orders sections and claims by importance, confidence, and recency', () => {
    const compiled = compileWorkingMemory(
      inputs({
        entries: {
          workspace: [claim('Ship on Fridays', { scope: 'workspace', kind: 'preference' })],
          project: [claim('Launch is in March', { scope: 'project', kind: 'fact' })],
          floor: [
            claim('Older status', { kind: 'status', createdAt: 1 }),
            claim('Newer status', { kind: 'status', createdAt: 2 }),
            claim('Less certain decision', { kind: 'decision', confidence: 0.4 }),
            claim('Certain decision', { kind: 'decision', confidence: 0.9 }),
            claim('How to release', { kind: 'procedure' }),
          ],
          agent: [claim('I own the changelog', { scope: 'agent', kind: 'fact' })],
        },
        summaries: [summary('Wrote the release notes', 5)],
      }),
    );

    expect(compiled.text.split('\n\n').map((block) => block.split('\n')[0])).toEqual([
      'Working memory',
      'Workspace',
      'Project',
      'Floor',
      'Agent notes',
      'Recent summaries',
    ]);
    const floor = compiled.text.split('\n\n')[3].split('\n').slice(1);
    expect(floor).toEqual([
      '- [decision] Certain decision',
      '- [decision] Less certain decision',
      '- [procedure] How to release',
      '- [status] Newer status',
      '- [status] Older status',
    ]);
    expect(compiled.omitted).toEqual([]);
    expect(compiled.tokens).toBe(tokenEstimate(compiled.text));
  });

  it('never shows a contested or unapproved claim', () => {
    const compiled = compileWorkingMemory(
      inputs({
        entries: {
          workspace: [],
          project: [],
          floor: [
            claim('Disputed deadline', { status: 'contested', contestReason: 'Two dates' }),
            claim('Waiting on curation', { status: 'proposed' }),
            claim('Agreed deadline'),
          ],
          agent: [],
        },
      }),
    );

    expect(compiled.text).toContain('Agreed deadline');
    expect(compiled.text).not.toContain('Disputed deadline');
    expect(compiled.text).not.toContain('Waiting on curation');
  });

  it('trims each scope to its budget and says what it left out', () => {
    const compiled = compileWorkingMemory(
      inputs({
        // A rendered line is thirteen tokens, so one claim fits the floor budget.
        budgets: { workspace: 2_000, project: 3_000, floor: 13, agent: 1_500, summaries: 6 },
        entries: {
          workspace: [],
          project: [],
          floor: [
            claim('The release train leaves on Thursday', { kind: 'decision' }),
            claim('The release train leaves on Thursday', { kind: 'fact' }),
            claim('The release train leaves on Thursday', { kind: 'status' }),
          ],
          agent: [],
        },
        summaries: [summary('Wrote the release notes and shipped', 2), summary('Drafted the plan', 1)],
      }),
    );

    expect(compiled.text).toContain('- [decision] The release train leaves on Thursday');
    expect(compiled.text.match(/release train/g)).toHaveLength(1);
    expect(compiled.omitted).toEqual([
      { scope: 'floor', count: 2 },
      { scope: 'summaries', count: 2 },
    ]);
    expect(compiled.text).toContain('Omitted over budget: 2 floor, 2 recent summaries.');
  });

  it('produces nothing when there is nothing to say', () => {
    expect(compileWorkingMemory(inputs())).toEqual({ text: '', tokens: 0, omitted: [] });
  });
});
