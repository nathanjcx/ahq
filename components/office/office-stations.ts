import type { EmployeeActivity } from './activity';
import type { Point } from './office-primitives';

/** Where a person stands or sits for their current activity, and which way they face. */
export type Station = {
  /** The place to be. The figure walks there; reduced motion snaps. */
  at: Point;
  /** Yaw in radians. Math.PI faces the back wall, 0 faces the camera side of the room. */
  facing: number;
};

/** Nobody stands closer to anybody else than this unless the two of them are talking. */
export const MIN_GAP = 0.9;
/** Partners in a handoff face each other across this gap. */
export const TALK_GAP = 0.8;

/** The lectern work waits on, and the queue in front of it. */
export const LECTERN: Point = [-0.75, 0, 1.05];
const LECTERN_STEP = 0.95;
/** Provider consoles line the window wall; people stand a step into the room from them. */
export const CONSOLE_X = -8.5;
export const CONSOLE_Z = [-3.6, -1.7, 0.2, 2.1, 4];
const CONSOLE_STEP = 0.85;

/**
 * Props a figure walks to, and the room's way in. The rooms draw them here and
 * the people stand here, so a figure is never a metre away from what it is doing.
 */
export const TASK_BOARD: Point = [-0.9, 0, 2.55];
export const INCIDENT_LAMP: Point = [0.6, 0, 5.15];
export const BINDER: Point = [4.55, 0.99, -3.95];
/** The way in and out of a room: the lift on the lobby, the door on a floor. */
export const DOORWAY: Point = [-8.5, 0, -5.88];

/**
 * Room at a prop. The first figure takes the prop itself and the rest queue clear
 * of it, in the order they are placed, so two people are never on the same spot.
 * Once a queue is full the next figure stays at their own desk.
 */
const QUEUES = {
  /** In front of the task board, facing it. */
  board: [
    { at: [TASK_BOARD[0], 0, TASK_BOARD[2] + 1.15], facing: 0 },
    { at: [TASK_BOARD[0] + 0.95, 0, TASK_BOARD[2] + 1.15], facing: 0 },
    { at: [TASK_BOARD[0] + 1.9, 0, TASK_BOARD[2] + 1.15], facing: 0 },
  ],
  /** At the meeting table, filing the floor's binder. */
  binder: [
    { at: [BINDER[0], 0, BINDER[2] + 1.05], facing: 0 },
    { at: [BINDER[0] - 1.2, 0, BINDER[2] + 0.65], facing: 0.4 },
    { at: [BINDER[0] + 1.2, 0, BINDER[2] + 0.65], facing: -0.4 },
  ],
  /** Just inside the door, arriving, leaving, or waiting for the lift. */
  door: [
    { at: [DOORWAY[0] + 1.1, 0, DOORWAY[2] + 1.1], facing: 2.36 },
    { at: [DOORWAY[0] + 2.05, 0, DOORWAY[2] + 1.1], facing: 2.36 },
    { at: [DOORWAY[0] + 3, 0, DOORWAY[2] + 1.1], facing: 2.36 },
  ],
  /** At the beacon, when there is no console free to run to. */
  beacon: [
    { at: [INCIDENT_LAMP[0] + 0.9, 0, INCIDENT_LAMP[2] - 0.5], facing: -2.1 },
    { at: [INCIDENT_LAMP[0] - 0.15, 0, INCIDENT_LAMP[2] - 0.85], facing: -1.7 },
    { at: [INCIDENT_LAMP[0] + 1.8, 0, INCIDENT_LAMP[2] - 1.05], facing: -2.4 },
  ],
  /** The queue at the review lectern, each one a step along it. */
  lectern: [0, 1, 2].map(
    (slot): Station => ({
      at: [LECTERN[0] + slot * LECTERN_STEP, 0, LECTERN[2] - LECTERN_STEP],
      facing: 0,
    }),
  ),
} satisfies Record<string, Station[]>;

type QueueName = keyof typeof QUEUES;

/** Activities that put a figure somewhere specific in the room, whatever their desk is. */
const AT_A_PROP: Partial<Record<EmployeeActivity['activity'], QueueName>> = {
  planning: 'board',
  filing: 'binder',
  arriving: 'door',
  leaving: 'door',
  preparing: 'door',
};

/**
 * Open floor two people can meet on without crowding a station. Each spot takes
 * one pair, standing `TALK_GAP` apart along the spot's axis.
 */
