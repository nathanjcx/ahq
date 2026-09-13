'use client';

import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, JSX } from 'react';
import * as THREE from 'three';
import {
  boardLayout,
  CALENDAR_ENTRIES,
  TABLE,
  type BoardCard,
  type CalendarEntry,
} from './office-layout';
import { useOverlayLabel, useOverlayRelayout } from './office-overlay';
import { Box, C, Round, type Point } from './office-primitives';
import { STATUS_COLOR, type SelectProp } from './office-props';

const AMBER = '#e8a54f';
const DEGRADED = '#c2643f';
const CONSOLE_BARS: [number, number][] = [
  [-0.18, 0.2],
  [0, 0.11],
  [0.17, 0.26],
];

/**
 * A walnut lectern whose inbox tray warms, and carries a small count, when work
 * is waiting on a person. The count lives on the prop rather than over the
 * figures, so the middle of the room stays readable.
 */
export function ReviewLectern({
  position,
  waiting,
  stuck,
  motion,
  onSelect,
}: {
  position: Point;
  /** How many people on this floor are waiting on a decision. */
  waiting: number;
  /** Whether any of it has been waiting too long. */
  stuck: boolean;
  motion: boolean;
  onSelect?: () => void;
}): JSX.Element {
  const glowing = waiting > 0;
  const trayMaterial = useRef<THREE.MeshStandardMaterial>(null);
  const lamp = useRef<THREE.PointLight>(null);
  const [hovered, setHovered] = useState(false);
  useEffect(() => {
    if (!hovered) return;
    const old = document.body.style.cursor;
    document.body.style.cursor = 'pointer';
    return () => {
      document.body.style.cursor = old;
    };
  }, [hovered]);
  // The tray pulses at ~0.6 Hz between its quiet and bright bounds.
  useFrame((state) => {
    if (!motion || !glowing) return;
    const wave = 0.95 + Math.sin(state.clock.elapsedTime * Math.PI * 1.2) * 0.65;
    if (trayMaterial.current) trayMaterial.current.emissiveIntensity = wave;
    if (lamp.current) lamp.current.intensity = 0.35 + wave * 0.45;
  });
  useEffect(() => {
    if (motion && glowing) return; // the frame loop owns the material while pulsing
    if (trayMaterial.current) trayMaterial.current.emissiveIntensity = glowing ? 1.35 : 0;
    if (lamp.current) lamp.current.intensity = glowing ? 0.9 : 0;
  }, [glowing, motion]);
  return (
    <group position={position}>
      <group
        onClick={(event) => {
          event.stopPropagation();
          onSelect?.();
        }}
        onPointerOver={(event) => {
          event.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
      >
        <Box p={[0, 0.035, 0]} s={[0.58, 0.07, 0.44]} color={C.walnut} />
        <Box p={[0, 0.31, 0.012]} s={[0.44, 0.48, 0.32]} color={C.walnut} />
        <Box p={[0, 0.73, 0.026]} s={[0.36, 0.42, 0.26]} color={C.walnut} />
        <Box p={[0, 0.96, 0.03]} s={[0.48, 0.06, 0.3]} color={C.sage} />
        {/* The reading surface slopes down toward a reader standing at +z. */}
        <group position={[0, 1.02, 0.01]} rotation={[0.5, 0, 0]}>
          <Round p={[0, 0, -0.02]} s={[0.58, 0.05, 0.46]} color={C.desk} radius={0.02} />
          <Box p={[0, 0.055, 0.2]} s={[0.58, 0.1, 0.035]} color={C.sage} />
          <group position={[0, 0.04, -0.12]}>
            <mesh>
              <boxGeometry args={[0.4, 0.02, 0.26]} />
              <meshStandardMaterial
                ref={trayMaterial}
                color="#6f8560"
                emissive={AMBER}
                emissiveIntensity={0}
                roughness={0.6}
              />
            </mesh>
            <Box p={[-0.2, 0.035, 0]} s={[0.02, 0.07, 0.26]} color={C.sage} />
            <Box p={[0.2, 0.035, 0]} s={[0.02, 0.07, 0.26]} color={C.sage} />
            <Box p={[0, 0.035, -0.13]} s={[0.42, 0.07, 0.02]} color={C.sage} />
            {[0, 1, 2].map((sheet) => (
              <Box
                key={sheet}
                p={[(sheet - 1) * 0.015, 0.026 + sheet * 0.008, (sheet - 1) * 0.01]}
                s={[0.33, 0.006, 0.23]}
                color={['#f0e9d2', '#e7dfc4', '#eee7d0'][sheet]}
                rotation={[0, 0, (sheet - 1) * 0.05]}
              />
            ))}
          </group>
        </group>
      </group>
      {/* A soft warm lamp hangs over the tray; it is quiet unless glowing. */}
      <pointLight ref={lamp} position={[0, 1.42, 0]} color="#ffc984" intensity={0} distance={2.4} />
      {glowing && (
        <Html center position={[0, 1.36, 0]} zIndexRange={[18, 8]}>
          <button
            type="button"
            className="office-tray-count"
            data-stuck={stuck ? 'true' : undefined}
            title={
              stuck ? `${waiting} waiting too long for a decision` : `${waiting} waiting for your review`
            }
            aria-label={`${waiting} waiting for review`}
            onClick={(event) => {
              event.stopPropagation();
              onSelect?.();
            }}
          >
            {waiting}
          </button>
        </Html>
      )}
    </group>
  );
}

/** A floor console for one provider; its bars breathe, or sputter when degraded. */
export function ProviderConsole({
  position,
  color,
  name,
  degraded,
  motion,
}: {
  position: Point;
  color: string;
  name: string;
  degraded: boolean;
  motion: boolean;
}): JSX.Element {
  // One shared material, so every indicator flickers and breathes together.
  const bars = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false }), []);
  useEffect(() => () => bars.dispose(), [bars]);
  // The frame loop takes the colour over while the office is animating; this is
  // what the bars read on a still frame, and the first colour they ever have.
  useLayoutEffect(() => {
    bars.color.set(degraded ? DEGRADED : color);
  }, [bars, color, degraded]);
  useFrame((state) => {
    if (!motion) return;
    const t = state.clock.elapsedTime;
    if (degraded) {
      // Two incommensurate clocks crossing a high threshold read as sputtering.
      const sputter = Math.sin(t * 9.1) + Math.sin(t * 22.7 + 1.7) + Math.sin(t * 3.3) * 0.5;
      bars.color.set(sputter > 1.15 ? '#e0905c' : '#5a3627');
    } else {
      bars.color.set(color).multiplyScalar(0.72 + Math.sin(t * 1.5) * 0.28);
    }
  });
  return (
    <group position={position} name={name}>
      {[-1, 1].map((side) => (
        <Box key={side} p={[side * 0.24, 0.035, 0.04]} s={[0.1, 0.07, 0.32]} color="#33403a" />
      ))}
      <Round p={[0, 0.33, 0]} s={[0.66, 0.52, 0.44]} color="#47574d" radius={0.05} />
      <Box p={[0, 0.69, -0.05]} s={[0.4, 0.3, 0.24]} color="#3c4b43" />
      {/* The screen leans toward the room, tinted with the provider colour. */}
      <group position={[0, 0.85, 0.02]} rotation={[0.55, 0, 0]}>
        <Round s={[0.56, 0.34, 0.03]} color="#26332d" radius={0.02} />
        <mesh position={[0, 0, 0.018]}>
          <boxGeometry args={[0.5, 0.28, 0.005]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} roughness={0.4} />
        </mesh>
      </group>
      {CONSOLE_BARS.map(([x, width], i) => (
        <mesh key={i} position={[x, 0.36, 0.222]} material={bars}>
          <boxGeometry args={[width, 0.05, 0.012]} />
        </mesh>
      ))}
      <mesh position={[0, 0.22, 0.222]}>
        <boxGeometry args={[0.32, 0.035, 0.01]} />
        <meshStandardMaterial color="#141f1a" emissive={color} emissiveIntensity={0.8} toneMapped={false} />
      </mesh>
    </group>
  );
}

