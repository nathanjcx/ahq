import { describe, expect, it } from 'vitest';
import {
  LABEL_STEP,
  LABEL_STEPS,
  placeBubble,
  labelPriority,
  layoutLabels,
  rankBubbles,
  type LabelInput,
} from '../components/office/office-labels';

const pill = (id: string, x: number, y: number, priority = 0): LabelInput => ({
  id,
  x,
  y,
  width: 80,
  height: 18,
  priority,
});

describe('label priority', () => {
  it('ranks selection first and an idle figure last', () => {
    expect(labelPriority({ selected: true, activity: 'idle' })).toBe(4);
    expect(labelPriority({ attention: 'approval', activity: 'thinking' })).toBe(3);
    expect(labelPriority({ activity: 'talking' })).toBe(2);
    expect(labelPriority({ activity: 'writing' })).toBe(1);
    expect(labelPriority({ activity: 'idle' })).toBe(0);
  });

  it('puts a selected idle figure above a working one', () => {
    expect(labelPriority({ selected: true, activity: 'idle' })).toBeGreaterThan(
      labelPriority({ activity: 'calling' }),
    );
  });
});

describe('label collision pass', () => {
  it('leaves pills that do not touch where they are', () => {
    const placed = layoutLabels([pill('a', 100, 100), pill('b', 400, 300)]);
    expect(placed.every((entry) => entry.lift === 0 && !entry.hidden)).toBe(true);
  });

  it('lifts the lower-priority pill of an overlapping pair', () => {
    const [low, high] = layoutLabels([pill('low', 100, 100, 0), pill('high', 110, 104, 3)]);
    expect(high.lift).toBe(0);
    expect(low.lift).toBe(LABEL_STEP);
    expect(low.hidden).toBe(false);
  });

  it('hides a pill that is still covered after four lifts', () => {
    const stack = Array.from({ length: LABEL_STEPS + 2 }, (_, i) =>
      pill(`p${i}`, 200, 200, LABEL_STEPS + 2 - i),
    );
    const placed = layoutLabels(stack);
    expect(placed.filter((entry) => entry.hidden).map((entry) => entry.id)).toEqual(['p5']);
    expect(placed[LABEL_STEPS].lift).toBe(LABEL_STEP * LABEL_STEPS);
  });

  it('is stable: the same frame always lays out the same way', () => {
    const pills = [pill('a', 100, 100, 1), pill('b', 104, 100, 1), pill('c', 108, 100, 1)];
    expect(layoutLabels(pills)).toEqual(layoutLabels([...pills].reverse()).reverse());
  });
});

describe('bubbles', () => {
  it('shows a handoff before an approval, and an approval before a fresh message', () => {
    expect(
      rankBubbles([
        { id: 'message', activity: 'writing', since: 900 },
        { id: 'handoff', activity: 'talking', since: 100 },
        { id: 'waiting', activity: 'reviewing', attention: 'approval', since: 500 },
      ]),
    ).toEqual(['handoff', 'waiting', 'message']);
  });

  it('prefers the newest message when nothing outranks it', () => {
    expect(
      rankBubbles([
        { id: 'old', activity: 'writing', since: 1 },
        { id: 'new', activity: 'writing', since: 2 },
      ]),
    ).toEqual(['new', 'old']);
  });

  it('opens away from the pills it would otherwise cover', () => {
    const anchor = { x: 500, y: 300 };
    const box = { width: 160, height: 40 };
    const viewport = { width: 1000, height: 600 };
    const covered = { x: 380, y: 300, width: 160, height: 40 };
    expect(placeBubble(anchor, box, [covered], viewport)).toEqual({ side: 'right', lift: 0 });
    expect(placeBubble({ x: 940, y: 300 }, box, [], viewport)).toEqual({ side: 'left', lift: 0 });
  });

  it('shifts a bubble clear when both sides are covered', () => {
    const anchor = { x: 500, y: 300 };
    const box = { width: 160, height: 40 };
    const viewport = { width: 1000, height: 600 };
    const both = [
      { x: 380, y: 300, width: 160, height: 40 },
      { x: 620, y: 300, width: 160, height: 40 },
    ];
    const placement = placeBubble(anchor, box, both, viewport);
    expect(placement.lift).not.toBe(0);
    expect(
      both.every((rect) => Math.abs(rect.y - (anchor.y - placement.lift)) * 2 >= rect.height + box.height),
    ).toBe(true);
  });
});
