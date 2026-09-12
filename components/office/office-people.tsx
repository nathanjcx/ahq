'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { Activity, EmployeeActivity } from './activity';
import { labelPriority, type LabelMode } from './office-labels';
import { useOverlayEntry } from './office-overlay';
import { Box, C, Cylinder, Round } from './office-primitives';
import type { Station } from './office-stations';
import type { OfficeEmployee } from './office-scene';

type Appearance = {
  gender: 'neutral' | 'feminine' | 'masculine';
  skin: string;
  hair: string;
  hairstyle: 'short' | 'long' | 'bald';
  hat: 'none' | 'cap' | 'beanie';
  glasses: boolean;
};

const SKIN_TONES = ['#b98261', '#e2b48e', '#885e48', '#ce9a76', '#bc815e', '#e6bea0'];
const HAIR_COLORS = ['#3d3029', '#76533b', '#272f2b', '#3c3029', '#9c7653', '#3b3431'];

/** Activities that happen in the chair rather than on the person's feet. */
const SEATED: Activity[] = ['idle', 'thinking', 'reading', 'writing', 'failed'];
/** How long the hop-and-arms-up lasts, however long the task stays freshly completed. */
const CELEBRATION_MS = 3_000;
/** Every walk across the floor takes the same time, however far it is. */
const WALK_SECONDS = 1.2;

/** A stable per-person look derived from the id; the office invents nothing per session. */
function appearanceFor(id: string): Appearance {
  let seed = 2166136261;
  for (let i = 0; i < id.length; i++) {
    seed ^= id.charCodeAt(i);
    seed = Math.imul(seed, 16777619);
  }
  const next = (offset: number, modulus: number) =>
    (Math.imul(seed + offset * 2654435761, 40503) >>> 0) % modulus;
  return {
    gender: (['neutral', 'feminine', 'masculine'] as const)[next(1, 3)],
    skin: SKIN_TONES[next(2, SKIN_TONES.length)],
    hair: HAIR_COLORS[next(3, HAIR_COLORS.length)],
    hairstyle: (['short', 'long', 'bald'] as const)[next(4, 3)],
    hat: (['none', 'none', 'none', 'cap', 'beanie'] as const)[next(5, 5)],
    glasses: next(6, 10) < 3,
  };
}

/** Every joint the office animates. Left is index 0, right is index 1. */
type Pose = {
  seated: boolean;
  shoulder: [number, number];
  elbow: [number, number];
  roll: [number, number];
  headPitch: number;
  headYaw: number;
  lean: number;
  hop: number;
  spin: number;
};

const REST: Pose = {
  seated: false,
  shoulder: [-0.1, -0.1],
  elbow: [-0.15, -0.15],
  roll: [-0.07, 0.07],
  headPitch: 0,
  headYaw: 0,
  lean: 0,
  hop: 0,
  spin: 0,
};
const SEATED_REST: Pose = {
  ...REST,
  seated: true,
  shoulder: [-0.77, -0.77],
  elbow: [-0.85, -0.85],
};

/**
 * One pose for one moment.
 *
 * `time` is the scene clock in seconds, `age` is how long this activity has been
 * running in seconds, and `traits` are the employee's persona traits, which only
 * ever tune the idle.
 */