/**
 * The whiteboard's latest note, pinned as a small cream card. It joins the
 * declutter pass as a fixed obstacle: pills and bubbles route around it, and it
 * gives way to a bubble that has nowhere else to go.
 */
export function BoardNote({ position, note }: { position: Point; note?: string }): JSX.Element | null {
  const label = useOverlayLabel('office-note', true);
  const relayout = useOverlayRelayout();
  useLayoutEffect(() => {
    label?.anchor.set(...position);
  }, [label, position]);
  if (!note) return null;
  return (
    <Html position={position} center zIndexRange={[18, 8]}>
      <div
        className="office-note"
        ref={(element) => {
          label?.attach('pill', element);
          relayout();
        }}
      >
        {note}
      </div>
    </Html>
  );
}

/** A little status eye: steady dim green, or an amber stutter when degraded. */
export function StatusDevice({
  position,
  degraded,
  motion,
}: {
  position: Point;
  degraded: boolean;
  motion: boolean;
}): JSX.Element {
  const lens = useRef<THREE.MeshStandardMaterial>(null);
  useFrame((state) => {
    if (!motion || !degraded) return;
    const material = lens.current;
    if (!material) return;
    const t = state.clock.elapsedTime;
    const stutter = Math.sin(t * 6.7) + Math.sin(t * 17.3 + 2.1) + Math.sin(t * 2.3) * 0.6;
    const bright = stutter > 1.05;
    material.color.set(bright ? '#d59a4f' : '#39301f');
    material.emissiveIntensity = bright ? 1.05 : 0.05;
  });
  return (
    <group position={position}>
      <Round s={[0.3, 0.34, 0.11]} color="#31413a" radius={0.045} />
      <Box p={[0, -0.2, 0]} s={[0.12, 0.06, 0.09]} color="#26332d" />
      {/* A recessed ring keeps the lens readable at a distance. */}
      <mesh position={[0, 0, 0.058]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.085, 0.085, 0.024, 20]} />
        <meshStandardMaterial color="#26332d" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0, 0.07]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.062, 0.062, 0.02, 20]} />
        <meshStandardMaterial
          ref={lens}
          color={degraded ? '#d59a4f' : '#8fbb84'}
          emissive={degraded ? '#d59a4f' : '#8fbb84'}
          emissiveIntensity={degraded ? 0.8 : 0.5}
          roughness={0.35}
        />
      </mesh>
    </group>
  );
}

