import { describe, expect, it } from 'vitest';
import type { Activity, EmployeeActivity } from '../components/office/activity';
import {
  MIN_GAP,
  TALK_GAP,
  deskGrid,
  homeStations,
  layoutStations,
  type PlacedStation,
} from '../components/office/office-stations';

const ACTIVITIES: Activity[] = [
  'idle',
  'thinking',
  'reading',
  'calling',
  'writing',
  'reviewing',
  'celebrating',
  'failed',
  'talking',
];
const providers = [
  { id: 'linear', color: '#5b6ad0' },
  { id: 'github', color: '#4a5a52' },
  { id: 'slack', color: '#7a5ba1' },
];

/** A small deterministic generator, so a failure is always reproducible. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function gap(a: PlacedStation, b: PlacedStation): number {
  return Math.hypot(a.station.at[0] - b.station.at[0], a.station.at[2] - b.station.at[2]);
}

/** People on a floor, with pseudo-random activities and a few mutual handoffs. */
function floor(count: number, next: () => number) {
  const people = Array.from({ length: count }, (_, i) => ({
    id: `emp_${i}`,
    state: {
      activity: ACTIVITIES[Math.floor(next() * ACTIVITIES.length)],
      since: 0,
      ...(next() < 0.4 ? { provider: providers[Math.floor(next() * providers.length)].id } : {}),
    } as EmployeeActivity,
  }));
  for (const person of people) {
    if (person.state.activity !== 'talking') continue;
    const other = people[Math.floor(next() * people.length)];
    if (other.id === person.id) continue;
    other.state = { ...other.state, activity: 'talking', partnerId: person.id };
    person.state = { ...person.state, partnerId: other.id };
  }
  return people;
}

describe('office stations', () => {
  it('adds desk rows as the headcount grows, and keeps the rows apart', () => {
    expect(deskGrid(1)).toHaveLength(4);
    expect(deskGrid(6)).toHaveLength(6);
    expect(deskGrid(12)).toHaveLength(8);
    for (const count of [1, 4, 6, 7, 8, 20]) {
      const rows = [...new Set(deskGrid(count).map((desk) => desk[2]))].sort((a, b) => a - b);
      for (let i = 1; i < rows.length; i++) expect(rows[i] - rows[i - 1]).toBeGreaterThan(2.6);
    }
  });

  it('offers every person a home of their own', () => {
    for (const count of [1, 8, 20, 30]) expect(homeStations(count).length).toBeGreaterThanOrEqual(count);
  });

  it('keeps its homes, so nobody swaps chairs between renders', () => {
    const seats = new Map<string, number>();
    const people = floor(8, random(7));
    const first = layoutStations({ people, providers, seats });
    const idle = people.map((person) => ({ ...person, state: { activity: 'idle', since: 0 } as const }));
    const second = layoutStations({ people: idle, providers, seats });
    const later = layoutStations({ people, providers, seats });
    expect(second).toHaveLength(8);
    expect(later.map((placed) => placed.station.at)).toEqual(first.map((placed) => placed.station.at));
  });

  it('never stands two figures within 0.9 units unless they are talking', () => {
    for (let seed = 1; seed <= 120; seed++) {
      const next = random(seed);
      const count = 1 + (seed % 30);
      const people = floor(count, next);
      const placed = layoutStations({ people, providers, seats: new Map() });
      const state = new Map(people.map((person) => [person.id, person.state]));
      expect(placed).toHaveLength(count);
      for (let i = 0; i < placed.length; i++)
        for (let j = i + 1; j < placed.length; j++) {
          const partners =
            state.get(placed[i].id)?.partnerId === placed[j].id &&
            state.get(placed[j].id)?.partnerId === placed[i].id;
          const distance = gap(placed[i], placed[j]);
          const why = `seed ${seed}: ${placed[i].id} and ${placed[j].id} are ${distance.toFixed(2)} apart`;
          expect(distance, why).toBeGreaterThanOrEqual((partners ? TALK_GAP : MIN_GAP) - 1e-9);
        }
    }
  });

  it('stands handoff partners face to face at the talking gap', () => {
    const people = [
      { id: 'a', state: { activity: 'talking', since: 0, partnerId: 'b' } as EmployeeActivity },
      { id: 'b', state: { activity: 'talking', since: 0, partnerId: 'a' } as EmployeeActivity },
    ];
    const [a, b] = layoutStations({ people, providers, seats: new Map() });
    expect(gap(a, b)).toBeCloseTo(TALK_GAP, 6);
    expect(Math.abs(a.station.facing - b.station.facing)).toBeCloseTo(Math.PI, 6);
  });

  it('sends callers to a console of their own and reviewers to the lectern queue', () => {
    const people = [
      { id: 'a', state: { activity: 'calling', since: 0, provider: 'slack' } as EmployeeActivity },
      { id: 'b', state: { activity: 'calling', since: 0, provider: 'slack' } as EmployeeActivity },
      { id: 'c', state: { activity: 'reviewing', since: 0 } as EmployeeActivity },
      { id: 'd', state: { activity: 'reviewing', since: 0 } as EmployeeActivity },
    ];
    const placed = layoutStations({ people, providers, seats: new Map() });
    const [a, b, c, d] = placed;
    expect(a.accent).toBe('#7a5ba1');
    expect(a.station.at[0]).toBeCloseTo(b.station.at[0], 6);
    expect(a.station.at[2]).not.toBeCloseTo(b.station.at[2], 6);
    expect(c.station.at[2]).toBeCloseTo(d.station.at[2], 6);
    expect(gap(c, d)).toBeGreaterThanOrEqual(MIN_GAP);
  });
});
