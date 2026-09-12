'use client';

import { useContext, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { ArchitecturalDetails, OperationsDisplay } from './office-details';
import { Bookshelf, Chair, Desk, Laptop, Plant, Whiteboard } from './office-furniture';
import { Box, C, Cylinder, Halo, Round, SurfaceContext, type Point } from './office-primitives';

function Parquet() {
  const surfaces = useContext(SurfaceContext);
  const ref = useRef<THREE.InstancedMesh>(null);
  const planks = useMemo(() => {
    const result: { p: Point; color: string; width: number }[] = [];
    const shades = ['#b58e5e', '#a77e50', '#bd9766', '#b18a59', '#b69263', '#ac8355'];
    for (let row = 0; row < 24; row++) {
      let edge = -9;
      const count = row % 2 ? 7 : 6;
      for (let col = 0; col < count; col++) {
        const width = row % 2 && (col === 0 || col === count - 1) ? 1.5 : 3;
        result.push({
          p: [edge + width / 2, -0.016, -5.75 + row * 0.5],
          color: shades[(row * 7 + col * 5) % shades.length],
          width,
        });
        edge += width;
      }
    }
    return result;
  }, []);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    planks.forEach((plank, i) => {
      matrix.makeScale((plank.width - 0.015) / 2.985, 1, 1);
      matrix.setPosition(...plank.p);
      ref.current!.setMatrixAt(i, matrix);
      ref.current!.setColorAt(i, color.set(plank.color));
    });
    ref.current.instanceMatrix.needsUpdate = true;
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
  }, [planks]);
  return (
    <group>
      <Round p={[0, -0.21, 0]} s={[18.1, 0.4, 12.1]} color="#283930" radius={0.08} />
      <instancedMesh ref={ref} args={[undefined, undefined, planks.length]} receiveShadow>
        <boxGeometry args={[2.985, 0.075, 0.482]} />
        <meshStandardMaterial roughness={0.57} map={surfaces?.wood} />
      </instancedMesh>
      <Box p={[0, -0.05, 6.015]} s={[18.1, 0.1, 0.045]} color="#bf965c" />
    </group>
  );
}

/**
 * The room itself. `desks` is the grid the floor's headcount produced, so the
 * furniture and the people always agree about where a workstation is.
 */