const HUDDLES: { at: Point; axis: 'x' | 'z' }[] = [
  { at: [-0.5, 0, -2.4], axis: 'x' },
  { at: [-0.5, 0, -4.3], axis: 'x' },
  { at: [6.4, 0, 0.4], axis: 'x' },
];

/**
 * Desk anchors: two columns against the window side, with rows added as the
 * headcount grows. The room draws its desks from the same grid, so a figure's
 * home station is always a real chair.
 */
export function deskGrid(count: number): Point[] {
  const rows = Math.min(4, Math.max(2, Math.ceil(count / 2)));
  const spacing = rows > 3 ? 2.72 : 3.3;
  const first = -((rows - 1) / 2) * spacing + 0.1;
  const grid: Point[] = [];
  for (let row = 0; row < rows; row++) for (const x of [-6.3, -3.1]) grid.push([x, 0, first + row * spacing]);
  return grid;
}

/** The lounge, the meeting table, and finally the near edge of the floor. */
const SEATS: Station[] = [
  { at: [3.67, 0, 4.55], facing: Math.PI },
  { at: [4.7, 0, 4.55], facing: Math.PI },
  { at: [5.73, 0, 4.55], facing: Math.PI },
  { at: [2.5, 0, 1.9], facing: 0.25 },
  { at: [6.9, 0, 1.9], facing: -0.25 },
  { at: [3.9, 0, -2.1], facing: Math.PI },
  { at: [5.1, 0, -2.1], facing: Math.PI },
  { at: [6.3, 0, -2.1], facing: Math.PI },
  { at: [3.9, 0, -4.5], facing: 0 },
  { at: [5.1, 0, -4.5], facing: 0 },
  { at: [6.3, 0, -4.5], facing: 0 },
];
/** Standing room along the near edge, clear of every desk and seat. */
const EDGE = Array.from({ length: 11 }, (_, i): Station => ({
  at: [-1.6 + i, 0, 5.7],
  facing: Math.PI,
}));

/** Every home a floor can offer, in the order people take them. */
export function homeStations(count: number): Station[] {
  const desks = deskGrid(count).map((desk): Station => ({ at: [desk[0], 0, desk[2] + 1], facing: Math.PI }));
  return [...desks, ...SEATS, ...EDGE];
}

/** Yaw that makes a figure at `from` look at `to`. */
function facing(from: Point, to: Point): number {
  return Math.atan2(to[0] - from[0], to[2] - from[2]);
}

export type StationPerson = {
  id: string;
  state: EmployeeActivity;
};

export type PlacedStation = {
  id: string;
  station: Station;
  /** The index of this person's home station, whether or not they are standing at it. */
  home: number;
  /** The provider being called, so the figure's bubble can take its colour. */
  accent?: string;
};

type Provider = { id: string; color: string };

/**
 * Puts everyone somewhere the room can explain: at their own desk or seat, at a
 * provider console, in the queue at the review lectern, or face to face with the
 * person they are handing work to.
 *
 * Homes are sticky, so nobody swaps chairs while the office is open, and every
 * station is at least `MIN_GAP` from every other one. Only a talking pair stands
 * closer, at `TALK_GAP`, and only on a huddle spot kept clear of the stations.
 */
