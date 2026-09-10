import { useEffect, useRef, useState } from 'react';
import 'pixi.js/unsafe-eval';
import { Application, Container, Graphics, Rectangle, Text, type Ticker } from 'pixi.js';
import type { ActivityKind, Agent } from '../shared/types';

type Props = {
  agents: Agent[];
  selectedAgentId?: string;
  reducedMotion?: boolean;
  onSelectAgent: (id: string) => void;
  onSelectStation?: (station: string) => void;
};
type Point = { x: number; y: number };
type FloorAgent = Agent & { waitingSlot?: number };
type Obstacle = Point & { w: number; h: number };
const WIDTH = 720;
const HEIGHT = 480;
const C = {
  ink: 0x344640, wall: 0xe8e6d2, wallShade: 0xc6cdb9, floor: 0xb5c4a5,
  grout: 0xa4b797, wood: 0xd5ab72, woodLight: 0xeacd98, woodDark: 0x99754f,
  cream: 0xfff5d8, green: 0x4b7862, darkGreen: 0x305c4d, leaf: 0x70904b,
  leafLight: 0xa7b56a, blue: 0x80b1b6, navy: 0x334a52, terra: 0xb97051,
};
const DESKS = [
  { x: 179, y: 117 }, { x: 359, y: 117 }, { x: 539, y: 117 },
  { x: 179, y: 347 }, { x: 359, y: 347 }, { x: 539, y: 347 },
];
const homeIndex = (agent: Agent) => ((agent.home % DESKS.length) + DESKS.length) % DESKS.length;
const home = (agent: Agent): Point => {
  const desk = DESKS[homeIndex(agent)];
  return { x: desk.x + 51, y: desk.y + 69 };
};
function floorAgents(agents: Agent[]): FloorAgent[] {
  const visible = agents.filter(agent => !agent.retiredAt && (agent.temporary || agent.persistent || agent.id === 'agent-maya' || agent.activity !== 'idle'));
  const residents = visible.filter(agent => !agent.temporary);
  const occupied = new Set(residents.map(homeIndex));
  let waitingSlot = 0;
  return [...residents, ...visible.filter(agent => agent.temporary).map(agent => {
    const free = DESKS.findIndex((_, index) => !occupied.has(index));
    if (agent.activity === 'waiting' || agent.activity === 'idle' || free < 0) return { ...agent, waitingSlot: waitingSlot++ };
    occupied.add(free);
    return { ...agent, home: free };
  })];
}
function rect(g: Graphics, x: number, y: number, w: number, h: number, color: number, alpha = 1) {
  g.rect(x, y, w, h).fill({ color, alpha });
}
function box(g: Graphics, x: number, y: number, w: number, h: number, color: number, border = C.ink) {
  rect(g, x, y, w, h, border);
  rect(g, x + 2, y + 2, w - 4, h - 4, color);
}
function label(parent: Container, value: string, x: number, y: number, size = 8, color = C.ink) {
  const text = new Text({ text: value, style: { fontFamily: 'monospace', fontSize: size, fontWeight: 'bold', fill: color, letterSpacing: 0.5 }, resolution: 2 });
  text.position.set(x, y);
  parent.addChild(text);
  return text;
}
function layer(parent: Container, x = 0, y = 0, depth = y) {
  const container = new Container();
  container.position.set(x, y);
  container.zIndex = depth;
  const g = new Graphics();
  container.addChild(g);
  parent.addChild(container);
  return { container, g };
}
function plant(parent: Container, x: number, y: number, large = false) {
  const { container, g } = layer(parent, x, y);
  const s = large ? 1.35 : 1;
  container.scale.set(s);
  rect(g, -10, -2, 23, 5, C.ink, 0.15);
  box(g, -7, -12, 15, 14, C.terra);
  rect(g, -5, -10, 3, 9, 0xd99b6d);
  rect(g, -9, -15, 19, 5, C.woodDark);
  rect(g, -1, -33, 3, 22, C.darkGreen);
  for (const [lx, ly, lw, lh, color] of [
    [-11, -28, 10, 9, C.darkGreen], [2, -34, 10, 10, C.green],
    [-7, -39, 9, 11, C.leaf], [-12, -23, 9, 7, C.leaf],
    [1, -24, 12, 8, C.leaf], [-5, -31, 8, 10, C.leafLight],
    [4, -30, 5, 5, C.leafLight], [-5, -39, 4, 6, C.leafLight],
  ]) rect(g, lx, ly, lw, lh, color);
}
function chair(parent: Container, x: number, y: number, color = C.green) {
  const { g } = layer(parent, x, y, y - 12);
  rect(g, -10, 7, 24, 5, C.ink, 0.13);
  rect(g, -2, 0, 4, 10, C.ink);
  rect(g, -11, 8, 24, 3, C.ink);
  box(g, -13, -16, 27, 19, color);
  rect(g, -10, -13, 21, 3, 0x7e9d79);
  rect(g, -16, -9, 4, 15, C.ink);
  rect(g, 13, -9, 4, 15, C.ink);
}
function mug(g: Graphics, x: number, y: number, color = C.cream) {
  box(g, x, y, 8, 9, color);
  rect(g, x + 8, y + 2, 3, 5, C.ink);
  rect(g, x + 2, y + 2, 4, 2, C.woodDark);
}
function book(g: Graphics, x: number, y: number, color: number, w = 12, h = 6) {
  box(g, x, y, w, h, color);
  rect(g, x + 3, y + h - 2, w - 4, 1, C.cream);
}
function clickTarget(container: Container, bounds: Rectangle, action: () => void) {
  container.eventMode = 'static';
  container.cursor = 'pointer';
  container.hitArea = bounds;
  container.on('pointertap', action);
}
function buildRoom(stage: Container, props: React.RefObject<Props>) {
  const { g: floor } = layer(stage, 0, 0, -100);
  rect(floor, 0, 0, WIDTH, HEIGHT, C.floor);
  for (let y = 69; y < HEIGHT; y += 24) {
    for (let x = 0; x < WIDTH; x += 24) {
      rect(floor, x + 1, y + 1, 23, 23, (x / 24 + (y - 69) / 24) % 2 ? 0xb8c6a8 : 0xb3c1a2);
      rect(floor, x, y, 24, 1, C.grout);
      rect(floor, x, y, 1, 24, C.grout);
      rect(floor, x + 2, y + 2, 21, 1, 0xc4ceb5, 0.45);
    }
  }
  rect(floor, 6, 73, 709, 5, C.ink, 0.09);
  rect(floor, 0, 0, WIDTH, 67, C.wall);
  for (let x = 0; x < WIDTH; x += 48) {
    rect(floor, x, 0, 1, 63, C.wallShade);
    rect(floor, x, 25, 48, 1, C.wallShade);
  }
  box(floor, 0, 61, WIDTH, 11, C.wallShade);
  rect(floor, 0, 0, 6, HEIGHT, C.ink);
  rect(floor, WIDTH - 6, 0, 6, HEIGHT, C.ink);
  rect(floor, 6, 73, 4, HEIGHT - 73, 0xd4dbc1);
  rect(floor, 710, 73, 4, HEIGHT - 73, 0x8fa486);
  for (const x of [111, 279, 447]) {
    box(floor, x, 8, 135, 49, C.navy);
    rect(floor, x + 4, 12, 127, 39, 0x8fbabc);
    for (let i = 0; i < 3; i++) {
      const wx = x + 7 + i * 42;
      rect(floor, wx, 15, 36, 32, 0xb6d4cf);
      rect(floor, wx, 15, 36, 10, 0xa5c9c9);
      rect(floor, wx + 5, 24, 12, 3, 0xe8eee0);
      rect(floor, wx + 10, 21, 15, 3, 0xe8eee0);
      rect(floor, wx + 2, 42, 31, 5, 0x789d8c);
      rect(floor, wx + 5, 38, 8, 5, 0x86a595);
      rect(floor, wx + 32, 15, 2, 28, 0xe7ecdf, 0.5);
    }
    box(floor, x - 3, 53, 141, 8, 0xe4e4d0);
    floor.poly([x + 6, 74, x + 120, 74, x + 157, 176, x + 44, 176]).fill({ color: 0xfbf2bb, alpha: 0.13 });
  }
  const sign = layer(stage, 22, 15, 68);
  box(sign.g, 0, 0, 70, 39, C.wood);
  rect(sign.g, 4, 4, 62, 31, C.cream);
  label(sign.container, 'GOOD WORK', 8, 9, 8);
  label(sign.container, 'TAKES ROOT', 7, 22, 7, C.green);
  plant(stage, 96, 80);
  plant(stage, 260, 66);
  plant(stage, 428, 66);
  plant(stage, 697, 102, true);

  const calendar = layer(stage, 604, 12, 66);
  box(calendar.g, 0, 0, 74, 45, C.cream);
  rect(calendar.g, 2, 2, 70, 11, C.terra);
  label(calendar.container, 'SEPTEMBER', 9, 3, 7, C.cream);
  for (let row = 0; row < 3; row++) for (let col = 0; col < 7; col++) {
    rect(calendar.g, 7 + col * 9, 18 + row * 8, 5, 4, row === 1 && col === 3 ? C.terra : C.wallShade);
  }
  clickTarget(calendar.container, new Rectangle(0, 0, 74, 45), () => props.current.onSelectStation?.('calendar'));

  const lounge = layer(stage, 24, 118, 212);
  box(lounge.g, -4, -7, 124, 110, 0x819488);
  for (let y = 0; y < 95; y += 6) rect(lounge.g, 0, y, 112, 1, 0x9cac99, 0.5);
  rect(lounge.g, 8, 65, 66, 8, C.ink, 0.2);
  box(lounge.g, 3, 0, 82, 31, C.darkGreen);
  box(lounge.g, 3, 22, 34, 59, C.darkGreen);
  for (const [x, y, w, h] of [[9, 6, 33, 23], [44, 6, 33, 23], [10, 32, 21, 36]]) {
    box(lounge.g, x, y, w, h, C.green);
    rect(lounge.g, x + 3, y + 3, w - 6, 2, 0x83a484);
  }
  box(lounge.g, 3, -3, 8, 44, 0x47785e);
  box(lounge.g, 79, -3, 8, 42, 0x47785e);
  box(lounge.g, 1, 71, 39, 11, 0x47785e);
  box(lounge.g, 16, 11, 14, 14, 0xd9bd7e);
  rect(lounge.g, 18, 13, 10, 2, C.cream);
  rect(lounge.g, 66, 73, 36, 6, C.ink, 0.15);
  box(lounge.g, 65, 46, 35, 27, C.wood);
  rect(lounge.g, 69, 50, 27, 3, C.woodLight);
  rect(lounge.g, 69, 73, 4, 7, C.woodDark);
  rect(lounge.g, 91, 73, 4, 7, C.woodDark);
  mug(lounge.g, 73, 54);
  book(lounge.g, 85, 54, C.terra, 9, 13);
  plant(stage, 137, 153);

  const kitchen = layer(stage, 21, 306, 397);
  box(kitchen.g, -8, -13, 118, 119, 0xc4ab83, 0x9e9474);
  for (let y = -5; y < 98; y += 13) rect(kitchen.g, -5, y, 112, 1, 0xb39872);
  box(kitchen.g, 0, 0, 105, 32, C.wallShade);
  for (const x of [4, 38, 72]) {
    box(kitchen.g, x, 13, 29, 16, 0xd7d8c4);
    rect(kitchen.g, x + 20, 17, 5, 2, C.ink);
  }
  box(kitchen.g, -2, -6, 109, 21, C.cream);
  box(kitchen.g, 5, -27, 29, 33, C.navy);
  box(kitchen.g, 10, -22, 19, 13, 0xa0b2a7);
  rect(kitchen.g, 14, -18, 12, 4, C.ink);
  mug(kitchen.g, 15, -6);
  mug(kitchen.g, 41, -1, C.terra);
  box(kitchen.g, 73, -1, 24, 12, 0x88a19b);
  rect(kitchen.g, 87, -9, 3, 11, C.navy);
  rect(kitchen.g, 81, -9, 9, 3, C.navy);
  box(kitchen.g, 21, 61, 60, 28, C.cream);
  rect(kitchen.g, 26, 89, 4, 12, C.ink);
  rect(kitchen.g, 72, 89, 4, 12, C.ink);
  book(kitchen.g, 29, 68, C.green, 16, 10);
  mug(kitchen.g, 57, 69, C.terra);
  label(kitchen.container, 'COFFEE & IDEAS', 2, -43, 7, C.darkGreen);
  plant(stage, 140, 408, true);

  const meeting = layer(stage, 307, 238, 280);
  for (const x of [322, 391]) { chair(stage, x, 234); chair(stage, x, 297); }
  rect(meeting.g, 4, 39, 111, 8, C.ink, 0.18);
  rect(meeting.g, 8, 34, 6, 16, C.woodDark);
  rect(meeting.g, 98, 34, 6, 16, C.woodDark);
  box(meeting.g, 0, 0, 112, 39, C.wood);
  rect(meeting.g, 4, 4, 104, 4, C.woodLight);
  rect(meeting.g, 4, 31, 104, 3, 0xc19461);
  rect(meeting.g, 36, 8, 1, 23, C.woodDark, 0.3);
  rect(meeting.g, 73, 8, 1, 23, C.woodDark, 0.3);
  box(meeting.g, 45, 10, 17, 21, C.cream);
  rect(meeting.g, 49, 15, 9, 2, C.wallShade);
  rect(meeting.g, 49, 20, 7, 2, C.wallShade);
  mug(meeting.g, 16, 13, C.terra);
  mug(meeting.g, 86, 14, C.green);
  clickTarget(meeting.container, new Rectangle(0, 0, 112, 42), () => props.current.onSelectStation?.('board'));

  const board = layer(stage, 461, 229, 282);
  rect(board.g, 5, 28, 4, 33, C.navy);
  rect(board.g, 64, 28, 4, 33, C.navy);
  rect(board.g, 0, 59, 16, 3, C.navy);
  rect(board.g, 58, 59, 16, 3, C.navy);
  box(board.g, 0, -25, 74, 70, 0xe9e6d5);
  box(board.g, 4, -21, 66, 61, 0xf5f0dc, 0x9aa89b);
  label(board.container, 'TEAM BOARD', 10, -15, 7);
  for (const [x, y, color] of [[10, 0, 0xe5c56e], [32, 0, 0xaac9a1], [52, 0, 0xe1ab8e], [10, 19, 0xa8c8c7], [32, 19, 0xe5c56e]]) {
    rect(board.g, x, y, 14, 13, color);
    rect(board.g, x + 3, y + 4, 8, 1, C.woodDark, 0.6);
    rect(board.g, x + 3, y + 7, 5, 1, C.woodDark, 0.6);
  }
  clickTarget(board.container, new Rectangle(0, -25, 74, 86), () => props.current.onSelectStation?.('board'));

  const draft = layer(stage, 614, 231, 269);
  rect(draft.g, 4, 24, 4, 24, C.woodDark);
  rect(draft.g, 54, 24, 4, 24, C.woodDark);
  box(draft.g, -3, -6, 66, 41, C.wood);
  box(draft.g, 4, -2, 46, 29, C.cream);
  rect(draft.g, 9, 3, 15, 15, C.blue);
  rect(draft.g, 12, 6, 9, 9, C.cream);
  rect(draft.g, 29, 4, 16, 2, C.wallShade);
  rect(draft.g, 29, 10, 12, 2, C.wallShade);
  rect(draft.g, 29, 17, 16, 2, C.wallShade);
  rect(draft.g, 53, 3, 3, 20, 0xe4b25d);
  label(draft.container, 'DRAFTING', 4, -19, 7, C.darkGreen);
  clickTarget(draft.container, new Rectangle(-3, -6, 66, 42), () => props.current.onSelectStation?.('artifacts'));

  const shelf = layer(stage, 661, 336, 409);
  box(shelf.g, 0, -25, 41, 99, C.woodDark);
  for (let row = 0; row < 3; row++) {
    rect(shelf.g, 4, -21 + row * 29, 33, 24, 0x796e4d);
    for (let col = 0; col < 5; col++) {
      const h = 14 + (row + col) % 3 * 3;
      const color = [C.terra, C.blue, C.leafLight, C.cream, C.green][(row + col) % 5];
      rect(shelf.g, 6 + col * 6, 2 + row * 29 - h, 5, h, color);
      rect(shelf.g, 7 + col * 6, 5 + row * 29 - h, 3, 1, C.cream);
    }
    rect(shelf.g, 2, 4 + row * 29, 37, 4, C.woodLight);
  }
  label(shelf.container, 'LIBRARY', -35, -39, 7, C.darkGreen);
  clickTarget(shelf.container, new Rectangle(0, -25, 41, 99), () => props.current.onSelectStation?.('artifacts'));
  plant(stage, 683, 306);

  DESKS.forEach((desk, index) => {
    chair(stage, desk.x + 51, desk.y + 65);
    const { container, g } = layer(stage, desk.x, desk.y, desk.y + 43);
    rect(g, 5, 40, 101, 10, C.ink, 0.16);
    box(g, 3, 28, 23, 25, 0xc2c2aa);
    box(g, 81, 28, 23, 25, 0xc2c2aa);
    rect(g, 7, 38, 15, 2, C.ink);
    rect(g, 85, 38, 15, 2, C.ink);
    box(g, 0, 0, 109, 38, C.wood);
    rect(g, 4, 4, 101, 3, C.woodLight);
    rect(g, 4, 30, 101, 3, 0xbf915f);
    box(g, 36, -18, 38, 28, C.navy);
    rect(g, 40, -14, 30, 20, 0x92c2c2);
    rect(g, 43, -11, 24, 3, 0xd7e9d8);
    for (let i = 0; i < 3; i++) rect(g, 43, -5 + i * 4, 10 + (i % 2) * 11, 2, i === 1 ? 0x5e9195 : 0xb9d9cb);
    rect(g, 52, 10, 6, 7, C.navy);
    box(g, 43, 16, 25, 5, 0x788d83);
    box(g, 37, 24, 38, 9, 0xd9dcc9);
    for (let key = 0; key < 7; key++) rect(g, 41 + key * 4, 27, 2, 2, 0x7c9285);
    box(g, 80, 22, 8, 10, C.wallShade);
    mug(g, 14, 20, index % 2 ? C.blue : C.cream);
    book(g, 8, -3, index % 2 ? C.terra : C.green, 14, 12);
    const pot = layer(container, 94, 9, 9);
    box(pot.g, -5, -6, 10, 10, C.terra);
    rect(pot.g, -2, -17, 4, 12, C.darkGreen);
    rect(pot.g, -7, -14, 7, 5, C.leaf);
    rect(pot.g, 1, -19, 6, 8, C.leafLight);
    clickTarget(container, new Rectangle(0, -20, 109, 74), () => {
      const agent = floorAgents(props.current.agents).find(item => item.waitingSlot === undefined && homeIndex(item) === index);
      if (agent) props.current.onSelectAgent(agent.id);
    });
  });
  plant(stage, 26, 453, true);
  plant(stage, 697, 453, true);
  const { g: trim } = layer(stage, 0, 0, 470);
  box(trim, 6, 461, 303, 19, C.wallShade);
  box(trim, 409, 461, 305, 19, C.wallShade);
  rect(trim, 310, 461, 98, 19, C.woodDark);
  box(trim, 325, 460, 68, 20, 0xb77860);
  for (let x = 331; x < 389; x += 6) rect(trim, x, 464, 2, 12, 0x98634f);
  return [
    ...DESKS.map(d => ({ x: d.x - 7, y: d.y - 24, w: 122, h: 76 })),
    { x: 17, y: 107, w: 129, h: 113 }, { x: 10, y: 270, w: 126, h: 133 },
    { x: 297, y: 236, w: 132, h: 49 }, { x: 452, y: 201, w: 91, h: 88 },
    { x: 606, y: 217, w: 81, h: 52 }, { x: 650, y: 301, w: 60, h: 115 },
  ];
}