function poseFor(activity: Activity, time: number, age: number, traits: string[]): Pose {
  const seated = SEATED.includes(activity);
  const base = seated ? SEATED_REST : REST;
  switch (activity) {
    case 'thinking':
      return {
        ...base,
        shoulder: [-0.77, -1.42],
        elbow: [-0.85, -1.75],
        roll: [-0.07, 0.34],
        headPitch: 0.13,
        lean: Math.sin(time * 0.6) * 0.05,
      };
    case 'reading': {
      // A page turn every three seconds: a short flick of the right forearm.
      const turn = Math.max(0, Math.sin(time * 2.1) - 0.86) * 4;
      return {
        ...base,
        shoulder: [-0.95, -0.95],
        elbow: [-0.72, -0.72 - turn],
        headPitch: 0.26,
      };
    }
    case 'writing': {
      const tap = Math.sin(time * 9);
      return {
        ...base,
        shoulder: [-1.02, -1.02],
        elbow: [-1.05 + tap * 0.09, -1.05 - tap * 0.09],
        headPitch: 0.19,
        hop: Math.abs(tap) * 0.012,
      };
    }
    case 'calling':
      return {
        ...base,
        shoulder: [-0.18, -0.5],
        elbow: [-0.3, -1.1],
        headPitch: 0.08 + Math.sin(time * 1.4) * 0.04,
      };
    case 'reviewing':
      return {
        ...base,
        shoulder: [-0.92, -0.92],
        elbow: [-0.82, -0.82],
        headPitch: 0.3,
        lean: Math.sin(time * 0.5) * 0.03,
      };
    case 'celebrating': {
      if (age > CELEBRATION_MS / 1000) return { ...base, headPitch: -0.05 };
      const hop = Math.abs(Math.sin(age * 6.2));
      return { ...base, shoulder: [-2.55, -2.55], elbow: [-0.25, -0.25], headPitch: -0.22, hop: hop * 0.24 };
    }
    case 'failed':
      return { ...base, shoulder: [-0.55, -0.55], elbow: [-0.5, -0.5], headPitch: 0.55, lean: 0.04 };
    case 'talking':
      return {
        ...base,
        shoulder: [-0.12, -0.62 + Math.sin(time * 2.4) * 0.18],
        elbow: [-0.2, -1.15],
        headPitch: Math.sin(time * 2) * 0.12,
      };
    default: {
      // Idle, tuned by persona: fast fidgets sooner, cautious looks around,
      // playful turns all the way round now and then.
      const cadence = traits.includes('fast') ? 2.1 : traits.includes('methodical') ? 0.7 : 1.1;
      const fidget = Math.sin(time * cadence) * 0.05;
      const looking = traits.includes('cautious') ? Math.sin(time * 0.38) * 0.55 : 0;
      const turn = traits.includes('playful') ? Math.max(0, Math.sin(time * 0.13) - 0.985) * 420 : 0;
      return {
        ...base,
        shoulder: [base.shoulder[0] + fidget, base.shoulder[1] - fidget],
        headYaw: looking,
        lean: fidget * 0.4,
        spin: Math.min(turn, Math.PI * 2),
      };
    }
  }
}

function Figure({
  color,
  index,
  pose,
  appearance,
}: {
  appearance: Appearance;
  color: string;
  index: number;
  pose: Pose;
}) {
  const { seated } = pose;
  const headY = seated ? 1.31 : 1.62;
  const shoulderY = seated ? 1.01 : 1.29;
  const trouser = index % 2 ? '#5e6259' : '#3d4b51';
  return (
    <group position={[0, pose.hop, 0]} rotation={[0, pose.spin, pose.lean]}>
      <Round
        p={[0, seated ? 0.91 : 1.12, 0]}
        s={[
          appearance.gender === 'masculine' ? 0.51 : appearance.gender === 'feminine' ? 0.43 : 0.47,
          0.57,
          0.29,
        ]}
        color={color}
        radius={0.105}
      />
      <Cylinder p={[0, headY - 0.23, 0]} radius={0.075} height={0.15} color={appearance.skin} />
      <group position={[0, headY, 0]} rotation={[pose.headPitch, pose.headYaw, 0]}>
        {appearance.hat !== 'none' && (
          <group>
            <Round p={[0, 0.21, 0]} s={[0.4, 0.19, 0.37]} color={color} radius={0.08} />
            {appearance.hat === 'cap' && (
              <Round p={[0, 0.15, 0.2]} s={[0.39, 0.04, 0.3]} color={color} radius={0.03} />
            )}
          </group>
        )}
        <Round p={[0, 0, 0]} s={[0.35, 0.4, 0.33]} color={appearance.skin} radius={0.11} />
        {appearance.hairstyle !== 'bald' && (
          <Round p={[0, 0.135, -0.025]} s={[0.368, 0.175, 0.352]} color={appearance.hair} radius={0.07} />
        )}
        {appearance.hairstyle !== 'bald' && (
          <Box p={[0, 0.055, -0.156]} s={[0.35, 0.2, 0.045]} color={appearance.hair} />
        )}
        {appearance.hairstyle === 'long' && (
          <Round p={[0.155, -0.1, -0.1]} s={[0.09, 0.32, 0.16]} color={appearance.hair} radius={0.04} />
        )}
        <Round p={[0, -0.035, 0.179]} s={[0.071, 0.09, 0.058]} color={appearance.skin} radius={0.024} />
        {[-1, 1].map((side) => (
          <group key={side}>
            <mesh position={[side * 0.087, 0.005, 0.167]}>
              <sphereGeometry args={[0.016, 6, 6]} />
              <meshStandardMaterial color="#32392e" />
            </mesh>
            {appearance.glasses && (
              <Box p={[side * 0.087, 0.012, 0.175]} s={[0.13, 0.075, 0.018]} color="#454d46" />
            )}
          </group>
        ))}
      </group>
      {[-1, 1].map((side, i) => (
        <group key={side}>
          <group
            position={[side * 0.14, seated ? 0.56 : 0.85, 0]}
            rotation={[seated ? -Math.PI / 2 : 0, 0, 0]}
          >
            <Round p={[0, -0.22, 0]} s={[0.175, 0.47, 0.195]} color={trouser} radius={0.035} />
            <group position={[0, -0.43, 0]} rotation={[seated ? Math.PI / 2 : 0, 0, 0]}>
              <Round p={[0, -0.18, 0]} s={[0.16, 0.37, 0.17]} color={trouser} radius={0.03} />
              <Round p={[0, -0.35, 0.06]} s={[0.19, 0.12, 0.31]} color="#e0ddce" radius={0.035} />
            </group>
          </group>
          <group position={[side * 0.27, shoulderY, 0]} rotation={[pose.shoulder[i], 0, pose.roll[i]]}>
            <Round p={[0, -0.15, 0]} s={[0.16, 0.31, 0.18]} color={color} radius={0.045} />
            <group position={[0, -0.29, 0]} rotation={[pose.elbow[i], 0, 0]}>
              <Round p={[0, -0.11, 0]} s={[0.13, 0.25, 0.14]} color={appearance.skin} radius={0.04} />
              <Round p={[0, -0.245, 0.02]} s={[0.13, 0.12, 0.135]} color={appearance.skin} radius={0.04} />
            </group>
          </group>
        </group>
      ))}
    </group>
  );
}

