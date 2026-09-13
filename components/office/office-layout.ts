import type { Point } from './office-primitives';
import type { Station } from './office-stations';
import { summaryFill } from '@/components/shared/memory';
import type {
  CalendarEntry as Booking,
  MemoryScopeSummary,
  Task,
  TaskKind,
  TaskStatus,
} from '@/lib/contracts';

/**
 * Where the rooms put the things the journal hands them: task cards on the wall
 * board, shelves in the records room, seats round the boardroom table. Pure, so
 * a preset and a baseline always agree about what sits where.
 */

export type BoardStatus = 'active' | 'waiting' | 'blocked' | 'done';

export type BoardCard = {
  id: string;
  title: string;
  status: BoardStatus;
  dependsOn: string[];
};

/**
 * How a task reads as a card. Work that is finished with is off the board: a failed or cancelled
 * task is not something the floor is carrying.
 */
const CARD_STATUS: Partial<Record<TaskStatus, BoardStatus>> = {
  queued: 'active',
  running: 'active',
  awaiting_approval: 'active',
  needs_input: 'active',
  waiting: 'waiting',
  blocked: 'blocked',
  completed: 'done',
};

/** The board carries the floor's work. An audit, curation or triage run is not on it. */
const CARD_KINDS: TaskKind[] = ['work', 'standing'];

/**
 * The floor's wall board. A card's id is its task's id, which is what lets the string from somebody
 * waiting reach the card they are waiting on, and what makes a card's `dependsOn` name other cards.
 */
export function boardCards(tasks: Task[]): BoardCard[] {
  return tasks.flatMap((task) => {
    const status = CARD_STATUS[task.status];
    if (!status || (task.kind && !CARD_KINDS.includes(task.kind))) return [];
    return [{ id: task.id, title: task.title, status, dependsOn: task.dependsOn ?? [] }];
  });
}

/** The board is three cards wide and three rows deep; anything past that is not shown. */
export const BOARD_COLUMNS = 3;
export const BOARD_ROWS = 3;
export const BOARD_CARDS = BOARD_COLUMNS * BOARD_ROWS;

export type CardPlacement = BoardCard & { column: number; row: number };
/** One dependency string, from the card depended on to the card that waits for it. */
export type CardString = { from: string; to: string };

/**
 * Cards fill the board left to right, top to bottom. A string is drawn only when
 * both ends are on the board, so a dependency on an unshown card is simply absent
 * rather than a line into nowhere.
 */
export function boardLayout(cards: BoardCard[]): { cards: CardPlacement[]; strings: CardString[] } {
  const placed = cards.slice(0, BOARD_CARDS).map((card, index) => ({
    ...card,
    column: index % BOARD_COLUMNS,
    row: Math.floor(index / BOARD_COLUMNS),
  }));
  const shown = new Set(placed.map((card) => card.id));
  const strings: CardString[] = [];
  const seen = new Set<string>();
  for (const card of placed)
    for (const from of card.dependsOn) {
      const key = `${from}\u0000${card.id}`;
      if (from === card.id || !shown.has(from) || seen.has(key)) continue;
      seen.add(key);
      strings.push({ from, to: card.id });
    }
  return { cards: placed, strings };
}

/**
 * The board's face, in the board group's own coordinates: how big it is, where
 * the card grid sits on it, and where any one card's pin ends up. The room draws
 * from this and so does anything that has to point at a card.
 */
export const BOARD_FACE_Y = 1.72;
export const BOARD_WIDTH = 2.72;
export const BOARD_HEIGHT = 1.58;
export const CARD_TILE: [number, number] = [0.76, 0.4];
const CARD_STEP_X = 0.86;
const CARD_STEP_Y = 0.49;

/** Where a card's tile sits on the board's face. */
export function cardCenter(column: number, row: number): { x: number; y: number } {
  return {
    x: (column - (BOARD_COLUMNS - 1) / 2) * CARD_STEP_X,
    y: ((BOARD_ROWS - 1) / 2 - row) * CARD_STEP_Y,
  };
}

/** Where a card's pin sits relative to the board group, or nothing if it is not on the board. */
export function cardPin(cards: BoardCard[], id: string): Point | undefined {
  const card = boardLayout(cards).cards.find((item) => item.id === id);
  if (!card) return undefined;
  const { x, y } = cardCenter(card.column, card.row);
  return [x, BOARD_FACE_Y + y, 0.08];
}

export type ShelfSpec = {
  /** Memory scope: `workspace`, `floor`, `project`, `agent` or `task`. Picks the casework. */
  scope: string;
  name: string;
  /** How full this scope's budget is, 0 to 1. */
  fill: number;
  /** Claims in conflict, which get red tabs. */
  contested: number;
};

export type ShelfPlacement = ShelfSpec & { position: Point };

