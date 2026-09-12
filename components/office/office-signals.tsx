'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { useOverlayEntry } from './office-overlay';
import { Box, C, Round, type Point } from './office-primitives';

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
  const bars = useMemo(
    () => new THREE.MeshBasicMaterial({ color: degraded ? DEGRADED : color, toneMapped: false }),
    [],
  );
  useEffect(() => () => bars.dispose(), [bars]);
  useEffect(() => {
    if (motion) return;
    bars.color.set(degraded ? DEGRADED : color);
  }, [bars, color, degraded, motion]);
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
  const entry = useOverlayEntry('office-note');
  useLayoutEffect(() => {
    if (!entry) return;
    entry.pinned = true;
    entry.anchor.set(...position);
  }, [entry, position]);
  if (!note) return null;
  return (
    <Html position={position} center zIndexRange={[18, 8]}>
      <div
        className="office-note"
        ref={(element) => {
          if (entry) entry.pill = element;
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
