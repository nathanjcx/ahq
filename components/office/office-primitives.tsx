'use client';

import { createContext, useContext, useEffect, useMemo } from 'react';
import { RoundedBox } from '@react-three/drei';
import * as THREE from 'three';

export type Point = [number, number, number];

export const C = {
  wall: '#ddd7c7',
  trim: '#ece6d6',
  wood: '#a98051',
  walnut: '#553d2b',
  desk: '#c3a475',
  ink: '#243c38',
  navy: '#315461',
  sage: '#738c65',
  terra: '#a35e42',
  brass: '#be9650',
  plant: '#315d3b',
  rug: '#81907a',
};

/** Statuses that place a person in the office; anything else stays off the floor. */

/** Desk anchors and the two fixed furniture positions the scene and its people share. */
export const desks: Point[] = [
  [-6.3, 0, -3.2],
  [-3.1, 0, -3.2],
  [-6.3, 0, 0.1],
  [-3.1, 0, 0.1],
  [-6.3, 0, 3.4],
  [-3.1, 0, 3.4],
];
export const storagePosition: Point = [0.43, 0, -5.23];
export const speakerPosition: Point = [-1.45, 9.4, -5.75];

type SurfaceMaps = {
  wood: THREE.DataTexture;
  fabric: THREE.DataTexture;
  plaster: THREE.DataTexture;
};
export const SurfaceContext = createContext<SurfaceMaps | null>(null);

export function useSurfaceTextures() {
  const maps = useMemo(() => {
    function make(kind: 'wood' | 'fabric' | 'plaster') {
      const width = 128;
      const pixels = new Uint8Array(width * width * 4);
      for (let y = 0; y < width; y++)
        for (let x = 0; x < width; x++) {
          const noise = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
          const n = noise - Math.floor(noise);
          const grain =
            Math.sin(y * 0.73 + Math.sin(x * 0.034) * 2.8) * 5 + Math.sin(y * 2.1 + x * 0.021) * 2;
          const weave = (x % 3 === 0 ? -7 : 0) + (y % 3 === 0 ? -6 : 0);
          const value = Math.round(
            kind === 'wood' ? 243 + grain + n * 9 : kind === 'fabric' ? 247 + weave + n * 5 : 245 + n * 10,
          );
          const i = (y * width + x) * 4;
          pixels[i] = pixels[i + 1] = pixels[i + 2] = Math.min(255, Math.max(0, value));
          pixels[i + 3] = 255;
        }
      const texture = new THREE.DataTexture(pixels, width, width, THREE.RGBAFormat);
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.magFilter = THREE.LinearFilter;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.generateMipmaps = true;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.repeat.set(kind === 'fabric' ? 3 : 1, kind === 'fabric' ? 3 : 1);
      texture.needsUpdate = true;
      return texture;
    }
    return {
      wood: make('wood'),
      fabric: make('fabric'),
      plaster: make('plaster'),
    };
  }, []);
  useEffect(() => () => Object.values(maps).forEach((texture) => texture.dispose()), [maps]);
  return maps;
}

export function GlowBar({ p, s, color = '#ffe1a0' }: { p: Point; s: Point; color?: string }) {
  return (
    <mesh position={p}>
      <boxGeometry args={s} />
      <meshBasicMaterial color={color} toneMapped={false} />
    </mesh>
  );
}

export function Box({
  p = [0, 0, 0],
  s,
  color,
  rotation,
  roughness = 0.75,
  metalness = 0,
  ...rest
}: {
  p?: Point;
  s: Point;
  color: string;
  rotation?: Point;
  roughness?: number;
  metalness?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
}) {
  const surfaces = useContext(SurfaceContext);
  const surface =
    color === C.desk || color === C.walnut
      ? surfaces?.wood
      : color === C.wall
        ? surfaces?.plaster
        : undefined;
  return (
    <mesh position={p} rotation={rotation} castShadow receiveShadow {...rest}>
      <boxGeometry args={s} />
      <meshStandardMaterial color={color} map={surface} roughness={roughness} metalness={metalness} />
    </mesh>
  );
}

export function Round({
  p = [0, 0, 0],
  s,
  color,
  radius = 0.07,
  rotation,
}: {
  p?: Point;
  s: Point;
  color: string;
  radius?: number;
  rotation?: Point;
}) {
  const surfaces = useContext(SurfaceContext);
  const isWood = color === C.desk || color === C.walnut;
  return (
    <RoundedBox
      position={p}
      args={s}
      radius={radius}
      smoothness={2}
      rotation={rotation}
      castShadow
      receiveShadow
    >
      <meshStandardMaterial
        color={color}
        roughness={isWood ? 0.57 : 0.88}
        map={isWood ? surfaces?.wood : surfaces?.fabric}
      />
    </RoundedBox>
  );
}

export function Cylinder({
  p,
  radius,
  height,
  color,
  rotation,
}: {
  p: Point;
  radius: number;
  height: number;
  color: string;
  rotation?: Point;
}) {
  return (
    <mesh position={p} rotation={rotation} castShadow receiveShadow>
      <cylinderGeometry args={[radius, radius, height, 16]} />
      <meshStandardMaterial color={color} roughness={0.7} />
    </mesh>
  );
}
