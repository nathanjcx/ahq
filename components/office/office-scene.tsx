'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { EmployeeActivity } from './activity';
import { daylight, type Daylight } from './daylight';
import { rankBubbles, type LabelMode } from './office-labels';
import { useOfficePan } from './office-pan';
import { FileCabinet, OfficeSpeakers } from './office-furniture';
import { OfficeOverlay } from './office-overlay';
import { EmployeeAvatar } from './office-people';
import { BoardNote, ProviderConsole, ReviewLectern, StatusDevice } from './office-signals';
import { Halo, SurfaceContext, useSurfaceTextures, type Point } from './office-primitives';
import {
  CONSOLE_X,
  CONSOLE_Z,
  LECTERN,
  deskGrid,
  layoutStations,
  type Station,
} from './office-stations';
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
  /** The figure the viewer last picked. Its pill outranks everyone else's. */
  selectedId?: string;
  motion: boolean;
  /** Unit scale, 1 fits the room to the container. */
  zoom: number;
  /** Degrees relative to the initial view. */
  angle: number;
  resetKey: number;
  eventSource: HTMLDivElement;
  /** What the legend's Labels control is set to. */
  labels: LabelMode;
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
const STATUS_DEVICE: Point = [-7.9, 1.55, -5.84];
const BOARD_NOTE: Point = [4.5, 2.16, -5.7];
/** The floor plate and the people on it. Taller props are allowed to crop. */
const ROOM = { x: 9.3, y: 1.9, z: 6.3 };
/** How much of the tighter axis the room fills, on a wide stage and on a phone. */
const FILL = 0.8;
const FILL_COMPACT = 1.18;
/** A stage narrower than this gets the closer framing and the compact chrome. */
const COMPACT_WIDTH = 560;
/** Two bubbles only once the stage is genuinely wide. */
const WIDE_WIDTH = 1200;
/** One bubble holds the floor this long before the next candidate takes its turn. */
const BUBBLE_TURN_MS = 6_000;
const scratchSun = new THREE.Vector3();
const corner = new THREE.Vector3();

export function isActiveEmployee(employee: OfficeEmployee): boolean {
  return ACTIVE_STATUSES.has(employee.status.trim().toLowerCase());
}

/**
 * Fits the floor plate to the actual Canvas container: about `FILL` of whichever
 * axis is tighter, centred on the room, or closer and centred on the desks when
 * the stage is only as wide as a phone. Everything above head height, the ceiling
 * lamp included, is allowed to crop.
 */
function Framing({
  zoom,
  angle,
  resetKey = 0,
  source,
  cluster,
}: {
  zoom: number;
  angle: number;
  resetKey?: number;
  source: HTMLDivElement;
  /** Where the busiest part of the floor is, for the close framing. */
  cluster: Point;
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
    const compact = size.width < COMPACT_WIDTH;
    const azimuth = Math.PI / 4 + (angle * Math.PI) / 180;
    camera.position.set(Math.sin(azimuth) * 28, 24.5, Math.cos(azimuth) * 28);
    camera.lookAt(compact ? new THREE.Vector3(...cluster) : new THREE.Vector3(0, 0.6, 0));
    camera.updateMatrixWorld(true);
    const bounds = new THREE.Box3();
    for (const x of [-ROOM.x, ROOM.x])
      for (const y of [0, ROOM.y])
        for (const z of [-ROOM.z, ROOM.z])
          bounds.expandByPoint(corner.set(x, y, z).applyMatrix4(camera.matrixWorldInverse));
    const width = bounds.max.x - bounds.min.x;
    const height = bounds.max.y - bounds.min.y;
    if (!compact) {
      // Centre the projected plate rather than assuming the floor origin is its
      // visual centre; the close framing is already centred on the cluster.
      const center = bounds.getCenter(corner);
      camera.translateX(center.x);
      camera.translateY(center.y);
    }
    camera.translateX(pan.x);
    camera.translateY(pan.y);
    camera.updateMatrixWorld(true);
    const safeWidth = Math.max(100, size.width - (compact ? 12 : 32));
    const safeHeight = Math.max(100, size.height - 24);
    const fit = Math.min(safeWidth / width, safeHeight / height);
    camera.zoom = fit * (compact ? FILL_COMPACT : FILL) * zoom;
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, size.width, size.height, zoom, angle, resetKey, pan, invalidate, cluster]);
  return null;
}

type Placed = {
  employee: OfficeEmployee;
  index: number;
  state: EmployeeActivity;
  station: Station;
  accent?: string;
};

