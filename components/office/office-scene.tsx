'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { isWorking, type EmployeeActivity } from './activity';
import { afterHours, daylight, windowless, type Daylight } from './daylight';
import { FileCabinet, OfficeSpeakers } from './office-furniture';
import { rankBubbles, type LabelMode } from './office-labels';
import {
  boardroomSeats,
  cardPin,
  defaultShelves,
  recordsStations,
  type BoardCard,
  type CalendarEntry,
  type ShelfSpec,
} from './office-layout';
import { Static } from './office-merge';
import { OfficeOverlay } from './office-overlay';
import { useOfficePan } from './office-pan';
import { EmployeeAvatar, isSeated, type EmployeeKind } from './office-people';
import { C, Halo, SurfaceContext, useSurfaceTextures, type Point } from './office-primitives';
import {
  AlertBoard,
  CalendarWall,
  ContestedFolder,
  DeskNotebook,
  EmergencyNotice,
  FindingsFolder,
  IncidentLamp,
  LiftDoor,
  MemoryBinder,
  StatusLamp,
  TaskBoard,
  WaitingString,
  type SelectProp,
} from './office-props';
import { Architecture } from './office-room';
import { Boardroom, RecordsRoom } from './office-rooms';
import {
  BoardNote,
  CalendarCard,
  MeetingMurmur,
  ProviderConsole,
  ReviewLectern,
  StatusDevice,
  TaskCards,
} from './office-signals';
import {
  BINDER,
  CONSOLE_X,
  CONSOLE_Z,
  DOORWAY,
  INCIDENT_LAMP,
  LECTERN,
  TASK_BOARD,
  deskGrid,
  layoutStations,
  type Station,
} from './office-stations';

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
  /** Reserved kinds get their own kit: a cart, a dark coat, a high-visibility vest. */
  kind?: EmployeeKind;
};

/** Which room of the tower the stage is showing. */
export type OfficeRoom = 'floor' | 'lobby' | 'records' | 'boardroom' | 'triage';

/**
 * Everything the rooms dress themselves with beyond their people: memory, the
 * board, findings, the schedule, the meeting, and which room this is. All of it
 * is optional, and a room with none of it is the office as it was.
 */
export type OfficeDressing = {
  /** How full the floor's memory is, and each employee's own notebook. */
  memory?: { floorFill: number; agentFills: Map<string, number>; contested: number };
  board?: { cards: BoardCard[] };
  /** Open audit findings per employee. */
  findings?: Map<string, number>;
  incident?: boolean;
  /** Open incidents, for the triage floor's alert board. */
  incidentCount?: number;
  schedule?: { working: boolean; attended: boolean; overnightCheap: boolean };
  meeting?: { attendeeIds: string[]; speakingId?: string; live?: boolean };
  /** Triage acted without permission: the floor carries the notice by the door. */
  emergency?: { title: string; since: number };
  /** Named shelves for the records room. Without them the room derives them from memory. */
  records?: { shelves: ShelfSpec[] };
  calendar?: CalendarEntry[];
  room?: OfficeRoom;
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
  /** The rooms and the props they hold. */
  dressing?: OfficeDressing;
  /** Called when a prop is clicked: the binder, a notebook, a card, a shelf, a lamp. */
  onSelectProp?: SelectProp;
};

const ACTIVE_STATUSES = new Set(['working', 'review', 'ready']);
const IDLE: EmployeeActivity = { activity: 'idle', since: 0 };
const STATUS_DEVICE: Point = [-7.9, 1.55, -5.84];
const BOARD_NOTE: Point = [4.5, 2.16, -5.7];
/** The floor plate and the people on it. Taller props are allowed to crop. */
const ROOM = { x: 9.3, y: 1.9, z: 6.3 };
/** How much of the tighter axis the room fills, on a wide stage and on a phone. */
const FILL = 0.85;
const FILL_COMPACT = 1.18;
/** A stage narrower than this gets the closer framing and the compact chrome. */
const COMPACT_WIDTH = 560;
/** A fixed card is a list to read; on a stage narrower than this it covers the room
 *  instead, so the phone gets the room and the page around it carries the words. */
