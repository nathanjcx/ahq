'use client';

import * as THREE from 'three';
import { Box, C, Cylinder, Round, speakerPosition, storagePosition, type Point } from './office-primitives';

export function Plant({
  position,
  size = 1,
  pot = '#dbd7c9',
}: {
  position: Point;
  size?: number;
  pot?: string;
}) {
  return (
    <group position={position} scale={size}>
      <mesh position={[0, 0.25, 0]} castShadow>
        <cylinderGeometry args={[0.25, 0.2, 0.5, 16]} />
        <meshStandardMaterial color={pot} roughness={0.9} />
      </mesh>
      <Cylinder p={[0, 0.505, 0]} radius={0.21} height={0.025} color="#665344" />
      {[0, 1, 2, 3, 4, 5, 6].map((i) => {
        const theta = i * 2.4;
        const height = 0.65 + (i % 3) * 0.22;
        return (
          <group key={i} rotation={[0, theta, 0]}>
            <Cylinder
              p={[0.08, height * 0.65, 0]}
              radius={0.018}
              height={height}
              color="#64794d"
              rotation={[0, 0, -0.13]}
            />
            <mesh
              position={[0.2, height + 0.18, 0]}
              rotation={[0.2, 0, -0.62]}
              scale={[0.17, 0.39, 0.065]}
              castShadow
            >
              <sphereGeometry args={[1, 7, 6]} />
              <meshStandardMaterial color={i % 2 ? '#6f8c58' : C.plant} roughness={0.9} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

export function Laptop({
  p = [0, 0.97, 0],
  color = '#35484d',
  rotation = 0,
}: {
  p?: Point;
  color?: string;
  rotation?: number;
}) {
  return (
    <group position={p} rotation={[0, rotation, 0]}>
      <Round p={[0, 0.018, 0]} s={[0.61, 0.035, 0.42]} color="#aeb7b5" radius={0.015} />
      <Box p={[0, 0.039, -0.015]} s={[0.46, 0.008, 0.19]} color="#5f6c6b" />
      <Box p={[0, 0.04, 0.135]} s={[0.16, 0.009, 0.08]} color="#bac3bf" />
      <group position={[0, 0.23, -0.2]} rotation={[-0.16, 0, 0]}>
        <Round s={[0.63, 0.44, 0.032]} color="#64716f" radius={0.018} />
        <Box p={[0, 0.012, 0.019]} s={[0.56, 0.365, 0.008]} color={color} />
        {[0, 1, 2, 3].map((i) => (
          <Box
            key={i}
            p={[-0.06, 0.1 - i * 0.055, 0.025]}
            s={[0.31 - (i % 2) * 0.09, 0.015, 0.004]}
            color={i === 0 ? '#b8d6b2' : '#71908b'}
          />
        ))}
      </group>
    </group>
  );
}

export function Chair({ p, color = C.navy, rotation = 0 }: { p: Point; color?: string; rotation?: number }) {
  return (
    <group position={p} rotation={[0, rotation, 0]}>
      <Cylinder p={[0, 0.25, 0]} radius={0.055} height={0.45} color="#656b67" />
      <Box p={[0, 0.07, 0]} s={[0.58, 0.055, 0.055]} color="#626a67" />
      <Box p={[0, 0.07, 0]} s={[0.055, 0.055, 0.58]} color="#626a67" />
      <Round p={[0, 0.49, 0]} s={[0.65, 0.13, 0.63]} color={color} radius={0.08} />
      <Round p={[0, 0.86, 0.27]} s={[0.64, 0.61, 0.11]} color={color} radius={0.09} />
      {[-1, 1].map((side) => (
        <group key={side}>
          <Box p={[side * 0.32, 0.63, 0.04]} s={[0.035, 0.24, 0.035]} color="#4b5855" />
          <Round p={[side * 0.32, 0.74, 0.04]} s={[0.07, 0.065, 0.34]} color="#4b5855" radius={0.022} />
        </group>
      ))}
    </group>
  );
}

export function Desk({ position, index }: { position: Point; index: number }) {
  return (
    <group position={position}>
      <Round p={[0, 0.91, 0]} s={[2.5, 0.13, 1.22]} color={C.desk} radius={0.045} />
      {[-1, 1].map((side) => (
        <group key={side}>
          <Box p={[side * 1.04, 0.44, -0.38]} s={[0.09, 0.86, 0.09]} color={C.trim} />
          <Box p={[side * 1.04, 0.44, 0.38]} s={[0.09, 0.86, 0.09]} color={C.trim} />
          <Box p={[side * 1.04, 0.11, 0]} s={[0.09, 0.075, 0.85]} color={C.trim} />
        </group>
      ))}
      <Box p={[0, 0.76, -0.38]} s={[2.1, 0.12, 0.05]} color="#c0ae92" />
      <Box p={[-0.72, 1.003, 0.17]} s={[0.43, 0.035, 0.52]} color={index % 2 ? '#a1b1a2' : '#b88669'} />
      <Box p={[-0.72, 1.025, 0.17]} s={[0.37, 0.015, 0.47]} color="#eee8d9" />
      <Laptop color={index % 2 ? '#344e56' : '#374d46'} />
      <Cylinder
        p={[0.78, 1.065, 0.23]}
        radius={0.08}
        height={0.17}
        color={index % 2 ? '#a4b1a1' : '#c88f72'}
      />
      <Cylinder p={[0.78, 1.154, 0.23]} radius={0.058} height={0.006} color="#594538" />
      <group position={[0.91, 0.985, -0.33]} scale={0.24}>
        <Plant position={[0, 0, 0]} />
      </group>
      <Chair p={[0, 0, 1]} color={index % 2 ? C.sage : C.navy} />
    </group>
  );
}

export function Bookshelf({ p }: { p: Point }) {
  return (
    <group position={p}>
      <Box p={[0, 1.17, -0.27]} s={[2.5, 2.34, 0.07]} color="#b49775" />
      {[-1, 1].map((side) => (
        <Box key={side} p={[side * 1.22, 1.18, 0]} s={[0.075, 2.37, 0.65]} color={C.desk} />
      ))}
      {[0.1, 0.79, 1.5, 2.32].map((y) => (
        <Box key={y} p={[0, y, 0]} s={[2.5, 0.07, 0.67]} color={C.desk} />
      ))}
      {[0, 1].map((shelf) =>
        Array.from({ length: 11 }, (_, i) => (
          <Box
            key={`${shelf}-${i}`}
            p={[-1.01 + i * 0.17, 1.55 + shelf * -0.71 + 0.22, -0.015]}
            s={[0.11 + (i % 2) * 0.025, 0.36 + (i % 3) * 0.045, 0.35]}
            color={[C.terra, C.sage, C.navy, '#d2c5a3', '#e6dfc9'][i % 5]}
            rotation={[0, 0, i === 8 ? -0.12 : 0]}
          />
        )),
      )}
      {[-0.65, 0.05, 0.75].map((x, i) => (
        <group key={x}>
          <Box p={[x, 0.43, 0.04]} s={[0.57, 0.55, 0.48]} color={i === 1 ? '#9caa9c' : '#c3b699'} />
          <Box p={[x, 0.5, 0.286]} s={[0.2, 0.085, 0.008]} color="#ece7dc" />
        </group>
      ))}
    </group>
  );
}

export function Whiteboard() {
  return (
    <group position={[4.5, 2.03, -5.82]}>
      <Round s={[3.7, 1.5, 0.07]} color="#aaa991" radius={0.03} />
      <Box p={[0, 0, 0.045]} s={[3.56, 1.36, 0.025]} color="#f7f7ed" />
      <Box p={[0, -0.8, 0.1]} s={[3.4, 0.04, 0.2]} color="#c6c9bf" />
      {[-1.25, -0.4, 0.45, 1.25].map((x, i) => (
        <group key={x}>
          <Box
            p={[x, 0.29 - (i % 2) * 0.08, 0.065]}
            s={[0.49, 0.22, 0.008]}
            color={['#aec5a6', '#e3c48e', '#c49b86', '#97b2bd'][i]}
          />
          <Box p={[x, -0.15, 0.066]} s={[0.32, 0.017, 0.009]} color="#8d9990" />
          <Box p={[x, -0.23, 0.066]} s={[0.42, 0.017, 0.009]} color="#a3aea1" />
        </group>
      ))}
      <Box p={[0, -0.43, 0.066]} s={[2.5, 0.022, 0.009]} color="#b2bdb0" />
    </group>
  );
}

export function FileCabinet() {
  return (
    <group position={storagePosition}>
      <Round p={[0, 0.11, 0]} s={[1.07, 0.2, 0.93]} color="#344b42" radius={0.025} />
      <Box p={[0, 1.13, -0.42]} s={[1.05, 1.97, 0.075]} color="#7a8d79" />
      {[-1, 1].map((side) => (
        <Round key={side} p={[side * 0.48, 1.13, 0]} s={[0.09, 1.97, 0.91]} color="#7a8d79" radius={0.025} />
      ))}
      <Round p={[0, 2.075, 0]} s={[1.05, 0.08, 0.91]} color="#7a8d79" radius={0.025} />
      {[0.5, 1.08, 1.66].map((y, index) => (
        <group key={y}>
          <Box p={[0, y - 0.215, 0.07]} s={[0.87, 0.05, 0.78]} color="#485d50" />
          {[-1, 1].map((side) => (
            <Box key={side} p={[side * 0.415, y, 0.07]} s={[0.04, 0.44, 0.78]} color="#485d50" />
          ))}
          <Round p={[0, y, 0.49]} s={[0.95, 0.535, 0.085]} color="#99a88d" radius={0.027} />
          <Box p={[0, y + 0.055, 0.547]} s={[0.28, 0.105, 0.025]} color={C.brass} />
          <Box p={[0, y + 0.055, 0.564]} s={[0.2, 0.055, 0.012]} color="#e9e6d5" />
          <Round p={[0, y - 0.095, 0.568]} s={[0.31, 0.045, 0.085]} color="#354d42" radius={0.015} />
          {index === 2 && (
            <group>
              {[-0.08, 0.04, 0.16].map((z, i) => (
                <group key={z}>
                  <Box p={[0, y + 0.23, z]} s={[0.75, 0.13, 0.027]} color={i === 1 ? '#d4bd83' : '#b0b89b'} />
                  <Box
                    p={[-0.22 + i * 0.2, y + 0.32, z]}
                    s={[0.2, 0.07, 0.028]}
                    color={i === 1 ? '#d4bd83' : '#b0b89b'}
                  />
                </group>
              ))}
            </group>
          )}
        </group>
      ))}
    </group>
  );
}

/** The announcement horn stays as the room's silhouette; it is quiet unless told otherwise. */
export function OfficeSpeakers() {
  return (
    <group position={speakerPosition}>
      <group rotation={[Math.PI / 10, Math.PI / 8, 0]}>
        <mesh position={[0, 0, 0.21]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.34, 0.34, 0.5, 32]} />
          <meshStandardMaterial color="#34564b" roughness={0.4} metalness={0.3} />
        </mesh>
        <mesh position={[0, 0, 0.92]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[1.07, 0.29, 1.42, 48, 1, true]} />
          <meshStandardMaterial color="#ece7d6" roughness={0.38} metalness={0.18} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, 0, 1.63]} castShadow>
          <torusGeometry args={[1.07, 0.075, 12, 64]} />
          <meshStandardMaterial color="#bb9253" metalness={0.45} roughness={0.32} />
        </mesh>
        <mesh position={[0, 0, 0.36]}>
          <circleGeometry args={[0.34, 32]} />
          <meshStandardMaterial color="#203a32" />
        </mesh>
        <mesh position={[0, 0, 0.39]}>
          <sphereGeometry args={[0.2, 24, 16]} />
          <meshStandardMaterial color="#476e5d" metalness={0.2} roughness={0.35} />
        </mesh>
      </group>
    </group>
  );
}