/** Directional and ambient light follow the viewer's clock, and dim as the cap fills. */
function Lighting({ light, budget }: { light: Daylight; budget: number }) {
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
      <hemisphereLight
        args={[light.night ? '#8ea6c8' : '#dce7df', light.night ? '#2a3340' : '#3e4631', light.hemisphere * dim]}
      />
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
        <circleGeometry args={[light.night ? 0.78 : 0.95, 32]} />
        <meshBasicMaterial color={light.disc} toneMapped={false} />
      </mesh>
      <Halo
        p={[-11.5, light.skyHeight, 4.2]}
        size={[4.6, 4.6]}
        color={light.disc}
        opacity={0.2 + light.interior * 0.4}
      />
    </>
  );
}

export function OfficeScene({
  employees,
  onSelect,
  selectedId,
  motion,
  zoom,
  angle,
  resetKey,
  eventSource,
  labels,
  providers = [],
  note,
  lightBudget = 0,
  hour,
}: OfficeSceneProps) {
  const { size } = useThree();
  const surfaces = useSurfaceTextures();
  const seats = useRef(new Map<string, number>());
  const light = useMemo(() => daylight(hour ?? new Date().getHours()), [hour]);
  const present = useMemo(() => employees.filter(isActiveEmployee), [employees]);
  const desks = useMemo(() => deskGrid(present.length), [present.length]);
  const people: Placed[] = useMemo(() => {
    const states = present.map((employee) => employee.state ?? IDLE);
    const stations = layoutStations({
      people: present.map((employee, index) => ({ id: employee.id, state: states[index] })),
      providers,
      seats: seats.current,
    });
    return present.map((employee, index) => ({
      employee,
      index,
      state: states[index],
      station: stations[index].station,
      ...(stations[index].accent ? { accent: stations[index].accent } : {}),
    }));
  }, [present, providers]);

  // The desks are where a floor's work happens, so a phone opens on them.
  const cluster = useMemo((): Point => {
    const middle = desks.reduce((total, desk) => total + desk[2], 0) / Math.max(1, desks.length);
    return [-4.7, 0.6, middle + 0.5];
  }, [desks]);

  const waiting = people.filter((person) => person.state.attention);
  const stuck = waiting.some((person) => person.state.attention === 'stuck');
  const degraded = providers.some((provider) => provider.degraded);
  const speaking = useSpeaking(people, size.width);

  return (
    <>
      <color attach="background" args={[light.background]} />
      <Framing zoom={zoom} angle={angle} resetKey={resetKey} source={eventSource} cluster={cluster} />
      <SurfaceContext.Provider value={surfaces}>
        <Lighting light={light} budget={lightBudget} />
        <Architecture desks={desks} interior={light.interior} />
        <FileCabinet />
        <OfficeSpeakers />
        <group position={LECTERN} rotation={[0, Math.PI, 0]}>
          <ReviewLectern
            position={[0, 0, 0]}
            waiting={waiting.length}
            stuck={stuck}
            motion={motion}
            onSelect={() => {
              if (waiting.length) onSelect?.(waiting[0].employee.id);
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
        <OfficeOverlay>
          {people.map((person) => (
            <EmployeeAvatar
              key={person.employee.id}
              employee={person.employee}
              index={person.index}
              state={person.state}
              station={person.station}
              accent={person.accent}
              motion={motion}
              mode={labels}
              selected={person.employee.id === selectedId}
              speaking={speaking.has(person.employee.id)}
              onSelect={onSelect}
            />
          ))}
        </OfficeOverlay>
      </SurfaceContext.Provider>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.71, 0]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial color={light.ground} roughness={1} />
      </mesh>
      <gridHelper args={[200, 200, light.grid, light.grid]} position={[0, -0.7, 0]} />
    </>
  );
}

/**
 * Which figures are speaking right now. The floor shows one line at a time, two
 * once the stage is wide, and hands the floor to the next candidate every six
 * seconds so a quiet message still gets its turn.
 */
function useSpeaking(people: Placed[], width: number): Set<string> {
  const slots = width >= WIDE_WIDTH ? 2 : 1;
  const ranked = useMemo(
    () =>
      rankBubbles(
        people
          .filter((person) => person.state.bubble)
          .map((person) => ({
            id: person.employee.id,
            activity: person.state.activity,
            ...(person.state.attention ? { attention: person.state.attention } : {}),
            since: person.state.since,
          })),
      ),
    [people],
  );
  const [turn, setTurn] = useState(0);
  useEffect(() => {
    if (ranked.length <= slots) return;
    const timer = setInterval(() => setTurn((current) => current + slots), BUBBLE_TURN_MS);
    return () => clearInterval(timer);
  }, [ranked, slots]);
  return useMemo(() => {
    if (!ranked.length) return new Set<string>();
    const start = ((turn % ranked.length) + ranked.length) % ranked.length;
    return new Set(
      Array.from({ length: Math.min(slots, ranked.length) }, (_, i) => ranked[(start + i) % ranked.length]),
    );
  }, [ranked, slots, turn]);
}
