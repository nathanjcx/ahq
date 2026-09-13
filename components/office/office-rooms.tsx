'use client';

import type { JSX, ReactNode } from 'react';
import { OperationsDisplay } from './office-details';
import { Chair, Desk, Plant } from './office-furniture';
import { boardroomSeats, shelfLayout, TABLE, type ShelfPlacement, type ShelfSpec } from './office-layout';
import { Static } from './office-merge';
import { Box, C, Cylinder, GlowBar, Halo, Round, type Point } from './office-primitives';
import { JanitorCart, LiftDoor, Pickable, type SelectProp } from './office-props';

/**
 * The two rooms that are not a floor: the basement records room and the top-floor
 * boardroom. Both stand on the same plate and keep the same two walls as the
 * floor, so the camera framing and the isometric read carry over unchanged.
 */

/** The plate, the two walls, and the trim every room in the tower shares. */
function RoomShell({
  floor,
  wall,
  glazed,
  children,
}: {
  floor: string;
  wall: string;
  /** A glazed window wall, cut like the floors'. Without it the wall is solid. */
  glazed?: boolean;
  children: ReactNode;
}) {
  return (
    <group>
      <Round p={[0, -0.48, 0]} s={[18.47, 0.31, 12.47]} color="#1e3029" radius={0.055} />
      <Round p={[0, -0.21, 0]} s={[18.1, 0.4, 12.1]} color="#283930" radius={0.08} />
      <Box p={[0, -0.015, 0]} s={[18, 0.05, 12]} color={floor} roughness={0.85} receiveShadow />
      <Box
        p={[0, -0.318, 6.215]}
        s={[18.37, 0.022, 0.035]}
        color={C.brass}
        metalness={0.72}
        roughness={0.27}
      />
      <Box p={[0, 1.55, -6]} s={[18.1, 3.1, 0.17]} color={wall} />
      {glazed ? (
        <group>
          <Box p={[-9, 0.49, 0]} s={[0.17, 0.98, 12.1]} color={wall} />
          <Box p={[-9, 3, 0]} s={[0.17, 0.2, 12.1]} color={wall} />
          {(
            [
              [-5.69, 0.62],
              [-0.8, 1.24],
              [4.89, 2.22],
            ] as const
          ).map(([z, width]) => (
            <Box key={z} p={[-9, 1.95, z]} s={[0.17, 1.94, width]} color={wall} />
          ))}
        </group>
      ) : (
        <Box p={[-9, 1.55, 0]} s={[0.17, 3.1, 12.1]} color={wall} />
      )}
      <Box p={[0, 0.15, -5.88]} s={[17.9, 0.25, 0.055]} color={C.trim} />
      <Box p={[-8.89, 0.15, 0]} s={[0.055, 0.25, 11.9]} color={C.trim} />
      <Box p={[0, 3.1, -6]} s={[18.2, 0.09, 0.24]} color={C.trim} />
      <Box p={[-9, 3.1, 0]} s={[0.24, 0.09, 12.1]} color={C.trim} />
      {children}
    </group>
  );
}

/** A ceiling fixture: the same linear lamp the floor hangs over its meeting table. */
function Pendant({
  p,
  length,
  interior,
  color = '#24372e',
}: {
  p: Point;
  length: number;
  interior: number;
  color?: string;
}) {
  return (
    <group position={p}>
      {[-1, 1].map((side) => (
        <Cylinder
          key={side}
          p={[(side * length) / 3, 0.32, 0]}
          radius={0.009}
          height={0.62}
          color="#4b594b"
        />
      ))}
      <Round s={[length, 0.095, 0.22]} color={color} radius={0.025} />
      <GlowBar p={[0, -0.055, 0]} s={[length - 0.2, 0.015, 0.155]} />
      <Halo p={[0, -0.2, 0]} size={[length + 1.8, 1.9]} opacity={0.14 + interior * 0.45} />
      <pointLight position={[0, -0.25, 0]} color="#ffd9a0" intensity={3 + interior * 7} distance={11} />
    </group>
  );
}

/** A contested claim's binder: a red nothing else on the shelves is near, and it
 *  stands proud of the row so the colour is not the only thing saying so. */
const CONTESTED = '#cf2b46';

const SCOPE_COLORS: Record<string, string> = {
  workspace: C.navy,
  floor: C.sage,
  project: C.terra,
  agent: '#8a7a2b',
  task: '#5b7d86',
};
/** Four compartments of nine binders each: the shelf is full at thirty-six claims. */
const SHELF_ROWS = 4;
const SHELF_SLOTS = 9;
const ROW_Y = [1.93, 1.39, 0.85, 0.31];

/** How many binder slots a fill of 0 to 1 fills, and how many of those are contested. */
export function shelfBinders(shelf: ShelfSpec): { filled: number; contested: number } {
  const filled = Math.round(Math.min(1, Math.max(0, shelf.fill)) * SHELF_ROWS * SHELF_SLOTS);
  return { filled, contested: Math.min(filled, Math.max(0, shelf.contested)) };
}

