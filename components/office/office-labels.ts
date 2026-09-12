import type { Activity, Attention } from './activity';

/** What the legend's Labels control is set to. Persisted in `ahq.labels`. */
export type LabelMode = 'names' | 'dots' | 'off';
export const LABEL_MODES: LabelMode[] = ['names', 'dots', 'off'];

/** How far up a pill moves to clear the one below it, and how many steps it may take. */
export const LABEL_STEP = 20;
export const LABEL_STEPS = 4;

const WORKING: Activity[] = ['thinking', 'reading', 'calling', 'writing', 'reviewing', 'celebrating'];

/**
 * Who keeps their pill when the room is crowded. Selected first, then whoever
 * needs a person, then a handoff, then work, then everybody else.
 */
export function labelPriority(person: {
  selected?: boolean;
  attention?: Attention;
  activity: Activity;
}): number {
  if (person.selected) return 4;
  if (person.attention) return 3;
  if (person.activity === 'talking') return 2;
  if (WORKING.includes(person.activity) || person.activity === 'failed') return 1;
  return 0;
}

export type Rect = { x: number; y: number; width: number; height: number };

export type LabelInput = Rect & {
  id: string;
  priority: number;
};

export type LabelPlacement = {
  id: string;
  /** Pixels to lift the pill by, so it clears the pills already placed. */
  lift: number;
  hidden: boolean;
};

export function overlaps(a: Rect, b: Rect): boolean {
  return Math.abs(a.x - b.x) * 2 < a.width + b.width && Math.abs(a.y - b.y) * 2 < a.height + b.height;
}

/**
 * One pass over the pills, highest priority first: keep the pill where it is if
 * it is clear, otherwise lift it a step at a time. A pill that is still covered
 * after `LABEL_STEPS` lifts is the one that gets hidden.
 *
 * Positions are screen-space centres, so this is a pure function of the frame.
 */
export function layoutLabels(pills: LabelInput[]): LabelPlacement[] {
  const order = [...pills].sort((a, b) => b.priority - a.priority || a.y - b.y || (a.id < b.id ? -1 : 1));
  const placed: Rect[] = [];
  const result = new Map<string, LabelPlacement>();
  for (const pill of order) {
    let lift = 0;
    let clear = false;
    for (let step = 0; step <= LABEL_STEPS; step++) {
      lift = step * LABEL_STEP;
      const rect = { x: pill.x, y: pill.y - lift, width: pill.width, height: pill.height };
      if (!placed.some((other) => overlaps(rect, other))) {
        placed.push(rect);
        clear = true;
        break;
      }
    }
    result.set(pill.id, { id: pill.id, lift: clear ? lift : 0, hidden: !clear });
  }
  return pills.map((pill) => result.get(pill.id)!);
}

export type BubbleCandidate = {
  id: string;
  activity: Activity;
  attention?: Attention;
  /** When the line being shown was written. */
  since: number;
};

/**
 * Which lines are worth the room's attention, best first: a handoff being
 * spoken, then anything waiting on a person, then the newest message.
 */
export function rankBubbles(candidates: BubbleCandidate[]): string[] {
  const rank = (candidate: BubbleCandidate) =>
    candidate.activity === 'talking' ? 2 : candidate.attention ? 1 : 0;
  return [...candidates]
    .sort((a, b) => rank(b) - rank(a) || b.since - a.since || (a.id < b.id ? -1 : 1))
    .map((candidate) => candidate.id);
}

/** How far the gap between a figure and its bubble is, and the step a bubble shifts by. */
export const BUBBLE_GAP = 15;
export const BUBBLE_STEP = 26;

export type BubblePlacement = { side: 'left' | 'right'; lift: number };

/**
 * Where a bubble opens: on the side of its figure that has room, shifted up or
 * down if that is what it takes to clear the pills and the other bubble. The
 * first clear candidate wins; if none is clear, the least covered one does.
 */
export function placeBubble(
  anchor: { x: number; y: number },
  bubble: { width: number; height: number },
  obstacles: Rect[],
  viewport: { width: number; height: number },
): BubblePlacement {
  const sides: BubblePlacement['side'][] =
    anchor.x > viewport.width / 2 ? ['left', 'right'] : ['right', 'left'];
  let best: BubblePlacement = { side: sides[0], lift: 0 };
  let fewest = Infinity;
  for (const lift of [0, BUBBLE_STEP, -BUBBLE_STEP, BUBBLE_STEP * 2, -BUBBLE_STEP * 2])
    for (const side of sides) {
      const rect = bubbleRect(anchor, bubble, side, lift);
      const spills =
        rect.x - rect.width / 2 < 0 ||
        rect.x + rect.width / 2 > viewport.width ||
        rect.y - rect.height / 2 < 0
          ? 2
          : 0;
      const cover = obstacles.filter((other) => overlaps(rect, other)).length + spills;
      if (cover === 0) return { side, lift };
      if (cover < fewest) {
        fewest = cover;
        best = { side, lift };
      }
    }
  return best;
}

/** The screen rectangle a placed bubble occupies. */
export function bubbleRect(
  anchor: { x: number; y: number },
  bubble: { width: number; height: number },
  side: BubblePlacement['side'],
  lift: number,
): Rect {
  return {
    x: anchor.x + (side === 'left' ? -1 : 1) * (bubble.width / 2 + BUBBLE_GAP),
    y: anchor.y - lift,
    width: bubble.width,
    height: bubble.height,
  };
}
