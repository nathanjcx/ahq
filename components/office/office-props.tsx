'use client';

import { useEffect, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import {
  boardLayout,
  BOARD_COLUMNS,
  BOARD_ROWS,
  CALENDAR_ENTRIES,
  type BoardCard,
  type BoardStatus,
  type CalendarEntry,
} from './office-layout';
import { Box, C, Cylinder, GlowBar, Halo, Round, type Point } from './office-primitives';

/**
 * The paper the workspace runs on: memory binders and notebooks, the contested
 * folder, findings, the task board, and the lamps that say the office is not
 * having a normal day. Every prop is a static mesh and every prop is clickable.
 */

/** What a click on a prop reports. The page above decides what to open. */
export type OfficePropKind =
  | 'binder'
  | 'notebook'
  | 'contested'
  | 'findings'
  | 'card'
  | 'lamp'
  | 'shelf'
  | 'calendar'
  | 'alerts'
  | 'lift';

export type SelectProp = (kind: OfficePropKind, id?: string) => void;

const AMBER = '#e8a54f';
const RED = '#c2543f';
const PAPER = '#f1ead6';

/** A prop the viewer can pick, with the office's pointer cursor while it is under the mouse. */
export function Pickable({
  kind,
  id,
  onSelectProp,
  children,
}: {
  kind: OfficePropKind;
  id?: string;
  onSelectProp?: SelectProp;
  children: ReactNode;
}): JSX.Element {
  const [hovered, setHovered] = useState(false);
  useEffect(() => {
    if (!hovered || !onSelectProp) return;
    const old = document.body.style.cursor;
    document.body.style.cursor = 'pointer';
    return () => {
      document.body.style.cursor = old;
    };
  }, [hovered, onSelectProp]);
  return (
    <group
      onClick={(event) => {
        if (!onSelectProp) return;
        event.stopPropagation();
        onSelectProp(kind, id);
      }}
      onPointerOver={(event) => {
        event.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
    >
      {children}
    </group>
  );
}

/** How many sheets a fill of 0 to 1 is worth, always at least one. */
export function sheetCount(fill: number, most: number): number {
  return 1 + Math.round(Math.min(1, Math.max(0, fill)) * (most - 1));
}

const SHEET = 0.014;

/** Covers and pages, lying flat. The stack is what says how full the memory is. */
function Pages({ fill, width, depth, most }: { fill: number; width: number; depth: number; most: number }) {
  const sheets = sheetCount(fill, most);
  return (
    <group>
      {Array.from({ length: sheets }, (_, i) => (
        <Box
          key={i}
          p={[0, 0.03 + i * SHEET, 0]}
          s={[width * 0.94, SHEET * 0.8, depth * 0.94]}
          color={i % 2 ? '#e8e0c8' : PAPER}
        />
      ))}
      <Box p={[0, 0.04 + sheets * SHEET, 0]} s={[width, 0.018, depth]} color={C.walnut} />
    </group>
  );
}

/**
 * The floor's memory, as a ring binder on the meeting table. The taller the
 * stack, the fuller the floor's share of the memory budget.
 */
export function MemoryBinder({
  position,
  fill,
  onSelectProp,
}: {
  position: Point;
  fill: number;
  onSelectProp?: SelectProp;
}): JSX.Element {
  return (
    <Pickable kind="binder" onSelectProp={onSelectProp}>
      <group position={position}>
        <Box p={[0, 0.014, 0]} s={[0.54, 0.028, 0.44]} color="#4a5f52" />
        <Pages fill={fill} width={0.5} depth={0.4} most={9} />
        <Box p={[-0.21, 0.06, 0]} s={[0.045, 0.09, 0.42]} color={C.brass} metalness={0.6} roughness={0.35} />
      </group>
    </Pickable>
  );
}

/** One employee's own notes, on their desk. */
export function DeskNotebook({
  position,
  fill,
  color,
  employeeId,
  onSelectProp,
}: {
  position: Point;
  fill: number;
  color: string;
  employeeId: string;
  onSelectProp?: SelectProp;
}): JSX.Element {
  return (
    <Pickable kind="notebook" id={employeeId} onSelectProp={onSelectProp}>
      <group position={position} rotation={[0, 0.22, 0]}>
        <Box p={[0, 0.012, 0]} s={[0.29, 0.024, 0.36]} color={color} />
        <Pages fill={fill} width={0.26} depth={0.32} most={6} />
      </group>
    </Pickable>
  );
}

/** Claims in conflict, waiting on the lectern in a red-tabbed folder. */
export function ContestedFolder({
  position,
  count,
  onSelectProp,
}: {
  position: Point;
  count: number;
  onSelectProp?: SelectProp;
}): JSX.Element {
  return (
    <Pickable kind="contested" onSelectProp={onSelectProp}>
      <group position={position}>
        <Box p={[0, 0.011, 0]} s={[0.34, 0.022, 0.25]} color="#c8ab74" />
        <Box p={[0, 0.028, 0]} s={[0.31, 0.012, 0.22]} color={PAPER} />
        <Box p={[0, 0.042, 0]} s={[0.34, 0.016, 0.25]} color="#d3b881" />
        {Array.from({ length: Math.min(3, Math.max(1, count)) }, (_, i) => (
          <Box key={i} p={[0.09 - i * 0.09, 0.052, 0.115]} s={[0.075, 0.01, 0.05]} color={RED} />
        ))}
      </group>
    </Pickable>
  );
}

/** Open audit findings, delivered to a desk as a folder with a tab per finding. */
export function FindingsFolder({
  position,
  count,
  employeeId,
  onSelectProp,
}: {
  position: Point;
  count: number;
  employeeId: string;
  onSelectProp?: SelectProp;
}): JSX.Element {
  return (
    <Pickable kind="findings" id={employeeId} onSelectProp={onSelectProp}>
      <group position={position} rotation={[0, -0.3, 0]}>
        <Box p={[0, 0.012, 0]} s={[0.33, 0.024, 0.26]} color="#a8552f" />
        <Box p={[0, 0.03, 0.005]} s={[0.3, 0.014, 0.23]} color={PAPER} />
        {Array.from({ length: Math.min(3, Math.max(1, count)) }, (_, i) => (
          <Box key={i} p={[-0.09 + i * 0.09, 0.044, -0.12]} s={[0.075, 0.012, 0.05]} color={AMBER} />
        ))}
      </group>
    </Pickable>
  );
}

/** The task board's face, and the tile grid the cards sit in, in world units. */
const BOARD_WIDTH = 2.72;
const BOARD_HEIGHT = 1.58;
const CARD_STEP_X = 0.86;
const CARD_STEP_Y = 0.49;
const CARD_TILE: [number, number] = [0.76, 0.4];
export const STATUS_COLOR: Record<BoardStatus, string> = {
  active: '#6f9e5c',
  waiting: '#e0b262',
  blocked: '#c2543f',
  done: '#97a696',
};

/** Where a card's tile sits on the board's face. */
function cardCenter(column: number, row: number): { x: number; y: number } {
  return {
    x: (column - (BOARD_COLUMNS - 1) / 2) * CARD_STEP_X,
    y: ((BOARD_ROWS - 1) / 2 - row) * CARD_STEP_Y,
  };
}

/**
 * The floor's task board: a card per task, coloured by status, with a string
 * between every card and the card it waits for. The titles are not on the board
 * itself, which is a few centimetres of a room away; they are on the board's
 * card in the overlay, where the office keeps everything it expects to be read.
 */
export function TaskBoard({
  position,
  cards,
  onSelectProp,
}: {
  position: Point;
  cards: BoardCard[];
  onSelectProp?: SelectProp;
}): JSX.Element {
  const board = boardLayout(cards);
  const centers = new Map(board.cards.map((card) => [card.id, cardCenter(card.column, card.row)]));
  return (
    <group position={position}>
      {[-1, 1].map((side) => (
        <group key={side}>
          <Cylinder
            p={[side * 1.1, 0.5, 0.12]}
            radius={0.035}
            height={1.02}
            color={C.walnut}
            rotation={[0.16, 0, 0]}
          />
          <Box p={[side * 1.1, 0.02, 0.24]} s={[0.1, 0.04, 0.5]} color={C.walnut} />
        </group>
      ))}
      <group position={[0, 1.72, 0]}>
        <Round s={[BOARD_WIDTH + 0.14, BOARD_HEIGHT + 0.14, 0.07]} color={C.walnut} radius={0.03} />
        <Box p={[0, 0, 0.04]} s={[BOARD_WIDTH, BOARD_HEIGHT, 0.012]} color="#3c4a40" />
        {board.strings.map((string) => {
          const from = centers.get(string.from)!;
          const to = centers.get(string.to)!;
          const dx = to.x - from.x;
          const dy = to.y - from.y;
          return (
            <Box
              key={`${string.from} ${string.to}`}
              p={[from.x + dx / 2, from.y + dy / 2, 0.052]}
              s={[Math.hypot(dx, dy), 0.016, 0.006]}
              color="#e0c68a"
              rotation={[0, 0, Math.atan2(dy, dx)]}
            />
          );
        })}
        {board.cards.map((card) => {
          const { x, y } = centers.get(card.id)!;
          return (
            <Pickable key={card.id} kind="card" id={card.id} onSelectProp={onSelectProp}>
              <group position={[x, y, 0.058]}>
                <Box
                  s={[CARD_TILE[0], CARD_TILE[1], 0.012]}
                  color={card.status === 'done' ? '#ded9c3' : PAPER}
                />
                <Box
                  p={[-CARD_TILE[0] / 2 + 0.035, 0, 0.008]}
                  s={[0.07, CARD_TILE[1], 0.008]}
                  color={STATUS_COLOR[card.status]}
                />
                {[0.09, 0.01, -0.07].map((line, i) => (
                  <Box
                    key={line}
                    p={[0.03 - i * 0.04, line, 0.008]}
                    s={[0.5 - i * 0.08, 0.028, 0.006]}
                    color="#a9ac96"
                  />
                ))}
                {/* A pin at the card's centre, where its strings meet. */}
                <Cylinder
                  p={[0, 0, 0.02]}
                  radius={0.022}
                  height={0.03}
                  color={C.brass}
                  rotation={[Math.PI / 2, 0, 0]}
                />
              </group>
            </Pickable>
          );
        })}
      </group>
    </group>
  );
}

/** An amber beacon by the entrance: the floor is inside an incident. */
export function IncidentLamp({
  position,
  onSelectProp,
}: {
  position: Point;
  onSelectProp?: SelectProp;
}): JSX.Element {
  return (
    <Pickable kind="lamp" id="incident" onSelectProp={onSelectProp}>
      <group position={position}>
        <Cylinder p={[0, 0.045, 0]} radius={0.26} height={0.09} color="#3e4a42" />
        <Cylinder p={[0, 0.76, 0]} radius={0.045} height={1.45} color="#4b5a4f" />
        <Cylinder p={[0, 1.53, 0]} radius={0.17} height={0.06} color="#3e4a42" />
        <mesh position={[0, 1.62, 0]}>
          <sphereGeometry args={[0.16, 20, 14]} />
          <meshStandardMaterial color={AMBER} emissive={AMBER} emissiveIntensity={1.5} roughness={0.35} />
        </mesh>
        <Halo p={[0, 1.62, 0]} size={[1.9, 1.9]} color="#ffb347" opacity={0.62} />
        <pointLight position={[0, 1.66, 0]} color="#ffb347" intensity={2.4} distance={5} decay={2} />
      </group>
    </Pickable>
  );
}

/** The triage floor's alert board: one lamp per open incident, lit from the top. */
export function AlertBoard({
  position,
  count,
  onSelectProp,
}: {
  position: Point;
  count: number;
  onSelectProp?: SelectProp;
}): JSX.Element {
  const lamps = 6;
  const lit = Math.min(lamps, Math.max(0, count));
  return (
    <Pickable kind="alerts" onSelectProp={onSelectProp}>
      <group position={position} rotation={[0, Math.PI / 2, 0]}>
        <Round s={[1.08, 2.3, 0.09]} color="#2f3d36" radius={0.035} />
        <Box p={[0, 0.98, 0.055]} s={[0.84, 0.1, 0.012]} color="#546256" />
        {Array.from({ length: lamps }, (_, i) => (
          <group key={i} position={[0, 0.68 - i * 0.35, 0.06]}>
            <Box p={[-0.31, 0, 0]} s={[0.18, 0.2, 0.02]} color={i < lit ? RED : '#3b4740'} />
            <mesh position={[-0.31, 0, 0.021]}>
              <circleGeometry args={[0.072, 16]} />
              <meshBasicMaterial color={i < lit ? '#ff9c6a' : '#46534c'} toneMapped={false} />
            </mesh>
            <Box p={[0.1, 0, 0.012]} s={[0.56, 0.09, 0.012]} color={i < lit ? '#d8cfb2' : '#46534c'} />
          </group>
        ))}
        {lit > 0 && <Halo p={[-0.31, 0.22, 0.16]} size={[2, 2.4]} color="#ff8e63" opacity={0.42} />}
      </group>
    </Pickable>
  );
}

/** The big status lamp over the triage floor: amber while anything is open, green when it is clear. */
export function StatusLamp({
  position,
  rotation,
  alert,
  onSelectProp,
}: {
  position: Point;
  /** The wall it is mounted on. Without one it faces the room. */
  rotation?: Point;
  alert: boolean;
  onSelectProp?: SelectProp;
}): JSX.Element {
  const color = alert ? AMBER : '#7fb069';
  return (
    <Pickable kind="lamp" id="status" onSelectProp={onSelectProp}>
      <group position={position} rotation={rotation}>
        <Box p={[0, 0.42, -0.06]} s={[0.82, 0.14, 0.2]} color="#33423a" />
        <mesh position={[0, 0.06, 0]}>
          <sphereGeometry args={[0.38, 24, 16]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.6} roughness={0.4} />
        </mesh>
        <Halo p={[0, 0.06, 0.16]} size={[3.6, 3.6]} color={color} opacity={alert ? 0.72 : 0.4} />
        <pointLight position={[0, 0.1, 0.5]} color={color} intensity={alert ? 3.4 : 1.4} distance={7} />
      </group>
    </Pickable>
  );
}

/**
 * The lobby's calendar wall. The entries themselves are on its card in the
 * overlay; the wall carries one ruled line per entry, as a board does.
 */
export function CalendarWall({
  position,
  entries,
  onSelectProp,
}: {
  position: Point;
  entries: CalendarEntry[];
  onSelectProp?: SelectProp;
}): JSX.Element {
  const rows = Math.min(entries.length, CALENDAR_ENTRIES);
  return (
    <Pickable kind="calendar" onSelectProp={onSelectProp}>
      <group position={position}>
        <Round s={[2.3, 1.62, 0.08]} color="#2c3b33" radius={0.035} />
        <Box p={[0, 0, 0.045]} s={[2.16, 1.48, 0.014]} color="#f3eeda" />
        <Box p={[0, 0.58, 0.055]} s={[1.9, 0.075, 0.01]} color="#8a9a86" />
        {Array.from({ length: rows }, (_, i) => (
          <group key={i} position={[0, 0.36 - i * 0.21, 0.055]}>
            <Box p={[-0.83, 0, 0]} s={[0.36, 0.055, 0.01]} color="#b3a06a" />
            <Box p={[0.22, 0, 0]} s={[1.36, 0.045, 0.01]} color="#9aa894" />
          </group>
        ))}
        <GlowBar p={[0, -0.83, 0.02]} s={[2, 0.016, 0.02]} color="#d9c48f" />
      </group>
    </Pickable>
  );
}

/** The lift back to the rest of the tower. */
export function LiftDoor({
  position,
  onSelectProp,
}: {
  position: Point;
  onSelectProp?: SelectProp;
}): JSX.Element {
  return (
    <Pickable kind="lift" onSelectProp={onSelectProp}>
      <group position={position}>
        <Box p={[0, 1.12, 0]} s={[1.16, 2.32, 0.07]} color={C.brass} metalness={0.55} roughness={0.34} />
        {[-1, 1].map((side) => (
          <Box key={side} p={[side * 0.26, 1.08, 0.05]} s={[0.5, 2.12, 0.03]} color="#44574d" />
        ))}
        <Box p={[0, 1.08, 0.07]} s={[0.022, 2.12, 0.016]} color="#2a3830" />
        <Box p={[0, 2.38, 0.04]} s={[0.62, 0.2, 0.05]} color="#2f3d35" />
        <GlowBar p={[0, 2.38, 0.07]} s={[0.4, 0.08, 0.012]} color="#e8c98d" />
        <Box p={[0.72, 1.15, 0.05]} s={[0.12, 0.2, 0.03]} color="#2f3d35" />
        <GlowBar p={[0.72, 1.15, 0.068]} s={[0.06, 0.06, 0.01]} color="#ffd79a" />
      </group>
    </Pickable>
  );
}

/**
 * The janitor's cart: two shelves of binders to file, a sack, and a mop. The
 * janitor pushes one round the floors; the records room keeps one by the desk.
 */
export function JanitorCart({
  position,
  rotation = -0.4,
}: {
  position: Point;
  rotation?: number;
}): JSX.Element {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {[-1, 1].map((side) =>
        [-1, 1].map((end) => (
          <Cylinder
            key={`${side} ${end}`}
            p={[side * 0.36, 0.07, end * 0.22]}
            radius={0.07}
            height={0.05}
            color="#2f3a34"
            rotation={[0, 0, Math.PI / 2]}
          />
        )),
      )}
      <Box p={[0, 0.32, 0]} s={[0.92, 0.05, 0.58]} color="#7d8c7e" />
      <Box p={[0, 0.78, 0]} s={[0.92, 0.05, 0.58]} color="#7d8c7e" />
      {[-1, 1].map((side) => (
        <Box key={side} p={[side * 0.44, 0.55, -0.25]} s={[0.05, 0.95, 0.05]} color="#63715f" />
      ))}
      <Box p={[0, 1.04, -0.25]} s={[0.96, 0.05, 0.05]} color="#63715f" />
      {[0, 1, 2, 3, 4].map((i) => (
        <Box
          key={i}
          p={[-0.3 + i * 0.16, 0.98, 0.03]}
          s={[0.13, 0.35, 0.46]}
          color={[C.terra, C.sage, C.navy, '#d2c5a3', '#8a7a2b'][i]}
        />
      ))}
      <Round p={[0, 0.5, 0.05]} s={[0.6, 0.3, 0.45]} color="#4f5f55" radius={0.1} />
      <Cylinder p={[0.5, 0.82, 0.24]} radius={0.02} height={1.5} color="#9a7c4f" rotation={[0.18, 0, 0.2]} />
      <Round p={[0.66, 1.5, 0.32]} s={[0.22, 0.26, 0.16]} color="#b9b193" radius={0.06} />
    </group>
  );
}

/**
 * The desk lamp of someone on a cheap overnight shift: the same fitting the room
 * already has, lit, while the rest of the floor is dark.
 */
export function OvernightLamp({ position }: { position: Point }): JSX.Element {
  return (
    <group position={position}>
      <GlowBar p={[0, 0, 0]} s={[0.17, 0.016, 0.12]} color="#fff0cb" />
      <Halo p={[0, -0.05, 0]} size={[3.2, 3.2]} opacity={0.8} />
      <pointLight position={[0, -0.02, 0]} color="#ffdd9b" intensity={5} distance={5} decay={2} />
    </group>
  );
}
