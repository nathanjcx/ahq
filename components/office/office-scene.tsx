'use client';

import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { EmployeeActivity } from './activity';
import { daylight, type Daylight } from './daylight';
import { useOfficePan } from './office-pan';
import { FileCabinet, OfficeSpeakers } from './office-furniture';
import { EmployeeAvatar, type Station } from './office-people';
import { BoardNote, ProviderConsole, ReviewLectern, StatusDevice } from './office-signals';
import { SurfaceContext, desks, speakerPosition, useSurfaceTextures, type Point } from './office-primitives';
import { Architecture } from './office-room';

/** The one employee shape this component understands. */
export type OfficeEmployee = {
  id: string;
  name: string;
  role: string;
  status: string;
  color?: string;
  /** What this person is doing, from `deriveActivities`. Missing means idle. */
  state?: EmployeeActivity;
  /** Persona traits. They only ever tune the idle. */
  traits?: string[];
};

/** A provider this floor can reach, shown as a console the figures walk to. */
export type OfficeProvider = {
  id: string;
  name: string;
  color: string;
  degraded: boolean;
};

export type OfficeSceneProps = {
  employees: OfficeEmployee[];
  onSelect?: (id: string) => void;
  motion: boolean;
  /** Unit scale, 1 fits the room to the container. */
  zoom: number;
  /** Degrees relative to the initial view. */
  angle: number;
  resetKey: number;
  eventSource: HTMLDivElement;
  /** Connected providers on this floor, one console each. */
  providers?: OfficeProvider[];
  /** The latest board note, already short. Shown on the whiteboard. */
  note?: string;
  /** Fraction of the workspace token cap used, 0 to 1. 0 means no cap, so no dimming. */
  lightBudget?: number;
  /** Local hour, 0 to 24. Defaults to the viewer's clock. */
  hour?: number;
};

const ACTIVE_STATUSES = new Set(['working', 'review', 'ready']);
const IDLE: EmployeeActivity = { activity: 'idle', since: 0 };
/** The lectern people stand at while their work waits for a decision. */
const LECTERN: Point = [-0.75, 0, 1.05];
/** Provider consoles line the window wall, clear of the desks. */
const CONSOLE_X = -8.5;
const CONSOLE_Z = [-3.6, -1.7, 0.2, 2.1, 4];
const STATUS_DEVICE: Point = [-7.9, 1.55, -5.84];
const BOARD_NOTE: Point = [4.5, 2.16, -5.7];
const scratchSun = new THREE.Vector3();

export function isActiveEmployee(employee: OfficeEmployee): boolean {
  return ACTIVE_STATUSES.has(employee.status.trim().toLowerCase());
}

/** Yaw that makes a figure at `from` look at `to`. */
function facing(from: Point, to: Point): number {
  return Math.atan2(to[0] - from[0], to[2] - from[2]);
}

/** Camera fits the projected architecture to the actual Canvas container. */
function Framing({
  zoom,
  angle,
  resetKey = 0,
  source,
}: {
  zoom: number;
  angle: number;
  resetKey?: number;
  source: HTMLDivElement;
}) {
  const { camera, size, invalidate } = useThree();
  const pan = useOfficePan(camera, source, invalidate, resetKey);
  const previousReset = useRef(resetKey);
  useLayoutEffect(() => {
    if (!(camera instanceof THREE.OrthographicCamera)) return;
    if (previousReset.current !== resetKey) {
      pan.set(0, 0);
      previousReset.current = resetKey;
    }
    const azimuth = Math.PI / 4 + (angle * Math.PI) / 180;
    const target = new THREE.Vector3(0, 0.6, 0);
    camera.position.set(Math.sin(azimuth) * 28, 24.5, Math.cos(azimuth) * 28);
    camera.lookAt(target);
    camera.updateMatrixWorld(true);
    const bounds = new THREE.Box3();
    for (const x of [-9.5, 9.5])
      for (const y of [-0.7, 3.8])
        for (const z of [-6.5, 6.5]) {
          bounds.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse));
        }
    // Fit the floating horn at its loudest expansion without giving the
    // entire floor an unnecessarily tall bounding box.
    for (const x of [speakerPosition[0] - 1.6, speakerPosition[0] + 2.3])
      for (const y of [speakerPosition[1] - 2, speakerPosition[1] + 1.5])
        for (const z of [speakerPosition[2] - 0.5, speakerPosition[2] + 2.7]) {
          bounds.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse));
        }
    const w = bounds.max.x - bounds.min.x;
    const h = bounds.max.y - bounds.min.y;
    // Center the projected cutaway, including its raised back walls, rather
    // than assuming that the floor origin is the visual center.
    const center = bounds.getCenter(new THREE.Vector3());
    camera.translateX(center.x);
    camera.translateY(center.y);
    camera.translateX(pan.x);
    camera.translateY(pan.y);
    camera.updateMatrixWorld(true);
    const safeWidth = Math.max(100, size.width - (size.width < 500 ? 16 : 40));
    const safeHeight = Math.max(100, size.height - 32);
    camera.zoom = Math.min(safeWidth / w, safeHeight / h) * Math.max(0.5, zoom / 37);
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, size.width, size.height, zoom, angle, resetKey, pan, invalidate]);
  return null;
}