const scratch = new THREE.Vector3();
const heading = new THREE.Vector3();

/** The status a pill's dot and a figure's floor disc report. */
function statusOf(state: EmployeeActivity): 'attention' | 'working' | 'idle' {
  if (state.attention) return 'attention';
  return state.activity === 'idle' ? 'idle' : 'working';
}

const STATUS_COLOR = { attention: '#e0b262', working: '#7fb069', idle: '#9fae9b' };

export function EmployeeAvatar({
  employee,
  index,
  state,
  station,
  accent,
  motion,
  mode,
  selected,
  speaking,
  onSelect,
}: {
  employee: OfficeEmployee;
  index: number;
  state: EmployeeActivity;
  station: Station;
  /** Bubble rule colour: the provider being called, when there is one. */
  accent?: string;
  motion: boolean;
  /** What the legend's Labels control is set to. */
  mode: LabelMode;
  selected?: boolean;
  /** Whether this figure holds one of the floor's bubbles right now. */
  speaking?: boolean;
  onSelect?: (id: string) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const walk = useRef({ from: new THREE.Vector3(), to: new THREE.Vector3(), t: 1 });
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pose, setPose] = useState<Pose>(() => poseFor(state.activity, 0, 0, employee.traits ?? []));
  const elapsed = useRef(index * 7.3 + 7);
  const lastPoseUpdate = useRef(-1);
  const placed = useRef(false);
  const color = employee.color || C.sage;
  const traits = employee.traits ?? [];
  const appearance = useMemo(() => appearanceFor(employee.id), [employee.id]);
  const activity = state.activity;
  const seated = SEATED.includes(activity);
  const status = statusOf(state);
  const entry = useOverlayEntry(employee.id);
  const headroom = seated ? 1.95 : 2.24;

  // The office's own declutter pass needs to know who matters most.
  useLayoutEffect(() => {
    if (!entry) return;
    entry.priority = labelPriority({
      activity,
      ...(selected ? { selected } : {}),
      ...(state.attention ? { attention: state.attention } : {}),
    });
    entry.forced = Boolean(hovered || focused || selected);
  });

  // A new station starts a walk. Reduced motion, and the first placement, snap.
  useEffect(() => {
    if (!group.current) return;
    const target = scratch.set(...station.at);
    if (!motion || !placed.current) {
      placed.current = true;
      group.current.position.copy(target);
      group.current.rotation.y = station.facing;
      walk.current.t = 1;
      return;
    }
    if (group.current.position.distanceTo(target) < 0.02) return;
    walk.current.from.copy(group.current.position);
    walk.current.to.copy(target);
    walk.current.t = 0;
  }, [motion, station.at[0], station.at[1], station.at[2], station.facing]);

  // Reduced motion still changes pose, it just never tweens between them.
  useEffect(() => {
    if (!motion) setPose(poseFor(activity, 0, 0, traits));
  }, [motion, activity, employee.id]);

  useEffect(() => {
    if (!hovered) return;
    const old = document.body.style.cursor;
    document.body.style.cursor = 'pointer';
    return () => {
      document.body.style.cursor = old;
    };
  }, [hovered]);

  useFrame((_, delta) => {
    const figure = group.current;
    if (!figure) return;
    if (motion) {
      const step = Math.min(delta, 0.05);
      elapsed.current += step;
      const journey = walk.current;
      if (journey.t < 1) {
        journey.t = Math.min(1, journey.t + step / WALK_SECONDS);
        // Ease in and out, so a walk starts and finishes on the figure's feet.
        const eased = journey.t * journey.t * (3 - 2 * journey.t);
        figure.position.lerpVectors(journey.from, journey.to, eased);
        heading.copy(journey.to).sub(journey.from);
        const walking = journey.t < 0.82 && heading.lengthSq() > 0.09;
        figure.rotation.y = turnToward(
          figure.rotation.y,
          walking ? Math.atan2(heading.x, heading.z) : station.facing,
          step * 4.5,
        );
      } else {
        figure.rotation.y = turnToward(figure.rotation.y, station.facing, step * 4.5);
      }
      // Articulated limbs update at 20fps.
      if (elapsed.current - lastPoseUpdate.current > 0.05) {
        lastPoseUpdate.current = elapsed.current;
        setPose(poseFor(activity, elapsed.current, (Date.now() - state.since) / 1000, traits));
      }
    }
    if (entry) entry.anchor.set(figure.position.x, headroom, figure.position.z);
  });

  const walking = walk.current.t < 1;
  const bubble = state.bubble;
  return (
    <group ref={group} position={station.at} rotation={[0, station.facing, 0]}>
      <group
        onClick={(event) => {
          event.stopPropagation();
          onSelect?.(employee.id);
        }}
        onPointerOver={(event) => {
          event.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
      >
        <Figure color={color} appearance={appearance} index={index} pose={walking ? REST : pose} />
        {(hovered || selected) && (
          <mesh position={[0, 0.052, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.43, 0.48, 48]} />
            <meshBasicMaterial color={color} transparent opacity={0.85} depthWrite={false} />
          </mesh>
        )}
        {/* A figure the floor is waiting on gets a ring, not another chip in the pile. */}
        {state.attention && <AttentionRing stuck={state.attention === 'stuck'} motion={motion} />}
        {mode === 'dots' && (
          <mesh position={[0, 0.045, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.2, 24]} />
            <meshBasicMaterial color={STATUS_COLOR[status]} toneMapped={false} />
          </mesh>
        )}
      </group>
      <Html center className="office-anchor" position={[0, headroom, 0]} zIndexRange={[30, 10]}>
        {mode === 'names' && (
          <button
            ref={(element) => {
              if (entry) entry.pill = element;
            }}
            type="button"
            className="office-pill"
            data-status={status}
            style={{ '--person-color': color } as CSSProperties}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
            onClick={(event) => {
              event.stopPropagation();
              onSelect?.(employee.id);
            }}
            aria-label={`${employee.name}, ${employee.role}. ${activityLabel(activity)}`}
            title={`${employee.name} · ${employee.role} · ${activityLabel(activity)}`}
          >
            <span className="office-pill-dot" />
            <span>{employee.name.split(' ')[0]}</span>
          </button>
        )}
        {bubble && (
          <div
            ref={(element) => {
              if (entry) entry.bubble = element;
            }}
            className="office-bubble"
            data-visible={speaking ? 'true' : undefined}
            style={{ '--bubble-color': accent || color } as CSSProperties}
          >
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onSelect?.(employee.id);
              }}
            >
              <strong>{employee.name.split(' ')[0]}</strong>
              <span>{bubble}</span>
            </button>
          </div>
        )}
      </Html>
    </group>
  );
}

