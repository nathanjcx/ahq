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
const LECTERN_SLOTS = 3;
const LECTERN_STEP = 0.95;
/** Provider consoles line the window wall; people stand a step into the room from them. */
export const CONSOLE_X = -8.5;
export const CONSOLE_Z = [-3.6, -1.7, 0.2, 2.1, 4];
const CONSOLE_STEP = 0.85;

/**
 * Open floor two people can meet on without crowding a station. Each spot takes
 * one pair, standing `TALK_GAP` apart along the spot's axis.
 */
const HUDDLES: { at: Point; axis: 'x' | 'z' }[] = [
  { at: [-1, 0, -2.4], axis: 'x' },
  { at: [-1, 0, -4.3], axis: 'x' },
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
export function facing(from: Point, to: Point): number {
  return Math.atan2(to[0] - from[0], to[2] - from[2]);
}

export type StationPerson = {
  id: string;
  state: EmployeeActivity;
};

export type PlacedStation = {
  id: string;
  station: Station;
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
  const taken = new Set<number>();
  for (const person of people) {
    const home = seats.get(person.id);
    if (home !== undefined) taken.add(home);
  }
  let free = 0;
  const home = new Map<string, Station>();
  for (const person of people) {
    let index = seats.get(person.id);
    if (index === undefined) {
      while (taken.has(free)) free += 1;
      index = free;
      taken.add(index);
      seats.set(person.id, index);
    }
    home.set(person.id, homes[index % homes.length]);
  }

  const partners = huddlePairs(people);
  let lecternQueue = 0;
  const consoles = new Set<number>();
  const result: PlacedStation[] = [];
  for (const person of people) {
    const at = home.get(person.id)!;
    const pair = partners.get(person.id);
    if (pair) {
      result.push({ id: person.id, station: pair });
      continue;
    }
    if (person.state.activity === 'reviewing' && lecternQueue < LECTERN_SLOTS) {
      const x = LECTERN[0] + lecternQueue * LECTERN_STEP;
      lecternQueue += 1;
      const stand: Point = [x, 0, LECTERN[2] - LECTERN_STEP];
      result.push({ id: person.id, station: { at: stand, facing: facing(stand, [x, 0, LECTERN[2]]) } });
      continue;
    }
    if (person.state.activity === 'calling' && providers.length) {
      const slot = freeConsole(person.state.provider, providers, consoles);
      if (slot >= 0) {
        consoles.add(slot);
        const z = CONSOLE_Z[slot];
        const stand: Point = [CONSOLE_X + CONSOLE_STEP, 0, z];
        result.push({
          id: person.id,
          station: { at: stand, facing: facing(stand, [CONSOLE_X, 0, z]) },
          ...(providers[slot]?.color ? { accent: providers[slot].color } : {}),
        });
        continue;
      }
    }
    result.push({ id: person.id, station: at });
  }
  return result;
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