export function layoutStations({
  people,
  providers = [],
  seats,
}: {
  people: StationPerson[];
  providers?: Provider[];
  /** Sticky home index per employee. Mutated so seats survive re-renders. */
  seats: Map<string, number>;
}): PlacedStation[] {
  const homes = homeStations(people.length);
  /** Homes past this index are seats and standing room rather than desks. */
  const desks = deskGrid(people.length).length;
  const taken = new Set<number>();
  for (const person of people) {
    const home = seats.get(person.id);
    if (home !== undefined) taken.add(home);
  }
  let free = 0;
  const home = new Map<string, { index: number; station: Station }>();
  for (const person of people) {
    let index = seats.get(person.id);
    if (index === undefined) {
      while (taken.has(free)) free += 1;
      index = free;
      taken.add(index);
      seats.set(person.id, index);
    }
    const slot = index % homes.length;
    home.set(person.id, { index: slot, station: homes[slot] });
  }

  const partners = huddlePairs(people);
  // How many figures each queue has already taken, so the next one stands clear.
  const queued = new Map<string, number>();
  const take = (name: string, slots: Station[]): Station | undefined => {
    const next = queued.get(name) ?? 0;
    if (next >= slots.length) return undefined;
    queued.set(name, next + 1);
    return slots[next];
  };
  const consoles = new Set<number>();
  const result: PlacedStation[] = [];
  for (const person of people) {
    const own = home.get(person.id)!;
    const pair = partners.get(person.id);
    if (pair) {
      result.push({ id: person.id, station: pair, home: own.index });
      continue;
    }
    if (person.state.activity === 'reviewing') {
      const stand = take('lectern', QUEUES.lectern);
      if (stand) {
        result.push({ id: person.id, station: stand, home: own.index });
        continue;
      }
    }
    const prop = AT_A_PROP[person.state.activity];
    if (prop) {
      const stand = take(prop, QUEUES[prop]);
      if (stand) {
        result.push({ id: person.id, station: stand, home: own.index });
        continue;
      }
    }
    // An auditor stands at the desk of whoever they are reading, not at their own.
    // Two auditors on one desk take one side of it each; somebody working from a
    // seat rather than a desk has no room beside them, so the auditor stays put.
    if (person.state.activity === 'auditing' && person.state.visitingId) {
      const read = home.get(person.state.visitingId);
      const desk = read && read.index < desks ? read : undefined;
      const stand = desk ? take(`desk ${person.state.visitingId}`, deskSides(desk.station)) : undefined;
      if (stand) {
        result.push({ id: person.id, station: stand, home: own.index });
        continue;
      }
    }
    if ((person.state.activity === 'calling' || person.state.activity === 'triaging') && providers.length) {
      const slot = freeConsole(person.state.provider, providers, consoles);
      if (slot >= 0) {
        consoles.add(slot);
        const z = CONSOLE_Z[slot];
        const stand: Point = [CONSOLE_X + CONSOLE_STEP, 0, z];
        result.push({
          id: person.id,
          station: { at: stand, facing: facing(stand, [CONSOLE_X, 0, z]) },
          home: own.index,
          ...(providers[slot]?.color ? { accent: providers[slot].color } : {}),
        });
        continue;
      }
    }
    // An incident with nowhere to take it still gets somebody at the beacon.
    if (person.state.activity === 'triaging') {
      const stand = take('beacon', QUEUES.beacon);
      if (stand) {
        result.push({ id: person.id, station: stand, home: own.index });
        continue;
      }
    }
    result.push({ id: person.id, station: own.station, home: own.index });
  }
  return result;
}

/** Standing room beside one desk, facing whoever is sitting at it. */
function deskSides(desk: Station): Station[] {
  return [
    [desk.at[0] + 1.05, desk.at[2] + 0.15],
    [desk.at[0] + 1.05, desk.at[2] - 0.8],
  ].map(([x, z]): Station => ({ at: [x, 0, z], facing: facing([x, 0, z], desk.at) }));
}

/** The console this caller gets: its own provider's if that one is still free, else the next one. */
function freeConsole(provider: string | undefined, providers: Provider[], taken: Set<number>): number {
  const limit = Math.min(providers.length, CONSOLE_Z.length);
  const own = providers.findIndex((item) => item.id === provider);
  if (own >= 0 && own < limit && !taken.has(own)) return own;
  for (let slot = 0; slot < limit; slot++) if (!taken.has(slot)) return slot;
  return -1;
}

/**
 * Talking pairs, both facing each other on a huddle spot. A pair only forms when
 * both people are on this floor and both are talking; anyone left over stays home.
 */
function huddlePairs(people: StationPerson[]): Map<string, Station> {
  const talking = new Map(
    people.filter((person) => person.state.activity === 'talking').map((person) => [person.id, person]),
  );
  const pairs: [string, string][] = [];
  const seen = new Set<string>();
  for (const person of talking.values()) {
    const partner = person.state.partnerId;
    if (!partner || seen.has(person.id) || seen.has(partner)) continue;
    // Both have to name each other; a one-sided handoff leaves the figure at home.
    if (talking.get(partner)?.state.partnerId !== person.id) continue;
    seen.add(person.id);
    seen.add(partner);
    pairs.push(person.id < partner ? [person.id, partner] : [partner, person.id]);
  }
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : 1));

  const stations = new Map<string, Station>();
  pairs.slice(0, HUDDLES.length).forEach(([first, second], index) => {
    const { at, axis } = HUDDLES[index];
    const half = TALK_GAP / 2;
    const a: Point = axis === 'x' ? [at[0] - half, 0, at[2]] : [at[0], 0, at[2] - half];
    const b: Point = axis === 'x' ? [at[0] + half, 0, at[2]] : [at[0], 0, at[2] + half];
    stations.set(first, { at: a, facing: facing(a, b) });
    stations.set(second, { at: b, facing: facing(b, a) });
  });
  return stations;
}
