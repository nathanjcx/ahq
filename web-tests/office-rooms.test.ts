import { describe, expect, it } from 'vitest';
import { boardCards } from '@/components/floors/floor-board';
import { afterHours, daylight, windowless } from '@/components/office/daylight';
import {
  BOARD_CARDS,
  BOARD_COLUMNS,
  MAX_ATTENDEES,
  MAX_SHELVES,
  boardLayout,
  boardroomSeats,
  defaultShelves,
  recordsStations,
  shelfLayout,
  type BoardCard,
  type ShelfSpec,
} from '@/components/office/office-layout';
import { sheetCount } from '@/components/office/office-props';
import { shelfBinders } from '@/components/office/office-rooms';
import type { Task, TaskStatus } from '@/lib/contracts';

const card = (id: string, dependsOn: string[] = []): BoardCard => ({
  id,
  title: id,
  status: 'active',
  dependsOn,
});

describe('boardLayout', () => {
  it('fills the board left to right, then down', () => {
    const { cards } = boardLayout([card('a'), card('b'), card('c'), card('d')]);
    expect(cards.map((placed) => [placed.column, placed.row])).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [0, 1],
    ]);
  });

  it('shows no more cards than the board holds', () => {
    const many = Array.from({ length: BOARD_CARDS + 4 }, (_, i) => card(`c${i}`));
    const { cards } = boardLayout(many);
    expect(cards).toHaveLength(BOARD_CARDS);
    expect(cards.every((placed) => placed.column < BOARD_COLUMNS)).toBe(true);
  });

  it('draws a string only when both ends are on the board', () => {
    const { strings } = boardLayout([card('a'), card('b', ['a', 'gone', 'b'])]);
    expect(strings).toEqual([{ from: 'a', to: 'b' }]);
  });

  it('draws one string per pair however often the dependency is repeated', () => {
    const { strings } = boardLayout([card('a'), card('b', ['a', 'a'])]);
    expect(strings).toHaveLength(1);
  });
});

describe('boardCards', () => {
  const task = (id: string, status: TaskStatus, dependsOn?: string[]): Task => ({
    id,
    employeeId: 'emp_1',
    employeeName: 'Ada',
    createdBy: 'user_1',
    createdByName: 'Dana',
    isOwner: true,
    visibility: 'workspace',
    title: `Task ${id}`,
    prompt: 'Do the thing',
    status,
    createdAt: 0,
    updatedAt: 0,
    model: 'gpt-6-astra',
    ...(dependsOn ? { dependsOn } : {}),
  });

  it('gives every card its task id, so a waiting string can find it', () => {
    const cards = boardCards([task('tsk_a', 'running'), task('tsk_b', 'waiting', ['tsk_a'])]);
    expect(cards).toEqual([
      { id: 'tsk_a', title: 'Task tsk_a', status: 'active', dependsOn: [] },
      { id: 'tsk_b', title: 'Task tsk_b', status: 'waiting', dependsOn: ['tsk_a'] },
    ]);
    expect(boardLayout(cards).strings).toEqual([{ from: 'tsk_a', to: 'tsk_b' }]);
  });

  it('leaves work the floor is no longer carrying off the board', () => {
    const cards = boardCards([
      task('tsk_a', 'failed'),
      task('tsk_b', 'cancelled'),
      task('tsk_c', 'completed'),
    ]);
    expect(cards.map((entry) => [entry.id, entry.status])).toEqual([['tsk_c', 'done']]);
  });
});