// The office is small enough for a fixed ten-pixel walking grid.
function route(from: Point, to: Point, obstacles: Obstacle[]): Point[] {
  const door = { x: 359, y: 440 };
  if (from.y > 440 && to.y > 440) return [{ x: from.x, y: to.y }, to];
  if (from.y > 440) return [{ x: 359, y: from.y }, door, ...route(door, to, obstacles)];
  if (to.y > 440) return [...route(from, door, obstacles), { x: 359, y: to.y }, to];
  const cell = (p: Point) => ({ x: Math.round(p.x / 10), y: Math.round(p.y / 10) });
  const start = cell(from), end = cell(to);
  const key = (p: Point) => p.y * 73 + p.x;
  const queue = [start];
  const previous = new Map<number, Point | null>([[key(start), null]]);
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i];
    if (p.x === end.x && p.y === end.y) {
      const points: Point[] = [to];
      let cursor: Point | null = p;
      while (cursor) {
        points.push({ x: cursor.x * 10, y: cursor.y * 10 });
        cursor = previous.get(key(cursor)) ?? null;
      }
      return points.reverse().slice(1);
    }
    for (const d of [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]) {
      const next = { x: p.x + d.x, y: p.y + d.y };
      if (next.x < 2 || next.x > 69 || next.y < 8 || next.y > 44 || previous.has(key(next))) continue;
      if (obstacles.some(o => next.x * 10 > o.x && next.x * 10 < o.x + o.w && next.y * 10 > o.y && next.y * 10 < o.y + o.h)) continue;
      previous.set(key(next), p);
      queue.push(next);
    }
  }
  return [];
}
function destination(agent: FloorAgent): Point {
  if (agent.waitingSlot !== undefined) return { x: 62 + agent.waitingSlot % 6 * 119, y: 569 + Math.floor(agent.waitingSlot / 6) * 96 };
  const i = homeIndex(agent);
  switch (agent.activity) {
    case 'reading': case 'researching': return [{ x: 636, y: 302 }, { x: 610, y: 308 }, { x: 586, y: 311 }, { x: 560, y: 310 }, { x: 636, y: 431 }, { x: 610, y: 431 }][i];
    case 'drafting': return [{ x: 632, y: 292 }, { x: 600, y: 292 }, { x: 664, y: 292 }, { x: 576, y: 292 }, { x: 600, y: 313 }, { x: 576, y: 313 }][i];
    case 'scheduling': return { x: 568 + i * 21, y: 89 };
    case 'collaborating': return [{ x: 312, y: 225 }, { x: 356, y: 225 }, { x: 400, y: 225 }, { x: 312, y: 311 }, { x: 356, y: 311 }, { x: 400, y: 311 }][i];
    case 'walking': return { x: 204 + i * 24, y: 312 };
    default: return home(agent);
  }
}
type Gesture = 'wave' | 'stretch' | 'coffee' | 'plant';
type Greeting = { newcomerId: string; greeterId: string; stage: 'approach' | 'wave'; startedAt: number };
type IdleTrip = { agentId: string; kind: 'coffee' | 'plant'; target: Point; stage: 'out' | 'pause' | 'back'; startedAt: number };
const WELCOME_NEWCOMER = { x: 359, y: 439 };
const WELCOME_GREETER = { x: 304, y: 439 };
const distanceBetween = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
type Person = {
  root: Container; body: Graphics; shadow: Graphics; badge: Graphics; name: Text; speech: Container; speechShape: Graphics; speechText: Text;
  position: Point; target: Point; path: Point[]; activity: ActivityKind; elapsed: number;
};
function drawPerson(g: Graphics, agent: Agent, phase: number, moving: boolean, reduced: boolean, elapsed: number, gesture?: Gesture) {
  g.clear();
  const color = Number.parseInt(agent.color.replace('#', ''), 16);
  const hair = Number.parseInt(agent.hair.replace('#', ''), 16);
  const skin = Number.parseInt(agent.skin.replace('#', ''), 16);
  const step = moving && !reduced ? Math.round(Math.sin(phase * 9) * 2) : 0;
  const active = !reduced && ['coding', 'drafting', 'scheduling'].includes(agent.activity);
  const hand = active ? Math.round(Math.sin(phase * 11) * 2) : 0;
  const cheer = agent.activity === 'celebrating' && elapsed < 3.5;
  const stretch = gesture === 'stretch';
  const waving = gesture === 'wave';
  const blink = !reduced && phase % 6.7 < 0.16;
  const glance = agent.activity === 'idle' && !reduced && phase % 12 > 9.5 ? (phase % 12 > 10.8 ? 1 : -1) : 0;
  rect(g, -8, -9, 7, 8 + step, C.navy);
  rect(g, 2, -9, 7, 8 - step, C.navy);
  rect(g, -9, -3 + step, 9, 4, C.ink);
  rect(g, 2, -3 - step, 9, 4, C.ink);
  box(g, -11, -23, 23, 17, color);
  rect(g, -7, -21, 4, 12, C.cream, 0.13);
  rect(g, 7, -19, 3, 11, C.ink, 0.16);
  rect(g, -13, cheer || stretch ? -33 : -20, 5, cheer || stretch ? 13 : 10, C.ink);
  rect(g, -12, cheer || stretch ? -35 : -13 + hand, 5, 6, skin);
  rect(g, 10, cheer || stretch || waving ? -33 : -20, 5, cheer || stretch || waving ? 13 : 10, C.ink);
  rect(g, 10 + (waving ? Math.round(Math.sin(phase * 12) * 3) : 0), cheer || stretch || waving ? -35 : -13 - hand, 5, 6, skin);
  box(g, -13, -42, 27, 23, hair);
  rect(g, -10, -35, 21, 14, skin);
  rect(g, -14, -33, 4, 8, skin);
  rect(g, 11, -33, 4, 8, skin);
  rect(g, -10, -40, 22, 7, hair);
  rect(g, -11, -34, 4, 8, hair);
  rect(g, 9, -35, 3, 5, hair);
  rect(g, -8, -40, 9, 2, C.cream, 0.12);
  rect(g, -5 + glance, -30, 3, blink ? 1 : 3, C.ink);
  rect(g, 5 + glance, -30, 3, blink ? 1 : 3, C.ink);
  rect(g, 0, -23, 4, 1, 0x975f4e);
  if (agent.accessory === 'glasses') {
    box(g, -9, -32, 9, 7, skin);
    box(g, 2, -32, 9, 7, skin);
    rect(g, 0, -30, 2, 2, C.ink);
    rect(g, -6 + glance, -30, 2, blink ? 1 : 2, C.ink);
    rect(g, 5 + glance, -30, 2, blink ? 1 : 2, C.ink);
  } else if (agent.accessory === 'cap') {
    box(g, -13, -44, 27, 11, color);
    rect(g, -6, -35, 23, 4, C.ink);
    rect(g, -4, -35, 19, 2, color);
  } else if (agent.accessory === 'headphones') {
    rect(g, -14, -42, 29, 4, C.navy);
    box(g, -16, -35, 6, 13, C.blue);
    box(g, 12, -35, 6, 13, C.blue);
  }
  if (gesture === 'coffee') {
    mug(g, 8, -20 - (!reduced && phase % 4 < 1.4 ? 5 : 0));
    if (!reduced) for (let i = 0; i < 2; i++) rect(g, 10 + i * 4, -29 - Math.round((phase * 3 + i * 2) % 7), 2, 3, C.cream, .65);
  }
  if (gesture === 'plant') {
    box(g, 9, -19, 13, 10, C.blue);
    rect(g, 20, -16, 9, 3, C.blue);
    if (!reduced) for (let i = 0; i < 3; i++) rect(g, 28 + i * 3, -12 + Math.round((phase * 8 + i * 3) % 12), 2, 3, C.blue);
  }
  if (!moving && agent.activity === 'coding') {
    if (/qa|quality|verification/i.test(agent.role)) {
      box(g, -9, -20, 20, 21, C.cream);
      for (let row = 0; row < 3; row++) {
        box(g, -6, -16 + row * 5, 4, 4, row <= (reduced ? 2 : Math.floor(phase) % 3) ? C.green : C.wallShade, C.woodDark);
        rect(g, 0, -15 + row * 5, 7, 1, C.wallShade);
      }
    } else {
      box(g, -14, -9, 28, 9, C.navy);
      for (let x = -10; x < 12; x += 5) rect(g, x, -6, 3, 2, C.blue);
      rect(g, -9, -12 + hand, 5, 4, skin);
      rect(g, 5, -12 - hand, 5, 4, skin);
    }
  }
  if (!moving && (agent.activity === 'reading' || agent.activity === 'researching')) {
    box(g, -12, -17, 25, 15, C.cream);
    rect(g, 0, -15, 2, 11, C.woodDark);
    for (const x of [-8, 5]) for (let y = -13; y < -4; y += 3) rect(g, x, y, 5, 1, C.wallShade);
    if (!reduced && phase % 3 < .45) rect(g, -4 + Math.round(phase % 3 * 20), -15, 4, 11, C.wall);
    if (agent.activity === 'researching') { g.circle(15, -16, 5).stroke({ color: C.navy, width: 2 }); rect(g, 18, -13, 3, 7, C.woodDark); }
  }
  if (!moving && agent.activity === 'drafting') {
    box(g, -7, -14, 19, 15, C.cream);
    rect(g, 7, -21 + hand, 3, 16, 0xdca342);
    rect(g, 7, -6 + hand, 3, 2, C.ink);
    for (let i = 0; i < (reduced ? 3 : Math.floor(phase * 2) % 4); i++) rect(g, -4, -10 + i * 3, 8, 1, C.wallShade);
  }
  if (!moving && agent.activity === 'scheduling') {
    box(g, -8, -16, 19, 16, C.cream);
    rect(g, -6, -14, 15, 3, C.terra);
    rect(g, 12, -29 - hand, 3, 16, C.woodDark);
    for (let i = 0; i < 6; i++) rect(g, -5 + i % 3 * 5, -8 + Math.floor(i / 3) * 4, 3, 2, C.wallShade);
    const checked = reduced ? 3 : Math.floor(phase) % 6;
    rect(g, -5 + checked % 3 * 5, -8 + Math.floor(checked / 3) * 4, 3, 3, C.green);
  }
  if (!moving && agent.activity === 'collaborating') {
    box(g, 16, -48, 26, 16, C.cream);
    rect(g, 19, -32, 5, 4, C.ink);
    rect(g, 21, -33, 2, 4, C.cream);
    for (let i = 0; i < 3; i++) rect(g, 21 + i * 6, -41, 3, 3, reduced || Math.floor(phase * 2) % 3 >= i ? C.ink : C.wallShade);
  }
  if (agent.activity === 'waiting') {
    rect(g, 17, -49, 2, 39, C.woodDark);
    box(g, 18, -49, 17, 15, 0xe7be63);
    rect(g, 25, -46, 3, 6, C.ink);
    rect(g, 25, -38, 3, 2, C.ink);
  }
  if (cheer) for (let i = 0; i < 5; i++) {
    const cx = -23 + i * 11;
    const cy = -54 + (reduced ? i % 2 * 5 : Math.round(Math.sin(phase * 4 + i) * 5));
    rect(g, cx, cy, 3, 4, [C.terra, C.leaf, C.blue, 0xdcb151, C.green][i]);
  }
}