/**
 * What the task board says, in the overlay where the office keeps anything meant
 * to be read. Like the board note it is a fixed card, so pills and bubbles route
 * around it rather than over it.
 */
export function TaskCards({
  position,
  cards,
  onSelectProp,
}: {
  position: Point;
  cards: BoardCard[];
  onSelectProp?: SelectProp;
}): JSX.Element | null {
  const label = useOverlayLabel('office-board', true);
  const relayout = useOverlayRelayout();
  useLayoutEffect(() => {
    label?.anchor.set(...position);
    // The floor's work outranks the other fixed cards: on a small stage the
    // whiteboard's note gives way to the board rather than the other way round.
    label?.rank(1, false);
  }, [label, position]);
  const shown = boardLayout(cards).cards;
  if (!shown.length) return null;
  return (
    <Html position={position} center zIndexRange={[18, 8]}>
      <div
        className="office-board"
        ref={(element) => {
          label?.attach('pill', element);
          relayout();
        }}
      >
        <h3>Board</h3>
        <ol>
          {shown.map((card) => (
            <li key={card.id}>
              <button
                type="button"
                data-status={card.status}
                style={{ '--card-status': STATUS_COLOR[card.status] } as CSSProperties}
                title={`${card.title} · ${card.status}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectProp?.('card', card.id);
                }}
              >
                {card.title}
              </button>
            </li>
          ))}
        </ol>
      </div>
    </Html>
  );
}

/** The week's shifts, meetings and deadlines, on the lobby's calendar wall. */
export function CalendarCard({
  position,
  entries,
  onSelectProp,
}: {
  position: Point;
  entries: CalendarEntry[];
  onSelectProp?: SelectProp;
}): JSX.Element | null {
  const label = useOverlayLabel('office-calendar', true);
  const relayout = useOverlayRelayout();
  useLayoutEffect(() => {
    label?.anchor.set(...position);
  }, [label, position]);
  if (!entries.length) return null;
  const shown = entries.slice(0, CALENDAR_ENTRIES);
  return (
    <Html position={position} center zIndexRange={[18, 8]}>
      <div
        className="office-calendar"
        ref={(element) => {
          label?.attach('pill', element);
          relayout();
        }}
      >
        <h3>This week</h3>
        <ol>
          {shown.map((item) => (
            <li key={`${item.at} ${item.label}`}>
              <span>{item.at}</span>
              <span>{item.label}</span>
            </li>
          ))}
        </ol>
        {entries.length > shown.length && (
          <p>
            <button type="button" onClick={() => onSelectProp?.('calendar')}>
              +{entries.length - shown.length} more
            </button>
          </p>
        )}
      </div>
    </Html>
  );
}

/** How long one speech mark takes to swell and fade, and how far apart the seats start. */
const MURMUR_SECONDS = 2.6;
const MURMUR_STEP = 0.42;
/** Marks open over the table rather than over a head, where the name pill already is. */
const MURMUR_REACH = 0.55;
const MURMUR_HEIGHT = 1.72;

/**
 * A live meeting, seen from across the room: a speech mark over each attendee,
 * swelling and fading round the table so the conversation reads as moving. Who
 * actually holds the floor keeps theirs open.
 */
export function MeetingMurmur({
  seats,
  speakingIndex,
  motion,
}: {
  /** Where the attendees are sitting, in the room's own coordinates. */
  seats: Point[];
  /** The attendee with the floor, if the transcript names one. */
  speakingIndex?: number;
  motion: boolean;
}): JSX.Element {
  const marks = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (!motion || !marks.current) return;
    const t = state.clock.elapsedTime / MURMUR_SECONDS;
    marks.current.children.forEach((mark, index) => {
      const wave = mark.userData.speaking === true ? 1 : murmurWave(t - index * MURMUR_STEP);
      mark.scale.setScalar(0.75 + wave * 0.35);
      mark.visible = wave > 0.05;
    });
  });
  return (
    <group ref={marks}>
      {seats.map((seat, index) => {
        const speaking = index === speakingIndex;
        // Still frames fix the phase by seat, so a baseline always sees the same table.
        const wave = speaking ? 1 : murmurWave(index * MURMUR_STEP * 1.7);
        return (
          <group
            key={`${seat[0]} ${seat[2]}`}
            position={[seat[0] + 0.3, MURMUR_HEIGHT, seat[2] + (TABLE.z - seat[2]) * MURMUR_REACH]}
            scale={0.75 + wave * 0.35}
            visible={wave > 0.05}
            userData={{ speaking }}
          >
            <Round s={[0.66, 0.46, 0.07]} color={speaking ? AMBER : '#f1ead6'} radius={0.09} />
            {/* The tail, pointing down at whoever is speaking. */}
            <Box
              p={[-0.16, -0.26, 0]}
              s={[0.16, 0.2, 0.06]}
              color={speaking ? AMBER : '#f1ead6'}
              rotation={[0, 0, 0.5]}
            />
            {[-0.13, 0.08].map((x) => (
              <group key={x} position={[x, 0.04, 0.04]}>
                <Box s={[0.066, 0.14, 0.012]} color="#3a4a40" />
                <Box p={[-0.02, -0.12, 0]} s={[0.038, 0.11, 0.012]} color="#3a4a40" />
              </group>
            ))}
          </group>
        );
      })}
    </group>
  );
}

/** One swell: up, held, then gone, over `MURMUR_SECONDS`. */
function murmurWave(phase: number): number {
  const cycle = phase - Math.floor(phase);
  return Math.max(0, Math.sin(cycle * Math.PI) ** 1.6 - 0.12);
}