/**
 * One scope's casework. Workspace scope is a closed cabinet, task scope is a bank
 * of dossier drawers, everything else is open binders; contested claims stand at
 * the front of the top row with red tabs.
 */
function RecordsShelf({ shelf, onSelectProp }: { shelf: ShelfPlacement; onSelectProp?: SelectProp }) {
  const color = SCOPE_COLORS[shelf.scope] ?? C.sage;
  const { filled, contested } = shelfBinders(shelf);
  const drawers = shelf.scope === 'task';
  const doors = shelf.scope === 'workspace';
  return (
    <Pickable kind="shelf" id={shelf.name} onSelectProp={onSelectProp}>
      {/* Nine binders a row, four rows, six casework runs: merged inside the
          Pickable, so the merged copy is what the click lands on. */}
      <Static revision={`${shelf.name} ${filled} ${contested}`}>
        <group position={shelf.position}>
          <Box p={[0, 1.12, -0.3]} s={[1.8, 2.24, 0.06]} color="#6f7f72" />
          {[-1, 1].map((side) => (
            <Round
              key={side}
              p={[side * 0.87, 1.12, 0]}
              s={[0.07, 2.24, 0.62]}
              color="#7f8f80"
              radius={0.02}
            />
          ))}
          <Round p={[0, 2.26, 0]} s={[1.86, 0.08, 0.66]} color="#7f8f80" radius={0.02} />
          <Box p={[0, 0.06, 0]} s={[1.8, 0.12, 0.62]} color="#4d5b51" />
          {/* A painted colour band names the scope from across the room. */}
          <Box p={[0, 2.33, 0.28]} s={[1.5, 0.055, 0.03]} color={color} />
          {ROW_Y.map((y, row) => (
            <group key={y}>
              <Box p={[0, y - 0.27, 0]} s={[1.72, 0.055, 0.6]} color="#93a293" />
              {drawers ? (
                <group>
                  <Round p={[0, y, 0.3]} s={[1.66, 0.47, 0.07]} color="#a7b5a2" radius={0.02} />
                  <Box p={[0, y + 0.02, 0.35]} s={[0.3, 0.075, 0.025]} color={C.brass} />
                  <Box
                    p={[-0.55, y + 0.14, 0.35]}
                    s={[0.42, 0.1, 0.02]}
                    color={row * SHELF_SLOTS < filled ? color : '#dcd8c4'}
                  />
                </group>
              ) : doors && row > 1 ? (
                <group>
                  <Round p={[0, y, 0.3]} s={[1.66, 0.5, 0.05]} color="#a7b5a2" radius={0.02} />
                  {[-1, 1].map((side) => (
                    <Cylinder
                      key={side}
                      p={[side * 0.1, y, 0.34]}
                      radius={0.018}
                      height={0.24}
                      color={C.brass}
                    />
                  ))}
                </group>
              ) : (
                Array.from({ length: SHELF_SLOTS }, (_, i) => {
                  const index = row * SHELF_SLOTS + i;
                  if (index >= filled) return null;
                  const red = index >= filled - contested;
                  return (
                    <group key={i}>
                      <Box
                        p={[-0.72 + i * 0.18, y - 0.05, red ? 0.1 : 0.02]}
                        s={[0.15, 0.38 + (i % 3) * 0.03, red ? 0.56 : 0.5]}
                        color={red ? CONTESTED : i % 4 === 0 ? '#d7cdb2' : color}
                      />
                      <Box
                        p={[-0.72 + i * 0.18, y + 0.06, red ? 0.382 : 0.272]}
                        s={[0.1, 0.075, 0.006]}
                        color={red ? CONTESTED : '#efe9d8'}
                      />
                    </group>
                  );
                })
              )}
            </group>
          ))}
        </group>
      </Static>
    </Pickable>
  );
}

/**
 * The basement records room: one row of casework per memory scope, the janitor's
 * desk and cart, and the lift back up to the lobby.
 */
export function RecordsRoom({
  shelves,
  interior,
  onSelectProp,
}: {
  shelves: ShelfSpec[];
  interior: number;
  onSelectProp?: SelectProp;
}): JSX.Element {
  const placed = shelfLayout(shelves);
  return (
    <RoomShell floor="#8f9289" wall="#b9b6a8">
      {/* A basement has no windows: a run of ceiling fixtures does all the work. */}
      {[-4.4, 1.4].map((x) => (
        <Pendant key={x} p={[x, 2.85, -2.2]} length={4.6} interior={interior} />
      ))}
      <Pendant p={[4.9, 2.85, 2.4]} length={3.4} interior={interior} />
      {placed.map((shelf) => (
        <RecordsShelf key={shelf.name} shelf={shelf} onSelectProp={onSelectProp} />
      ))}
      {/* Painted aisle markings, so the empty half of the room still reads as a store. */}
      {[-2.9, 0.4].map((z) => (
        <Box key={z} p={[0, 0.012, z]} s={[15.6, 0.012, 0.05]} color="#b3a06a" castShadow={false} />
      ))}
      <group position={[4.9, 0, 1.35]} rotation={[0, Math.PI / 2, 0]}>
        <Desk position={[0, 0, 0]} index={0} />
      </group>
      <JanitorCart position={[6.4, 0, 3.6]} />
      <LiftDoor position={[-8.5, 0, -5.88]} onSelectProp={onSelectProp} />
      <Plant position={[7.9, 0, -4.9]} size={1.2} pot="#9aa294" />
      <Plant position={[-8.1, 0, 4.9]} size={1.1} />
    </RoomShell>
  );
}

