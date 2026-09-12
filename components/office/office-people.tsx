'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { Box, C, Cylinder, Round, type Point } from './office-primitives';
import type { OfficeEmployee } from './office-scene';

/** Where a person is in the room; drives the pose and the anchor furniture. */
export type Activity = 'research' | 'discussion' | 'lounge';

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

function Figure({
  color,
  index,
  seated,
  pose,
  phase,
  appearance,
}: {
  appearance: Appearance;
  color: string;
  index: number;
  seated: boolean;
  pose: Activity;
  phase: number;
}) {
  const headY = seated ? 1.31 : 1.62;
  const shoulderY = seated ? 1.01 : 1.29;
  return (
    <group>
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
      {appearance.hat !== 'none' && (
        <group>
          <Round p={[0, headY + 0.21, 0]} s={[0.4, 0.19, 0.37]} color={color} radius={0.08} />
          {appearance.hat === 'cap' && (
            <Round p={[0, headY + 0.15, 0.2]} s={[0.39, 0.04, 0.3]} color={color} radius={0.03} />
          )}
        </group>
      )}
      <Cylinder p={[0, headY - 0.23, 0]} radius={0.075} height={0.15} color={appearance.skin} />
      <Round p={[0, headY, 0]} s={[0.35, 0.4, 0.33]} color={appearance.skin} radius={0.11} />
      {appearance.hairstyle !== 'bald' && (
        <Round
          p={[0, headY + 0.135, -0.025]}
          s={[0.368, 0.175, 0.352]}
          color={appearance.hair}
          radius={0.07}
        />
      )}
      {appearance.hairstyle !== 'bald' && (
        <Box p={[0, headY + 0.055, -0.156]} s={[0.35, 0.2, 0.045]} color={appearance.hair} />
      )}
      {appearance.hairstyle === 'long' && (
        <Round p={[0.155, headY - 0.1, -0.1]} s={[0.09, 0.32, 0.16]} color={appearance.hair} radius={0.04} />
      )}
      <Round p={[0, headY - 0.035, 0.179]} s={[0.071, 0.09, 0.058]} color={appearance.skin} radius={0.024} />
      {[-1, 1].map((side) => (
        <group key={side}>
          <mesh position={[side * 0.087, headY + 0.005, 0.167]}>
            <sphereGeometry args={[0.016, 6, 6]} />
            <meshStandardMaterial color="#32392e" />
          </mesh>
          {appearance.glasses && (
            <Box p={[side * 0.087, headY + 0.012, 0.175]} s={[0.13, 0.075, 0.018]} color="#454d46" />
          )}
          <group
            position={[side * 0.14, seated ? 0.56 : 0.85, 0]}
            rotation={[seated ? -Math.PI / 2 : 0, 0, 0]}
          >
            <Round
              p={[0, -0.22, 0]}
              s={[0.175, 0.47, 0.195]}
              color={index % 2 ? '#5e6259' : '#3d4b51'}
              radius={0.035}
            />
            <group position={[0, -0.43, 0]} rotation={[seated ? Math.PI / 2 : 0, 0, 0]}>
              <Round
                p={[0, -0.18, 0]}
                s={[0.16, 0.37, 0.17]}
                color={index % 2 ? '#5e6259' : '#3d4b51'}
                radius={0.03}
              />
              <Round p={[0, -0.35, 0.06]} s={[0.19, 0.12, 0.31]} color="#e0ddce" radius={0.035} />
            </group>
          </group>
          <group
            position={[side * 0.27, shoulderY, 0]}
            rotation={[
              seated
                ? -0.77 + Math.sin(phase + side) * 0.035
                : pose === 'discussion' && side > 0
                  ? -0.95 + Math.sin(phase * 0.4) * 0.18
                  : -0.1,
              0,
              side * (pose === 'discussion' ? 0.2 : 0.07),
            ]}
          >
            <Round p={[0, -0.15, 0]} s={[0.16, 0.31, 0.18]} color={color} radius={0.045} />
            <group
              position={[0, -0.29, 0]}
              rotation={[seated ? -0.85 : pose === 'discussion' ? -0.7 : -0.15, 0, 0]}
            >
              <Round p={[0, -0.11, 0]} s={[0.13, 0.25, 0.14]} color={appearance.skin} radius={0.04} />
              <Round p={[0, -0.245, 0.02]} s={[0.13, 0.12, 0.135]} color={appearance.skin} radius={0.04} />
            </group>
          </group>
        </group>
      ))}
    </group>
  );
}