describe('shelfLayout', () => {
  const shelf = (name: string): ShelfSpec => ({ scope: 'floor', name, fill: 0.5, contested: 0 });

  it('centres the row and keeps an even pitch', () => {
    const placed = shelfLayout([shelf('a'), shelf('b'), shelf('c')]);
    expect(placed[1].position[0]).toBeCloseTo(0);
    expect(placed[2].position[0] - placed[1].position[0]).toBeCloseTo(
      placed[1].position[0] - placed[0].position[0],
    );
    expect(new Set(placed.map((item) => item.position[2])).size).toBe(1);
  });

  it('keeps every shelf inside the room and stops at the row it can show', () => {
    const placed = shelfLayout(Array.from({ length: MAX_SHELVES + 3 }, (_, i) => shelf(`s${i}`)));
    expect(placed).toHaveLength(MAX_SHELVES);
    expect(placed.every((item) => Math.abs(item.position[0]) < 8.1)).toBe(true);
  });

  it('fills a shelf in proportion to its scope, and never more tabs than binders', () => {
    expect(shelfBinders({ scope: 'floor', name: 'a', fill: 0, contested: 4 })).toEqual({
      filled: 0,
      contested: 0,
    });
    expect(shelfBinders({ scope: 'floor', name: 'a', fill: 1, contested: 0 }).filled).toBe(36);
    const half = shelfBinders({ scope: 'floor', name: 'a', fill: 0.5, contested: 2 });
    expect(half.filled).toBe(18);
    expect(half.contested).toBe(2);
  });

  it('derives one shelf per scope from the floor memory', () => {
    const shelves = defaultShelves({
      floorFill: 0.5,
      agentFills: new Map([
        ['b', 0.2],
        ['a', 0.8],
      ]),
      contested: 3,
    });
    expect(shelves.map((item) => item.scope)).toEqual(['workspace', 'floor', 'project', 'agent', 'task']);
    expect(shelves[3].fill).toBeCloseTo(0.5);
    expect(shelves[0].contested).toBe(3);
  });
});

describe('boardroomSeats', () => {
  it('seats a pair facing each other across the table', () => {
    const seats = boardroomSeats(2);
    expect(seats).toHaveLength(2);
    expect(seats[0].at[0]).toBeCloseTo(seats[1].at[0]);
    expect(seats[0].at[2]).toBeGreaterThan(seats[1].at[2]);
    expect(seats[0].facing).toBeCloseTo(Math.PI);
    expect(seats[1].facing).toBeCloseTo(0);
  });

  it('adds pairs outwards and never seats more than the table holds', () => {
    expect(boardroomSeats(5)).toHaveLength(5);
    expect(boardroomSeats(MAX_ATTENDEES + 3)).toHaveLength(MAX_ATTENDEES);
    const seats = boardroomSeats(8);
    const near = seats.filter((seat) => seat.facing === Math.PI).map((seat) => seat.at[0]);
    expect(near).toHaveLength(4);
    expect([...near].sort((a, b) => a - b)).toEqual(near);
  });

  it('gives nobody the same seat', () => {
    const seats = boardroomSeats(MAX_ATTENDEES);
    expect(new Set(seats.map((seat) => `${seat.at[0]} ${seat.at[2]}`)).size).toBe(MAX_ATTENDEES);
  });
});

describe('recordsStations', () => {
  it('puts the first person at the janitor desk and the rest down the aisle', () => {
    expect(recordsStations(1)).toHaveLength(1);
    const stations = recordsStations(4);
    expect(stations[0].at[0]).toBeGreaterThan(0);
    expect(stations.slice(1).every((station) => station.at[2] === stations[1].at[2])).toBe(true);
    expect(new Set(stations.map((station) => station.at[0])).size).toBe(4);
  });

  it('always offers a station, even for an empty room', () => {
    expect(recordsStations(0)).toHaveLength(1);
  });
});

describe('sheetCount', () => {
  it('is at least one sheet and at most the binder holds', () => {
    expect(sheetCount(0, 9)).toBe(1);
    expect(sheetCount(1, 9)).toBe(9);
    expect(sheetCount(-2, 9)).toBe(1);
    expect(sheetCount(4, 9)).toBe(9);
    expect(sheetCount(0.5, 9)).toBe(5);
  });
});

describe('light for a room that is shut or has no windows', () => {
  const noon = daylight(13);

  it('after hours leaves the clock alone but turns the lamps on', () => {
    const dark = afterHours(noon);
    expect(dark.interior).toBeGreaterThanOrEqual(0.85);
    expect(dark.sunIntensity).toBeLessThan(noon.sunIntensity);
    expect(dark.sunPosition).toEqual(noon.sunPosition);
  });

  it('a basement has no daylight at all', () => {
    const basement = windowless(noon);
    expect(basement.night).toBe(true);
    expect(basement.interior).toBe(1);
    expect(basement.sunIntensity).toBeLessThan(0.5);
  });
});