/** One run of casework per scope the workspace keeps memory in, as the summaries report it. */
export function memoryShelves(summaries: MemoryScopeSummary[]): ShelfSpec[] {
  return summaries.map((summary) => ({
    scope: summary.scope,
    name: summary.name,
    fill: summaryFill(summary),
    contested: summary.contested,
  }));
}

/** The records room stands its casework in one row, so nothing hides behind anything. */
export const MAX_SHELVES = 8;
const SHELF_PITCH = 2.1;
const SHELF_Z = -4.55;

export function shelfLayout(shelves: ShelfSpec[]): ShelfPlacement[] {
  const shown = shelves.slice(0, MAX_SHELVES);
  const first = -((shown.length - 1) / 2) * SHELF_PITCH;
  return shown.map((shelf, index) => ({
    ...shelf,
    position: [first + index * SHELF_PITCH, 0, SHELF_Z] as Point,
  }));
}

export type MemoryFill = {
  /** How full this floor's memory budget is, 0 to 1. */
  floorFill: number;
  /** Per-employee notebook fill, 0 to 1. */
  agentFills: Map<string, number>;
  /** Claims in conflict across the workspace. */
  contested: number;
};

/**
 * The shelves a records room shows when nobody named them: one per scope the
 * floor's own memory covers, the workspace cabinet first.
 */
export function defaultShelves(memory: MemoryFill): ShelfSpec[] {
  const agents = [...memory.agentFills.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const average = agents.length ? agents.reduce((total, [, fill]) => total + fill, 0) / agents.length : 0;
  return [
    { scope: 'workspace', name: 'Workspace', fill: memory.floorFill * 0.6, contested: memory.contested },
    { scope: 'floor', name: 'Floor', fill: memory.floorFill, contested: 0 },
    { scope: 'project', name: 'Projects', fill: memory.floorFill * 0.8, contested: 0 },
    { scope: 'agent', name: 'Employees', fill: average, contested: 0 },
    { scope: 'task', name: 'Tasks', fill: Math.min(1, memory.floorFill + 0.15), contested: 0 },
  ];
}

/** The boardroom table, in the room's own coordinates. */
export const TABLE = { x: 0.4, z: -0.4, halfLength: 4.2, halfWidth: 1.3 };
const SEAT_REACH = 1.78;
const SEAT_PITCH = 1.95;
export const MAX_ATTENDEES = 8;

/**
 * Seats round the long table, filled a pair at a time from the middle out, so a
 * meeting of two sits facing each other rather than at opposite ends.
 */
export function boardroomSeats(count: number): Station[] {
  const seats: Station[] = [];
  const pairs = Math.min(Math.ceil(Math.min(count, MAX_ATTENDEES) / 2), 4);
  const first = -((pairs - 1) / 2) * SEAT_PITCH;
  for (let pair = 0; pair < pairs; pair++) {
    const x = TABLE.x + first + pair * SEAT_PITCH;
    seats.push({ at: [x, 0, TABLE.z + SEAT_REACH], facing: Math.PI });
    seats.push({ at: [x, 0, TABLE.z - SEAT_REACH], facing: 0 });
  }
  return seats.slice(0, Math.min(count, MAX_ATTENDEES));
}

/** The janitor's desk, and standing room down the front of the shelves. */
export function recordsStations(count: number): Station[] {
  const aisle = Array.from({ length: 6 }, (_, i): Station => ({
    at: [-5.6 + i * 2.1, 0, -2.55],
    facing: Math.PI,
  }));
  const janitor: Station = { at: [5.9, 0, 1.35], facing: -Math.PI / 2 };
  return [janitor, ...aisle].slice(0, Math.max(count, 1));
}

export type CalendarEntry = { label: string; at: string };
/** The lobby wall holds six entries; the rest are a number at the bottom of the card. */
export const CALENDAR_ENTRIES = 6;

/** A wall clock is one narrow column, so it reads in 24 hours whatever the locale prefers. */
function wallTime(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * The lobby's calendar wall: the week's shifts, meetings, deadlines and audits in
 * the order they happen, each one named by who it is for. Anything after today
 * carries its weekday, since the wall covers more than one.
 */
export function calendarWall(entries: Booking[], today: number): CalendarEntry[] {
  const midnight = new Date(today).setHours(0, 0, 0, 0);
  const tomorrow = midnight + 86_400_000;
  return entries
    .filter((entry) => entry.status !== 'cancelled')
    .sort((a, b) => a.startsAt - b.startsAt)
    .map((entry) => {
      const who = entry.attendees.find((attendee) => attendee.kind === 'employee');
      const day =
        entry.startsAt < tomorrow
          ? ''
          : `${new Date(entry.startsAt).toLocaleDateString(undefined, { weekday: 'short' })} `;
      return {
        at: `${day}${wallTime(entry.startsAt)}`,
        label: entry.kind === 'shift' && who ? `${who.name} · ${entry.title}` : entry.title,
      };
    });
}