/** The floor is waiting on this person: a ring that breathes under their feet. */
function AttentionRing({ stuck, motion }: { stuck: boolean; motion: boolean }) {
  const ring = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (!motion || !ring.current) return;
    const wave = 1 + Math.sin(state.clock.elapsedTime * (stuck ? 3.4 : 2.1)) * 0.12;
    ring.current.scale.set(wave, wave, 1);
  });
  return (
    <mesh ref={ring} position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.44, 0.62, 48]} />
      <meshBasicMaterial
        color={stuck ? '#d2764c' : '#e0b262'}
        transparent
        opacity={0.8}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

/** Shortest-way turn, so nobody spins the long way round to face a neighbour. */
function turnToward(current: number, target: number, step: number): number {
  const difference = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return Math.abs(difference) <= step ? target : current + Math.sign(difference) * step;
}

function activityLabel(activity: Activity): string {
  switch (activity) {
    case 'thinking':
      return 'Thinking';
    case 'reading':
      return 'Reading a result';
    case 'calling':
      return 'Using a tool';
    case 'writing':
      return 'Writing';
    case 'reviewing':
      return 'Waiting for review';
    case 'celebrating':
      return 'Just finished';
    case 'failed':
      return 'Stopped on an error';
    case 'talking':
      return 'Handing work over';
    default:
      return 'Available';
  }
}