type Placed = {
  employee: OfficeEmployee;
  index: number;
  state: EmployeeActivity;
  station: Station;
  accent?: string;
};

/**
 * Puts everyone somewhere the room can explain: at their own desk, at a provider
 * console, at the review lectern, or turned toward the person they are handing
 * work to. Seats are sticky, so nobody swaps chairs while the office is open.
 */
function place(
  employees: OfficeEmployee[],
  providers: OfficeProvider[],
  seats: Map<string, number>,
): Placed[] {
  const taken = new Set(employees.map((employee) => seats.get(employee.id)));
  taken.delete(undefined);
  let free = 0;
  const seated = employees.map((employee) => {
    let seat = seats.get(employee.id);
    if (seat === undefined) {
      while (taken.has(free)) free += 1;
      seat = free;
      taken.add(seat);
      seats.set(employee.id, seat);
    }
    return { employee, seat };
  });
  const desk = (seat: number) => desks[seat % desks.length];
  const home = (seat: number): Point => [desk(seat)[0], 0, desk(seat)[2] + 1];
  const consoleFor = (provider?: string) => {
    const found = providers.findIndex((item) => item.id === provider);
    const slot = found >= 0 ? found : 0;
    return { slot, provider: providers[slot] };
  };
  let atLectern = 0;
  return seated.map(({ employee, seat }, index) => {
    const state = employee.state ?? IDLE;
    const activity = state.activity;
    const seat0 = home(seat);
    let station: Station = { at: seat0, facing: Math.PI };
    let accent: string | undefined;
    if (activity === 'reviewing') {
      const offset = atLectern++ * 0.85;
      const at: Point = [LECTERN[0] + offset, 0, LECTERN[2] - 0.95];
      station = { at, facing: facing(at, [LECTERN[0] + offset, 0, LECTERN[2]]) };
    } else if (activity === 'calling' && providers.length) {
      const { slot, provider } = consoleFor(state.provider);
      const z = CONSOLE_Z[slot % CONSOLE_Z.length];
      const at: Point = [CONSOLE_X + 0.85, 0, z];
      station = { at, facing: facing(at, [CONSOLE_X, 0, z]) };
      accent = provider?.color;
    } else if (activity === 'talking' || activity === 'celebrating') {
      const at: Point = [seat0[0], 0, seat0[2] + 0.85];
      const partner = state.partnerId
        ? seated.find((other) => other.employee.id === state.partnerId)
        : undefined;
      const toward: Point = partner
        ? [home(partner.seat)[0], 0, home(partner.seat)[2] + 0.85]
        : [at[0], 0, at[2] + 1];
      station = { at, facing: activity === 'talking' ? facing(at, toward) : 0 };
    }
    return { employee, index, state, station, ...(accent ? { accent } : {}) };
  });
}