const CARD_STAGE_WIDTH = 420;
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
  const { camera, size, invalidate, get } = useThree();
  const pan = useOfficePan(camera, source, invalidate, resetKey);
  const previousReset = useRef(resetKey);
  useLayoutEffect(() => {
    // The live camera, read from the renderer rather than captured at render:
    // fitting the room is an imperative pass over an object React does not own.
    const view = get().camera;
    if (!(view instanceof THREE.OrthographicCamera)) return;
    if (previousReset.current !== resetKey) {
      pan.set(0, 0);
      previousReset.current = resetKey;
    }
    const compact = size.width < COMPACT_WIDTH;
    const azimuth = Math.PI / 4 + (angle * Math.PI) / 180;
    view.position.set(Math.sin(azimuth) * 28, 24.5, Math.cos(azimuth) * 28);
    view.lookAt(compact ? new THREE.Vector3(...cluster) : new THREE.Vector3(0, 0.6, 0));
    view.updateMatrixWorld(true);
    const bounds = new THREE.Box3();
    for (const x of [-ROOM.x, ROOM.x])
      for (const y of [0, ROOM.y])
        for (const z of [-ROOM.z, ROOM.z])
          bounds.expandByPoint(corner.set(x, y, z).applyMatrix4(view.matrixWorldInverse));
    const width = bounds.max.x - bounds.min.x;
    const height = bounds.max.y - bounds.min.y;
    if (!compact) {
      // Centre the projected plate rather than assuming the floor origin is its
      // visual centre; the close framing is already centred on the cluster.
      const center = bounds.getCenter(corner);
      view.translateX(center.x);
      view.translateY(center.y);
    }
    view.translateX(pan.x);
    view.translateY(pan.y);
    view.updateMatrixWorld(true);
    const safeWidth = Math.max(100, size.width - (compact ? 12 : 32));
    const safeHeight = Math.max(100, size.height - 24);
    const fit = Math.min(safeWidth / width, safeHeight / height);
    view.zoom = fit * (compact ? FILL_COMPACT : FILL) * zoom;
    view.updateProjectionMatrix();
    invalidate();
  }, [get, size.width, size.height, zoom, angle, resetKey, pan, invalidate, cluster]);
  return null;
}

type Placed = {
  employee: OfficeEmployee;
  index: number;
  state: EmployeeActivity;
  station: Station;
  /** Which home station this person owns, so their desk can carry their paper. */
  home: number;
  accent?: string;
};

const EMPTY_DRESSING: OfficeDressing = {};
/** The floor's props, in the room's coordinates. Desk props are in the desk's own.
 *  The ones a figure walks to live in office-stations, so both agree on where they are. */
const CALENDAR_WALL: Point = [2.75, 1.72, -0.6];
/** On the back wall beside the door, at eye height, where a notice is read on the way in. */
const NOTICE: Point = [-8.35, 1.62, -5.78];
/** A waiting figure holds its string at about chest height. */
const STRING_HEIGHT = 1.18;
/** The overlay cards hang above the props they belong to. The board's card stands
 *  beside the board over the open floor between it and the lounge, rather than
 *  above it over the desks. */
const TASK_CARDS: Point = [2.2, 1.4, 3.6];
/** On the wall it reads out, low enough to clear anyone huddled in the middle of
 *  the room and central enough to stay inside a narrow stage. */
const CALENDAR_CARD: Point = [2.75, 1, -0.6];
/** The triage signals stack on the window wall's pier: the board, then the lamp. */
const ALERT_BOARD: Point = [-8.86, 1.4, -0.8];
const STATUS_LAMP: Point = [-8.8, 2.66, -0.8];
const NOTEBOOK: Point = [-1, 0.985, -0.3];
const FINDINGS: Point = [0.3, 0.985, 0.33];