/** The chairs the boardroom always has, whether or not anyone is in them. */
const BOARDROOM_CHAIRS = boardroomSeats(8);

/**
 * The top-floor boardroom: one long table under a run of pendants, glazing along
 * the window wall, and the lift the attendees arrive by. Empty out of meetings.
 */
export function Boardroom({
  interior,
  onSelectProp,
}: {
  interior: number;
  onSelectProp?: SelectProp;
}): JSX.Element {
  return (
    <RoomShell floor="#9d8763" wall={C.wall} glazed>
      <Round p={[TABLE.x, 0.035, TABLE.z]} s={[12.6, 0.06, 7.2]} color={C.rug} radius={0.1} />
      {[-1, 1].map((side) => (
        <Box
          key={side}
          p={[TABLE.x, 0.073, TABLE.z + side * 3.25]}
          s={[12.1, 0.009, 0.024]}
          color="#b6b99e"
        />
      ))}
      <Round
        p={[TABLE.x, 0.77, TABLE.z]}
        s={[TABLE.halfLength * 2, 0.14, TABLE.halfWidth * 2]}
        color={C.walnut}
        radius={0.06}
      />
      {[-1, 1].map((side) => (
        <Box key={side} p={[TABLE.x + side * 2.3, 0.36, TABLE.z]} s={[0.34, 0.72, 1.5]} color={C.walnut} />
      ))}
      {/* The table is dressed for a meeting: pads, glasses, and a carafe. */}
      {BOARDROOM_CHAIRS.map((seat) => (
        <group key={`${seat.at[0]} ${seat.at[2]}`}>
          <Chair
            p={seat.at}
            color={seat.facing === Math.PI ? C.navy : C.sage}
            rotation={seat.facing + Math.PI}
          />
          <Box
            p={[seat.at[0], 0.85, TABLE.z + Math.sign(seat.at[2] - TABLE.z) * 0.86]}
            s={[0.52, 0.02, 0.38]}
            color="#efe9d6"
          />
          <Cylinder
            p={[seat.at[0] + 0.34, 0.9, TABLE.z + Math.sign(seat.at[2] - TABLE.z) * 0.56]}
            radius={0.055}
            height={0.12}
            color="#cfd8cf"
          />
        </group>
      ))}
      <Cylinder p={[TABLE.x, 0.95, TABLE.z]} radius={0.11} height={0.22} color="#98a79b" />
      {[-1, 1].map((side) => (
        <Pendant
          key={side}
          p={[TABLE.x + side * 2.1, 2.72, TABLE.z]}
          length={3.2}
          interior={interior}
          color={C.walnut}
        />
      ))}
      {/* The window wall: full-height glazing with the tower's own mullions. */}
      {[-3.4, 1.8].map((z) => (
        <group key={z} position={[-8.88, 1.92, z]}>
          <mesh>
            <boxGeometry args={[0.025, 1.82, 3.88]} />
            <meshPhysicalMaterial
              color="#7aa49b"
              transparent
              opacity={0.28}
              roughness={0.08}
              metalness={0.25}
              depthWrite={false}
            />
          </mesh>
          {[-1, 0, 1].map((i) => (
            <Box key={i} p={[0.08, 0, i * 1.84]} s={[0.11, 1.79, 0.07]} color={C.trim} />
          ))}
          {[-0.84, 0.84].map((y) => (
            <Box key={y} p={[0.08, y, 0]} s={[0.11, 0.07, 3.85]} color={C.trim} />
          ))}
          <Box p={[0.15, -0.89, 0]} s={[0.36, 0.09, 4]} color={C.trim} />
          <Halo
            p={[-0.22, 0, 0]}
            size={[4.6, 2.6]}
            rotation={[0, -Math.PI / 2, 0]}
            color="#ffca82"
            opacity={interior * 0.42}
          />
        </group>
      ))}
      <OperationsDisplay />
      {/* A credenza under the screen, for the papers a meeting arrives with. */}
      <group position={[-5.68, 0, -5.5]}>
        <Round p={[0, 0.42, 0]} s={[3.4, 0.84, 0.62]} color={C.walnut} radius={0.04} />
        <Box p={[0, 0.86, 0]} s={[3.5, 0.06, 0.7]} color={C.desk} />
        {[-1, 1].map((side) => (
          <Box key={side} p={[side * 0.85, 0.42, 0.32]} s={[1.5, 0.6, 0.03]} color="#6a4f37" />
        ))}
      </group>
      <LiftDoor position={[-8.5, 0, -5.88]} onSelectProp={onSelectProp} />
      <Plant position={[7.9, 0, -4.9]} size={1.35} />
      <Plant position={[8.1, 0, 4.6]} size={1.2} pot="#b58f73" />
    </RoomShell>
  );
}