/** Directional and ambient light follow the viewer's clock, and dim as the cap fills. */
function Lighting({ light, budget, motion }: { light: Daylight; budget: number; motion: boolean }) {
  const ambient = useRef<THREE.AmbientLight>(null);
  const sun = useRef<THREE.DirectionalLight>(null);
  // A cap that is nearly spent quietly takes the lights down.
  const dim = 1 - Math.min(0.35, Math.max(0, budget) * 0.35);
  const target = useMemo(
    () => ({ sun: new THREE.Color(light.sun), ambient: new THREE.Color(light.ambient) }),
    [light],
  );
  useFrame((_, delta) => {
    // Hours change slowly, so the blend is slow: a few seconds from dusk to night.
    const rate = Math.min(1, delta * 0.4);
    if (ambient.current) ambient.current.color.lerp(target.ambient, rate);
    if (sun.current) {
      sun.current.color.lerp(target.sun, rate);
      sun.current.position.lerp(scratchSun.set(...light.sunPosition), rate);
    }
  });
  return (
    <>
      <ambientLight ref={ambient} intensity={light.ambientIntensity * dim} color={light.ambient} />
      <hemisphereLight args={['#dce7df', '#3e4631', light.hemisphere * dim]} />
      <directionalLight
        ref={sun}
        position={light.sunPosition}
        intensity={light.sunIntensity * dim}
        color={light.sun}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-16}
        shadow-camera-right={16}
        shadow-camera-top={16}
        shadow-camera-bottom={-16}
        shadow-camera-near={0.1}
        shadow-camera-far={55}
        shadow-bias={-0.00015}
        shadow-normalBias={0.035}
        shadow-radius={4}
      />
      <directionalLight position={[10, 9, -2]} intensity={light.fillIntensity * dim} color={light.fill} />
      {/* Sun or moon, seen through the window wall. */}
      <mesh position={[-11.6, light.skyHeight, 4.2]} rotation={[0, -Math.PI / 2, 0]}>
        <circleGeometry args={[light.night ? 0.62 : 0.95, 32]} />
        <meshBasicMaterial color={light.disc} toneMapped={false} />
      </mesh>
    </>
  );
}

export function OfficeScene({
  employees,
  onSelect,
  motion,
  zoom,
  angle,
  resetKey,
  eventSource,
  providers = [],
  note,
  lightBudget = 0,
  hour,
}: OfficeSceneProps) {
  const surfaces = useSurfaceTextures();
  const seats = useRef(new Map<string, number>());
  const light = useMemo(() => daylight(hour ?? new Date().getHours()), [hour]);
  const people = useMemo(
    () => place(employees.filter(isActiveEmployee), providers, seats.current),
    [employees, providers],
  );
  const reviews = people.filter((person) => person.state.attention).length;
  const stuck = people.some((person) => person.state.attention === 'stuck');
  const degraded = providers.some((provider) => provider.degraded);
  return (
    <>
      <color attach="background" args={[light.background]} />
      <Framing zoom={zoom * 37} angle={angle} resetKey={resetKey} source={eventSource} />
      <Lighting light={light} budget={lightBudget} motion={motion} />
      <SurfaceContext.Provider value={surfaces}>
        <Architecture />
        <FileCabinet />
        <OfficeSpeakers />
        <group position={LECTERN} rotation={[0, Math.PI, 0]}>
          <ReviewLectern
            position={[0, 0, 0]}
            glowing={reviews > 0}
            motion={motion}
            label={reviews ? `${reviews} ${stuck ? 'waiting too long' : 'to review'}` : undefined}
            onSelect={() => {
              const waiting = people.find((person) => person.state.attention);
              if (waiting) onSelect?.(waiting.employee.id);
            }}
          />
        </group>
        {providers.slice(0, CONSOLE_Z.length).map((provider, index) => (
          // The console stands against the window wall with its screen facing the room.
          <group key={provider.id} position={[CONSOLE_X, 0, CONSOLE_Z[index]]} rotation={[0, Math.PI / 2, 0]}>
            <ProviderConsole
              position={[0, 0, 0]}
              color={provider.color}
              name={provider.name}
              degraded={provider.degraded}
              motion={motion}
            />
          </group>
        ))}
        <StatusDevice position={STATUS_DEVICE} degraded={degraded} motion={motion} />
        <BoardNote position={BOARD_NOTE} note={note} />
        {people.map((person) => (
          <EmployeeAvatar
            key={person.employee.id}
            employee={person.employee}
            index={person.index}
            state={person.state}
            station={person.station}
            accent={person.accent}
            motion={motion}
            onSelect={onSelect}
          />
        ))}
      </SurfaceContext.Provider>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.71, 0]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial color={light.ground} roughness={1} />
      </mesh>
      <gridHelper args={[200, 200, light.grid, light.grid]} position={[0, -0.7, 0]} />
    </>
  );
}