export function Architecture({ desks, interior }: { desks: Point[]; interior: number }) {
  return (
    <group>
      <Parquet />
      {/* Only the two far walls remain, so every workspace is visible. */}
      <Box p={[0, 1.55, -6]} s={[18.1, 3.1, 0.17]} color={C.wall} />
      {/* Window openings are cut out, so sunlight falls through real mullions. */}
      <Box p={[-9, 0.49, 0]} s={[0.17, 0.98, 12.1]} color={C.wall} />
      <Box p={[-9, 3, 0]} s={[0.17, 0.2, 12.1]} color={C.wall} />
      {(
        [
          [-5.69, 0.62],
          [-0.8, 1.24],
          [4.89, 2.22],
        ] as const
      ).map(([z, width]) => (
        <Box key={z} p={[-9, 1.95, z]} s={[0.17, 1.94, width]} color={C.wall} />
      ))}
      <ArchitecturalDetails desks={desks} interior={interior} />
      <Box p={[0, 0.15, -5.88]} s={[17.9, 0.25, 0.055]} color={C.trim} />
      <Box p={[-8.89, 0.15, 0]} s={[0.055, 0.25, 11.9]} color={C.trim} />
      <Box p={[0, 3.1, -6]} s={[18.2, 0.09, 0.24]} color={C.trim} />
      <Box p={[-9, 3.1, 0]} s={[0.24, 0.09, 12.1]} color={C.trim} />
      {/* Deep window reveals, divided panes, and warm sunlit glazing. */}
      {[-3.4, 1.8].map((z) => (
        <group key={z} position={[-8.88, 1.92, z]}>
          <mesh position={[0, 0, 0]}>
            <boxGeometry args={[0.025, 1.82, 3.88]} />
            <meshPhysicalMaterial
              color="#7aa49b"
              transparent
              opacity={0.29}
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
          {/* Outside is darker than the room, so the glazing glows after dusk. */}
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
      <Bookshelf p={[-1.7, 0, -5.47]} />
      <Whiteboard />
      {/* Meeting room perimeter: thin charcoal mullions and genuinely clear glass. */}
      {[1.45, 8.58].map((x) => (
        <Box key={x} p={[x, 1.45, -0.65]} s={[0.055, 2.9, 0.055]} color="#273b37" />
      ))}
      <Box p={[5.02, 2.91, -0.65]} s={[7.18, 0.065, 0.07]} color="#273b37" />
      <Box p={[5.02, 0.035, -0.65]} s={[7.18, 0.045, 0.065]} color="#273b37" />
      {[3.83, 6.2].map((x) => (
        <Box key={x} p={[x, 1.45, -0.65]} s={[0.043, 2.9, 0.045]} color="#42554c" />
      ))}
      <mesh position={[5.02, 1.45, -0.65]}>
        <boxGeometry args={[7.07, 2.83, 0.018]} />
        <meshPhysicalMaterial
          color="#cee0d8"
          transparent
          opacity={0.075}
          roughness={0.13}
          metalness={0.1}
          depthWrite={false}
        />
      </mesh>
      <Box p={[1.45, 2.91, -3.25]} s={[0.065, 0.065, 5.25]} color="#273b37" />
      <Box p={[1.45, 1.45, -4.55]} s={[0.05, 2.9, 0.055]} color="#273b37" />
      <mesh position={[1.45, 1.45, -4.55]}>
        <boxGeometry args={[0.02, 2.83, 2.52]} />
        <meshPhysicalMaterial
          color="#cee0d8"
          transparent
          opacity={0.07}
          roughness={0.15}
          depthWrite={false}
        />
      </mesh>
      <Box p={[1.45, 1.45, -3.24]} s={[0.05, 2.9, 0.045]} color="#273b37" />
      {/* Open doorway on the near half of the left partition. */}
      <Round p={[5, 0.026, -3.28]} s={[6.4, 0.055, 4.5]} color="#687d6b" radius={0.03} />
      <Round p={[5.1, 0.94, -3.3]} s={[3.65, 0.13, 1.53]} color={C.walnut} radius={0.19} />
      <Box p={[4.1, 0.46, -3.3]} s={[0.13, 0.87, 0.92]} color="#5c594e" />
      <Box p={[6.1, 0.46, -3.3]} s={[0.13, 0.87, 0.92]} color="#5c594e" />
      {[3.9, 5.1, 6.3].map((x) => (
        <group key={x}>
          <Chair p={[x, 0, -2.1]} color={C.sage} />
          <Chair p={[x, 0, -4.5]} color={C.sage} rotation={Math.PI} />
        </group>
      ))}
      <Laptop p={[4.12, 1.015, -3.2]} />
      <Laptop p={[6.08, 1.015, -3.4]} rotation={Math.PI} />
      <Box p={[5.25, 1.03, -3.3]} s={[0.48, 0.035, 0.6]} color="#eee8d9" rotation={[0, 0.18, 0]} />
      <Cylinder p={[5.26, 1.16, -3.65]} radius={0.07} height={0.29} color="#aebdb2" />
      {/* The lounge has a woven rug, upholstered sofa, two armchairs and coffee table. */}
      <Round p={[4.65, 0.035, 3.25]} s={[6.7, 0.065, 4.4]} color={C.rug} radius={0.1} />
      {[-1, 1].map((side) => (
        <Box key={side} p={[4.65, 0.073, 3.25 + side * 1.97]} s={[6.23, 0.009, 0.022]} color="#b6b99e" />
      ))}
      <group position={[4.7, 0, 4.76]}>
        <Round p={[0, 0.38, 0]} s={[3.45, 0.55, 1.02]} color="#834931" radius={0.13} />
        <Round p={[0, 0.91, 0.4]} s={[3.5, 0.82, 0.25]} color={C.terra} radius={0.1} />
        {[-1, 0, 1].map((i) => (
          <Round key={i} p={[i * 1.03, 0.69, -0.07]} s={[0.99, 0.22, 0.79]} color="#b87551" radius={0.08} />
        ))}
        {[-1, 1].map((side) => (
          <group key={side}>
            <Round p={[side * 1.62, 0.72, -0.04]} s={[0.29, 0.66, 1.08]} color={C.terra} radius={0.08} />
            <Round
              p={[side * 1.17, 0.94, 0.16]}
              s={[0.48, 0.47, 0.17]}
              color={side < 0 ? '#c4c3a3' : '#dcc6a8'}
              rotation={[-0.14, 0, side * 0.18]}
              radius={0.07}
            />
            <Box p={[side * 1.35, 0.115, 0]} s={[0.11, 0.22, 0.58]} color={C.walnut} />
          </group>
        ))}
      </group>
      {[2.5, 6.9].map((x, i) => (
        <group key={x} position={[x, 0, 1.75]} rotation={[0, i ? -0.25 : 0.25, 0]}>
          <Round p={[0, 0.43, 0]} s={[1.27, 0.55, 1.18]} color={C.navy} radius={0.11} />
          <Round p={[0, 0.93, -0.44]} s={[1.27, 0.73, 0.23]} color="#3b626b" radius={0.1} />
          <Round p={[0, 0.71, 0.06]} s={[0.95, 0.16, 0.92]} color="#55777a" radius={0.07} />
          {[-1, 1].map((side) => (
            <Round
              key={side}
              p={[side * 0.57, 0.75, 0.01]}
              s={[0.19, 0.45, 1.1]}
              color="#3b626b"
              radius={0.07}
            />
          ))}
        </group>
      ))}
      <Round p={[4.7, 0.54, 3.18]} s={[2.32, 0.1, 1.15]} color={C.desk} radius={0.25} />
      {[-1, 1].map((side) => (
        <Box key={side} p={[4.7 + side * 0.75, 0.26, 3.18]} s={[0.12, 0.51, 0.65]} color={C.walnut} />
      ))}
      <Box p={[4.34, 0.61, 3.16]} s={[0.47, 0.05, 0.62]} color="#a5b39c" rotation={[0, -0.17, 0]} />
      <Box p={[4.37, 0.655, 3.15]} s={[0.4, 0.025, 0.52]} color="#f0e5ca" rotation={[0, -0.08, 0]} />
      <Cylinder p={[5.24, 0.67, 3.25]} radius={0.115} height={0.16} color="#eee4d0" />
      <Plant position={[-8.15, 0, 5.15]} size={1.3} />
      <Plant position={[8.05, 0, -5.2]} size={1.4} />
      <Plant position={[8.15, 0, 4.95]} size={1.3} pot="#b58f73" />
      <Plant position={[-8.15, 0, -5.05]} size={1.12} />
      <Plant position={[0.55, 0, 1.55]} size={1.05} />
      {/* A small pinboard and clock finish the far wall. */}
      <group position={[-3.88, 2.34, -5.84]}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.3, 0.3, 0.05, 32]} />
          <meshStandardMaterial color="#788176" />
        </mesh>
        <mesh position={[0, 0, 0.035]}>
          <circleGeometry args={[0.262, 32]} />
          <meshStandardMaterial color="#f1eee0" />
        </mesh>
        <Box p={[0.061, 0.045, 0.047]} s={[0.15, 0.018, 0.008]} color={C.ink} rotation={[0, 0, 0.7]} />
        <Box p={[0, 0.087, 0.05]} s={[0.017, 0.19, 0.009]} color={C.ink} />
      </group>
      {desks.map((position, index) => (
        <Desk key={index} position={position} index={index} />
      ))}
    </group>
  );
}