export function EmployeeAvatar({
  employee,
  index,
  activity,
  home,
  motion,
  onSelect,
}: {
  employee: OfficeEmployee;
  index: number;
  activity: Activity;
  home: Point;
  motion: boolean;
  onSelect?: (id: string) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const figure = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  const [phase, setPhase] = useState(0);
  const elapsed = useRef(index * 7.3 + 7);
  const lastPoseUpdate = useRef(0);
  const color = employee.color || C.sage;
  const appearance = useMemo(() => appearanceFor(employee.id), [employee.id]);
  const isSeated = activity === 'research' || activity === 'lounge';
  useEffect(() => {
    if (group.current) {
      group.current.position.set(...home);
      group.current.rotation.y = Math.PI;
    }
  }, [home[0], home[2]]);
  useEffect(() => {
    if (!hovered) return;
    const old = document.body.style.cursor;
    document.body.style.cursor = 'pointer';
    return () => {
      document.body.style.cursor = old;
    };
  }, [hovered]);
  useFrame((_, delta) => {
    if (!motion) return;
    elapsed.current += Math.min(delta, 0.05);
    // People hold their station; only the room's life (a sway, a breath) moves.
    if (group.current)
      group.current.rotation.y =
        Math.PI + (activity === 'discussion' ? Math.sin(elapsed.current * 0.8) * 0.18 : 0);
    if (figure.current)
      figure.current.rotation.z =
        !isSeated && activity === 'discussion' ? Math.sin(elapsed.current * 1.8) * 0.026 : 0;
    // Articulated limbs update at 20fps.
    if (Math.abs(elapsed.current - lastPoseUpdate.current) > 0.05) {
      lastPoseUpdate.current = elapsed.current;
      setPhase(elapsed.current * 8);
    }
  });
  return (
    <group ref={group} position={home} rotation={[0, Math.PI, 0]}>
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
        <group ref={figure}>
          <Figure
            color={color}
            appearance={appearance}
            index={index}
            seated={isSeated}
            pose={activity}
            phase={phase}
          />
        </group>
        {hovered && (
          <mesh position={[0, 0.052, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.43, 0.48, 48]} />
            <meshBasicMaterial color={color} transparent opacity={0.85} depthWrite={false} />
          </mesh>
        )}
      </group>
      <Html center position={[0, isSeated ? 1.89 : 2.18, 0]} zIndexRange={[20, 10]}>
        <button
          type="button"
          className="office-view-label"
          onClick={(event) => {
            event.stopPropagation();
            onSelect?.(employee.id);
          }}
          aria-label={`${employee.name}, ${employee.role}`}
          title={`${employee.name} · ${employee.role}`}
          style={
            {
              '--person-color': color,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 9px',
              borderRadius: 7,
              border: '1px solid #ffffff30',
              background: '#19342fe8',
              color: '#f0f1df',
              fontSize: 11,
              fontWeight: 650,
              lineHeight: 1,
              whiteSpace: 'nowrap',
              boxShadow: '0 3px 12px #07161245',
              cursor: 'pointer',
            } as CSSProperties
          }
        >
          <span
            className="office-view-label-dot"
            style={{
              background: color,
              width: 6,
              height: 6,
              borderRadius: '50%',
              display: 'inline-block',
              boxShadow: `0 0 8px ${color}60`,
            }}
          />
          <span>{employee.name.split(' ')[0]}</span>
          {employee.status.trim().toLowerCase() === 'working' && (
            <span className="office-view-work-dot" title="Working" aria-label="Working">
              <span />
            </span>
          )}
        </button>
      </Html>
    </group>
  );
}