/** Directional and ambient light follow the viewer's clock, and dim as the cap fills. */
function Lighting({ light, budget, sky = true }: { light: Daylight; budget: number; sky?: boolean }) {
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
        args={[
          light.night ? '#8ea6c8' : '#dce7df',
          light.night ? '#2a3340' : '#3e4631',
          light.hemisphere * dim,
        ]}
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
      {/* Sun or moon, seen through the window wall. A basement has neither. */}
      {sky && (
        <>
          <mesh position={[-11.6, light.skyHeight, 4.2]} rotation={[0, -Math.PI / 2, 0]}>
            <circleGeometry args={[light.night ? 0.78 : 0.95, 32]} />
            <meshBasicMaterial color={light.disc} toneMapped={false} />
          </mesh>
          <Halo
            p={[-11.5, light.skyHeight, 4.2]}
            size={[4.6, 4.6]}
            color={light.disc}
            opacity={light.interior * 0.55}
          />
        </>
      )}
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
  dressing = EMPTY_DRESSING,
  onSelectProp,
}: OfficeSceneProps) {
  const { size } = useThree();
  const cardsFit = size.width >= CARD_STAGE_WIDTH;
  const surfaces = useSurfaceTextures();
  // Sticky desk assignments. A plain stable object rather than a ref: losing it
  // only means the room picks the chairs again, which nobody can tell apart.
  const seats = useMemo(() => new Map<string, number>(), []);
  const room = dressing.room ?? 'floor';
  const { schedule, meeting } = dressing;
  const light = useMemo(() => {
    const clock = daylight(hour ?? new Date().getHours());
    if (room === 'records') return windowless(clock);
    return schedule && !schedule.working ? afterHours(clock) : clock;
  }, [hour, room, schedule]);
  const onFloor = room !== 'records' && room !== 'boardroom';
  // Somebody off shift has gone home, so the floor does not hold a chair for them.
  const active = useMemo(
    () => employees.filter((employee) => isActiveEmployee(employee) && employee.state?.activity !== 'off_shift'),
    [employees],
  );
  // A boardroom only holds the meeting's attendees, in the order they were invited.
  const present = useMemo(() => {
    if (room !== 'boardroom') return active;
    const byId = new Map(active.map((employee) => [employee.id, employee]));
    return (meeting?.attendeeIds ?? []).flatMap((id) => byId.get(id) ?? []);
  }, [room, active, meeting]);
  const desks = useMemo(() => deskGrid(present.length), [present.length]);
  const people: Placed[] = useMemo(() => {
    const states = present.map((employee) => employee.state ?? IDLE);
    if (!onFloor) {
      const stations =
        room === 'boardroom' ? boardroomSeats(present.length) : recordsStations(present.length);
      return present.slice(0, stations.length).map((employee, index) => {
        const seat = stations[index];
        // The figure with the floor rises a little out of their chair.
        const station =
          employee.id === meeting?.speakingId
            ? { ...seat, at: [seat.at[0], seat.at[1] + 0.09, seat.at[2]] as Point }
            : seat;
        return { employee, index, state: states[index], station, home: -1 };
      });
    }
    const stations = layoutStations({
      people: present.map((employee, index) => ({ id: employee.id, state: states[index] })),
      providers,
      seats,
    });
    return present.map((employee, index) => ({
      employee,
      index,
      state: states[index],
      station: stations[index].station,
      home: stations[index].home,
      ...(stations[index].accent ? { accent: stations[index].accent } : {}),
    }));
  }, [present, providers, room, onFloor, meeting, seats]);
  // After hours the floor is dark but for the desks somebody is still sitting and
  // working at: an auditor walking the floor does not light the desk they left.
  const lamps = useMemo(() => {
    if (!schedule || schedule.working) return undefined;
    return people
      .filter(
        (person) =>
          person.home < desks.length &&
          isWorking(person.state.activity) &&
          isSeated(person.state.activity),
      )
      .map((person) => person.home);
  }, [schedule, people, desks.length]);
  const shelves = useMemo(
    () =>
      dressing.records?.shelves ?? (dressing.memory ? defaultShelves(dressing.memory) : ([] as ShelfSpec[])),
    [dressing.records, dressing.memory],
  );

  // The desks are where a floor's work happens, so a phone opens on them.
  const cluster = useMemo((): Point => {
    const middle = desks.reduce((total, desk) => total + desk[2], 0) / Math.max(1, desks.length);
    return [-4.7, 0.6, middle + 0.5];
  }, [desks]);

  const waiting = people.filter((person) => person.state.attention);
  const stuck = waiting.some((person) => person.state.attention === 'stuck');
  const degraded = providers.some((provider) => provider.degraded);
  const speaking = useSpeaking(people, size.width);
  const contested = dressing.memory?.contested ?? 0;
  // Whoever has the floor in a meeting sits a little higher and keeps their name.
  const speakingInMeeting = room === 'boardroom' ? meeting?.speakingId : undefined;
  const speakingSeat = people.findIndex((person) => person.employee.id === speakingInMeeting);

  return (
    <>
      <color attach="background" args={[light.background]} />
      <Framing zoom={zoom} angle={angle} resetKey={resetKey} source={eventSource} cluster={cluster} />
      <SurfaceContext.Provider value={surfaces}>
        <Lighting light={light} budget={lightBudget} sky={room !== 'records'} />
        {room === 'records' && (
          <Static revision={`records ${light.interior.toFixed(2)}`}>
            <RecordsRoom shelves={shelves} interior={light.interior} onSelectProp={onSelectProp} />
          </Static>
        )}
        {room === 'boardroom' && (
          <>
            <Static revision={`boardroom ${light.interior.toFixed(2)}`}>
              <Boardroom interior={light.interior} onSelectProp={onSelectProp} />
            </Static>
            {meeting?.live && (
              <MeetingMurmur
                seats={people.map((person) => person.station.at)}
                {...(speakingSeat >= 0 ? { speakingIndex: speakingSeat } : {})}
                motion={motion}
              />
            )}
          </>
        )}
        {onFloor && (
          <>
            <Static revision={`${desks.length} ${lamps?.join(' ') ?? 'all'}`}>
              <Architecture desks={desks} interior={light.interior} lamps={lamps} />
              <FileCabinet />
              <OfficeSpeakers />
            </Static>
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
              {contested > 0 && (
                // The folder lies on the lectern's sloped reading surface, in front of the tray.
                <group position={[0, 1.02, 0.01]} rotation={[0.5, 0, 0]}>
                  <ContestedFolder
                    position={[0, 0.045, 0.07]}
                    count={contested}
                    onSelectProp={onSelectProp}
                  />
                </group>
              )}
            </group>
            {providers.slice(0, CONSOLE_Z.length).map((provider, index) => (
              // The console stands against the window wall with its screen facing the room.
              <group
                key={provider.id}
                position={[CONSOLE_X, 0, CONSOLE_Z[index]]}
                rotation={[0, Math.PI / 2, 0]}
              >
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
            <FloorDressing
              room={room}
              dressing={dressing}
              desks={desks}
              people={people}
              onSelectProp={onSelectProp}
            />
          </>
        )}
        <OfficeOverlay>
          {cardsFit && onFloor && <BoardNote position={BOARD_NOTE} note={note} />}
          {cardsFit && onFloor && dressing.board && (
            <TaskCards position={TASK_CARDS} cards={dressing.board.cards} onSelectProp={onSelectProp} />
          )}
          {cardsFit && room === 'lobby' && dressing.calendar && (
            <CalendarCard position={CALENDAR_CARD} entries={dressing.calendar} onSelectProp={onSelectProp} />
          )}
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
              pinned={person.employee.id === speakingInMeeting}
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

/**
 * The paper and the lamps a floor is carrying today. Everything here is optional:
 * a floor with nothing to say renders none of it.
 */
function FloorDressing({
  room,
  dressing,
  desks,
  people,
  onSelectProp,
}: {
  room: OfficeRoom;
  dressing: OfficeDressing;
  desks: Point[];
  people: Placed[];
  onSelectProp?: SelectProp;
}) {
  const {
    memory,
    board,
    findings,
    incident,
    incidentCount = 0,
    calendar = [],
    emergency,
  } = dressing;
  return (
    <group>
      {memory && <MemoryBinder position={BINDER} fill={memory.floorFill} onSelectProp={onSelectProp} />}
      {people.map((person) => {
        const desk = person.home >= 0 && person.home < desks.length ? desks[person.home] : undefined;
        if (!desk) return null;
        const fill = memory?.agentFills.get(person.employee.id);
        const open = findings?.get(person.employee.id) ?? 0;
        if (fill === undefined && open <= 0) return null;
        return (
          <group key={person.employee.id} position={desk}>
            {fill !== undefined && (
              <DeskNotebook
                position={NOTEBOOK}
                fill={fill}
                color={person.employee.color ?? C.sage}
                employeeId={person.employee.id}
                onSelectProp={onSelectProp}
              />
            )}
            {open > 0 && (
              <FindingsFolder
                position={FINDINGS}
                count={open}
                employeeId={person.employee.id}
                onSelectProp={onSelectProp}
              />
            )}
          </group>
        );
      })}
      {board && <TaskBoard position={TASK_BOARD} cards={board.cards} onSelectProp={onSelectProp} />}
      {/* A task that cannot start yet is on a string to whatever it is waiting
          for: the desk of whoever owes it, or the card on the board when that
          person is not on this floor. Board card ids are task ids, which is what
          makes the second pair of ends meet. */}
      {people.flatMap((person) => {
        const { waitingOn, waitingOnId, activity } = person.state;
        const owner = waitingOnId ? people.find((other) => other.employee.id === waitingOnId) : undefined;
        const pin = waitingOn && board ? cardPin(board.cards, waitingOn) : undefined;
        const to: Point | undefined = owner
          ? [owner.station.at[0], STRING_HEIGHT, owner.station.at[2]]
          : pin
            ? [TASK_BOARD[0] + pin[0], pin[1], TASK_BOARD[2] + pin[2]]
            : undefined;
        if (!to) return [];
        const stand = person.station.at;
        return [
          <WaitingString
            key={person.employee.id}
            from={[stand[0], STRING_HEIGHT, stand[2]]}
            to={to}
            blocked={activity === 'blocked'}
          />,
        ];
      })}
      {emergency && <EmergencyNotice position={NOTICE} onSelectProp={onSelectProp} />}
      {incident && <IncidentLamp position={INCIDENT_LAMP} onSelectProp={onSelectProp} />}
      {room === 'lobby' && (
        <>
          <CalendarWall position={CALENDAR_WALL} entries={calendar} onSelectProp={onSelectProp} />
          <LiftDoor position={DOORWAY} onSelectProp={onSelectProp} />
        </>
      )}
      {room === 'triage' && (
        <>
          <AlertBoard position={ALERT_BOARD} count={incidentCount} onSelectProp={onSelectProp} />
          <StatusLamp
            position={STATUS_LAMP}
            rotation={[0, Math.PI / 2, 0]}
            alert={incidentCount > 0}
            onSelectProp={onSelectProp}
          />
        </>
      )}
    </group>
  );
}