export default function OfficeCanvas(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const [error, setError] = useState(false);
  const [officeMoment, setOfficeMoment] = useState('');
  const waitingRows = Math.ceil(floorAgents(props.agents).filter(agent => agent.waitingSlot !== undefined).length / 6);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const app = new Application();
    let disposed = false;
    let observer: ResizeObserver | undefined;
    let tick: ((ticker: Ticker) => void) | undefined;
    let initialized = false;
    const people = new Map<string, Person>();
    const mountedAt = Date.now();
    const seenAgents = new Set(latest.current.agents.map(agent => agent.id));
    let arrivals: string[] = [];
    let greeting: Greeting | undefined;
    let idleTrip: IdleTrip | undefined;
    let nextIdleTrip = 12;
    let idleTripCount = 0;
    let hovered: string | undefined;
    void (async () => {
      try {
        await app.init({ width: WIDTH, height: HEIGHT, background: C.floor, antialias: false, resolution: 1, autoDensity: false, preference: 'webgl' });
        initialized = true;
        if (disposed) { app.destroy(true, { children: true }); return; }
        app.canvas.setAttribute('role', 'img');
        app.canvas.setAttribute('aria-label', 'Little Office. Agents work at desks, read in the library, plan at the calendar, and meet around the shared table. Select an agent in the roster for details.');
        app.canvas.style.cssText = 'display:block;width:100%;height:100%;object-fit:contain;image-rendering:pixelated';
        element.appendChild(app.canvas);
        const world = new Container();
        world.sortableChildren = true;
        app.stage.addChild(world);
        const obstacles = buildRoom(world, latest);
        const annex = layer(world, 0, HEIGHT, -90);
        const annexTitle = label(annex.container, 'ARRIVALS & WAITING ROOM', 18, 12, 9);
        let roomHeight = HEIGHT;
        let lastRows = -1;
        const tooltip = layer(world, 0, 0, 1000);
        const tooltipText = label(tooltip.container, '', 7, 5, 8, C.cream);
        tooltip.container.visible = false;
        const resize = () => {
          const width = element.clientWidth || WIDTH;
          const height = element.clientHeight || HEIGHT;
          app.renderer.resize(width, height);
          const scale = Math.min(width / WIDTH, height / roomHeight);
          world.scale.set(scale);
          world.position.set(Math.round((width - WIDTH * scale) / 2), Math.round((height - roomHeight * scale) / 2));
        };
        observer = new ResizeObserver(resize);
        observer.observe(element);
        resize();
        let time = 0;
        tick = ticker => {
          const dt = Math.min(ticker.deltaMS / 1000, 0.05);
          time += dt;
          const { selectedAgentId, reducedMotion } = latest.current;
          const agents = floorAgents(latest.current.agents);
          const rows = Math.ceil(agents.filter(agent => agent.waitingSlot !== undefined).length / 6);
          if (rows !== lastRows) {
            lastRows = rows;
            roomHeight = HEIGHT + rows * 96 + (rows ? 24 : 0);
            annex.container.visible = rows > 0;
            annex.g.clear();
            if (rows) {
              box(annex.g, 0, 0, WIDTH, roomHeight - HEIGHT, C.wallShade);
              for (let row = 0; row < rows; row++) for (let col = 0; col < 6; col++) {
                box(annex.g, 24 + col * 119, 82 + row * 96, 79, 10, C.wood);
                rect(annex.g, 29 + col * 119, 92 + row * 96, 5, 8, C.woodDark);
                rect(annex.g, 93 + col * 119, 92 + row * 96, 5, 8, C.woodDark);
              }
            }
            annexTitle.visible = rows > 0;
            resize();
          }
          const ids = new Set(agents.map(a => a.id));
          for (const [id, person] of people) if (!ids.has(id)) {
            person.root.destroy({ children: true });
            people.delete(id);
            if (hovered === id) hovered = undefined;
          }
          for (const agent of agents) {
            let person = people.get(agent.id);
            if (!person) {
              const root = new Container();
              const shadow = new Graphics();
              const body = new Graphics();
              const badge = new Graphics();
              root.addChild(shadow, body, badge);
              const name = label(root, agent.name, 0, -59, 8);
              name.anchor.set(0.5, 0);
              const speech = new Container();
              const speechShape = new Graphics();
              speech.addChild(speechShape);
              const speechText = label(speech, '', 0, -85, 8);
              speechText.anchor.set(.5, 0);
              speech.visible = false;
              root.addChild(speech);
              const arriving = !reducedMotion && agent.temporary && !seenAgents.has(agent.id) && (agent.spawnedAt || 0) >= mountedAt;
              seenAgents.add(agent.id);
              if (arriving) arrivals.push(agent.id);
              const entranceIndex = arrivals.filter(id => agents.find(item => item.id === id)?.waitingSlot === undefined).indexOf(agent.id);
              const position = arriving && agent.waitingSlot === undefined ? (!greeting && arrivals[0] === agent.id ? { x: 359, y: 473 } : { x: 450 + entranceIndex * 45, y: 439 }) : destination(agent);
              person = { root, shadow, body, badge, name, speech, speechShape, speechText, position, target: destination(agent), path: [], activity: 'idle', elapsed: 0 };
              clickTarget(root, new Rectangle(-28, -66, 56, 73), () => latest.current.onSelectAgent(agent.id));
              root.on('pointerover', () => { hovered = agent.id; });
              root.on('pointerout', () => { if (hovered === agent.id) hovered = undefined; });
              world.addChild(root);
              people.set(agent.id, person);
            }
          }
          arrivals = arrivals.filter(id => agents.some(agent => agent.id === id && agent.activity !== 'celebrating'));
          if (reducedMotion) {
            arrivals = [];
            greeting = undefined;
            idleTrip = undefined;
            nextIdleTrip = time + 12;
          } else {
            if (greeting) {
              const greeter = agents.find(agent => agent.id === greeting!.greeterId);
              const newcomer = agents.find(agent => agent.id === greeting!.newcomerId);
              if (greeter?.activity !== 'idle' || !newcomer || newcomer.activity === 'celebrating') greeting = undefined;
              else if (greeting.stage === 'approach') {
                if (distanceBetween(people.get(greeter.id)!.position, WELCOME_GREETER) < 7 && distanceBetween(people.get(newcomer.id)!.position, WELCOME_NEWCOMER) < 7) {
                  greeting.stage = 'wave';
                  greeting.startedAt = time;
                  setOfficeMoment(`${greeter.name} welcomes ${newcomer.name} to the office.`);
                } else if (time - greeting.startedAt > 4.2) greeting = undefined;
              } else if (time - greeting.startedAt > 1.2) greeting = undefined;
            }
            if (!greeting && arrivals.length) {
              const newcomerId = arrivals.shift()!;
              const greeter = agents.filter(agent => agent.persistent && !agent.temporary && agent.activity === 'idle').sort((a, b) => distanceBetween(people.get(a.id)!.position, WELCOME_GREETER) - distanceBetween(people.get(b.id)!.position, WELCOME_GREETER))[0];
              if (greeter) {
                greeting = { newcomerId, greeterId: greeter.id, stage: 'approach', startedAt: time };
                if (idleTrip?.agentId === greeter.id) idleTrip = undefined;
              }
            }
            if (idleTrip) {
              const agent = agents.find(item => item.id === idleTrip!.agentId);
              const person = agent && people.get(agent.id);
              if (agent?.activity !== 'idle' || !person) { idleTrip = undefined; nextIdleTrip = time + 18; }
              else if (idleTrip.stage === 'out' && distanceBetween(person.position, idleTrip.target) < 6) { idleTrip.stage = 'pause'; idleTrip.startedAt = time; }
              else if (idleTrip.stage === 'pause' && time - idleTrip.startedAt > 3) { idleTrip.stage = 'back'; idleTrip.startedAt = time; }
              else if ((idleTrip.stage === 'back' && distanceBetween(person.position, home(agent)) < 6) || time - idleTrip.startedAt > 12) { idleTrip = undefined; nextIdleTrip = time + 22; }
            }
            if (!idleTrip && !greeting && !arrivals.length && time >= nextIdleTrip) {
              const resting = agents.filter(agent => agent.persistent && !agent.temporary && agent.activity === 'idle');
              if (resting.length) {
                const agent = resting[idleTripCount % resting.length];
                const kind = idleTripCount++ % 2 ? 'plant' : 'coffee';
                idleTrip = { agentId: agent.id, kind, target: kind === 'coffee' ? { x: 154, y: 292 } : { x: 673, y: 440 }, stage: 'out', startedAt: time };
              }
              nextIdleTrip = time + 22;
            }
          }
          const waitingAtEntrance = arrivals.filter(id => agents.find(agent => agent.id === id)?.waitingSlot === undefined);
          for (const agent of agents) {
            const person = people.get(agent.id)!;
            const greetingRole = greeting?.newcomerId === agent.id ? 'newcomer' : greeting?.greeterId === agent.id ? 'greeter' : undefined;
            let target = destination(agent);
            if (idleTrip?.agentId === agent.id && agent.activity === 'idle') target = idleTrip.stage === 'back' ? home(agent) : idleTrip.target;
            if (arrivals.includes(agent.id) && agent.waitingSlot === undefined) target = { x: 450 + waitingAtEntrance.indexOf(agent.id) * 45, y: 439 };
            if (greetingRole) target = greetingRole === 'newcomer' ? WELCOME_NEWCOMER : WELCOME_GREETER;
            if (agent.activity === 'celebrating') target = person.position;
            if (agent.activity !== person.activity || target.x !== person.target.x || target.y !== person.target.y) {
              person.target = target;
              person.activity = agent.activity;
              person.elapsed = 0;
              person.path = agent.activity === 'celebrating' ? [] : route(person.position, target, obstacles);
            }
            person.elapsed += dt;
            if (reducedMotion) { person.position = { ...target }; person.path = []; }
            const next = person.path[0];
            if (next) {
              const dx = next.x - person.position.x, dy = next.y - person.position.y;
              const distance = Math.hypot(dx, dy);
              const speed = dt * (greetingRole ? 160 : idleTrip?.agentId === agent.id ? 65 : 56);
              if (distance <= speed) { person.position = { ...next }; person.path.shift(); }
              else { person.position.x += dx / distance * speed; person.position.y += dy / distance * speed; }
            }
            const moving = person.path.length > 0;
            const bob = reducedMotion ? 0 : moving ? Math.round(Math.sin(time * 18) * 1) : agent.activity === 'celebrating' && person.elapsed < 3.5 ? -Math.round(Math.abs(Math.sin(time * 7)) * 5) : 0;
            person.root.position.set(Math.round(person.position.x), Math.round(person.position.y));
            person.root.zIndex = person.position.y + 1;
            person.body.y = bob + (!reducedMotion && !moving && agent.activity === 'idle' && Math.sin(time * 1.8 + homeIndex(agent)) > .8 ? -1 : 0);
            const showName = !moving || hovered === agent.id || selectedAgentId === agent.id;
            person.name.visible = showName;
            person.badge.visible = showName;
            person.name.text = agent.waitingSlot !== undefined ? agent.name.split(' ')[0].slice(0, 12) : agent.name;
            const width = Math.max(46, Math.ceil(person.name.width) + 20);
            person.badge.clear();
            box(person.badge, -width / 2, -63, width, 17, selectedAgentId === agent.id ? 0xf3dfab : C.cream, selectedAgentId === agent.id ? C.woodDark : C.ink);
            rect(person.badge, -width / 2 + 5, -57, 5, 5, agent.activity === 'waiting' ? 0xd5a443 : agent.activity === 'idle' ? 0x97a590 : 0x6d9e5e);
            person.name.x = 4;
            person.shadow.clear();
            person.shadow.ellipse(1, 0, 16, 5).fill({ color: C.ink, alpha: 0.18 });
            if (selectedAgentId === agent.id || hovered === agent.id) person.shadow.ellipse(1, 1, 20, 8).stroke({ color: selectedAgentId === agent.id ? 0xfff2b1 : C.cream, width: 2 });
            const phase = time + homeIndex(agent) * 2.3;
            let gesture: Gesture | undefined;
            if (!reducedMotion && !moving) {
              if (greetingRole && greeting?.stage === 'wave') gesture = 'wave';
              else if (idleTrip?.agentId === agent.id && idleTrip.stage === 'pause') gesture = idleTrip.kind;
              else if (agent.persistent && agent.activity === 'idle' && phase % 21 > 19.3) gesture = 'stretch';
            }
            const speaking = greeting?.stage === 'wave' && (time - greeting.startedAt < .7 ? greetingRole === 'greeter' : greetingRole === 'newcomer');
            person.speech.visible = Boolean(speaking);
            if (speaking) {
              const message = greetingRole === 'greeter' ? `Welcome, ${agents.find(item => item.id === greeting!.newcomerId)!.name.split(' ')[0]}!` : 'On it!';
              if (person.speechText.text !== message) {
                person.speechText.text = message;
                const width = Math.ceil(person.speechText.width) + 14;
                person.speechShape.clear();
                box(person.speechShape, -width / 2, -90, width, 20, C.cream);
                rect(person.speechShape, -3, -70, 7, 5, C.ink);
                rect(person.speechShape, -1, -72, 3, 5, C.cream);
              }
            }
            drawPerson(person.body, agent, phase, moving, Boolean(reducedMotion), person.elapsed, gesture);
          }
          const hoveredAgent = agents.find(agent => agent.id === hovered);
          const hoveredPerson = hovered ? people.get(hovered) : undefined;
          tooltip.container.visible = Boolean(hoveredAgent && hoveredPerson);
          if (hoveredAgent && hoveredPerson) {
            tooltipText.text = `${hoveredAgent.name} · ${hoveredAgent.statusText}`;
            tooltipText.style.wordWrap = true;
            tooltipText.style.wordWrapWidth = 210;
            const w = Math.ceil(tooltipText.width) + 14;
            const h = Math.ceil(tooltipText.height) + 10;
            tooltip.g.clear();
            box(tooltip.g, 0, 0, w, h, C.darkGreen);
            tooltip.container.position.set(Math.max(10, Math.min(WIDTH - w - 10, hoveredPerson.position.x - w / 2)), Math.max(75, hoveredPerson.position.y - 68 - h));
          }
        };
        app.ticker.add(tick);
      } catch (cause) {
        if (initialized && !disposed) app.destroy(true, { children: true });
        initialized = false;
        if (!disposed) { console.error('Office renderer failed', cause); setError(true); }
      }
    })();
    return () => {
      disposed = true;
      observer?.disconnect();
      if (initialized) {
        if (tick) app.ticker.remove(tick);
        app.destroy(true, { children: true });
        initialized = false;
      }
    };
  }, []);
  return <div ref={host} style={{ width: '100%', height: '100%', minHeight: 380 + waitingRows * 80, overflow: 'hidden' }}>
    <span className="sr-only" aria-live="polite">{officeMoment}</span>
    {error && <p role="status" style={{ padding: 24, color: '#fff5d8' }}>The office view could not start. Your agents are available in the roster.</p>}
  </div>;
}
