'use client';

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html, RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import { useOfficePan } from './office-pan';

/** The one employee shape this component understands. */
export type OfficeEmployee = {
  id: string;
  name: string;
  role: string;
  status: string;
  color?: string;
};

type Point = [number, number, number];
/** Where a person is in the room; drives the pose and the anchor furniture. */
type Activity = 'research' | 'discussion' | 'lounge';

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
};

const C = {
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
const ACTIVE_STATUSES = new Set(['working', 'review', 'ready']);

export function isActiveEmployee(employee: OfficeEmployee): boolean {
  return ACTIVE_STATUSES.has(employee.status.trim().toLowerCase());
}

const desks: Point[] = [
  [-6.3, 0, -3.2],
  [-3.1, 0, -3.2],
  [-6.3, 0, 0.1],
  [-3.1, 0, 0.1],
  [-6.3, 0, 3.4],
  [-3.1, 0, 3.4],
];
const storagePosition: Point = [0.43, 0, -5.23];
const speakerPosition: Point = [-1.45, 9.4, -5.75];

type SurfaceMaps = {
  wood: THREE.DataTexture;
  fabric: THREE.DataTexture;
  plaster: THREE.DataTexture;
};
const SurfaceContext = createContext<SurfaceMaps | null>(null);

function useSurfaceTextures() {
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

function GlowBar({ p, s, color = '#ffe1a0' }: { p: Point; s: Point; color?: string }) {
  return (
    <mesh position={p}>
      <boxGeometry args={s} />
      <meshBasicMaterial color={color} toneMapped={false} />
    </mesh>
  );
}

function Box({
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

function Round({
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

function Cylinder({
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

function ArchitecturalDetails() {
  return (
    <group>
      {/* A layered, chamfered architectural model rather than a floating floor. */}
      <Round p={[0, -0.48, 0]} s={[18.47, 0.31, 12.47]} color="#1e3029" radius={0.055} />
      <Box
        p={[0, -0.318, 6.215]}
        s={[18.37, 0.022, 0.035]}
        color={C.brass}
        metalness={0.72}
        roughness={0.27}
      />
      <Box
        p={[9.215, -0.318, 0]}
        s={[0.035, 0.022, 12.37]}
        color={C.brass}
        metalness={0.72}
        roughness={0.27}
      />
      {Array.from({ length: 22 }, (_, i) => (
        <Box
          key={i}
          p={[-8.5 + i * 0.16, -0.48, 6.24]}
          s={[0.014, i % 5 === 0 ? 0.12 : 0.055, 0.014]}
          color="#738579"
          castShadow={false}
        />
      ))}
      {/* Walnut acoustic slats give the meeting room a distinct architectural volume. */}
      <Box p={[5.04, 1.56, -5.9]} s={[7.12, 3.08, 0.035]} color="#392f23" />
      {Array.from({ length: 45 }, (_, i) => (
        <Box
          key={i}
          p={[1.57 + i * 0.159, 1.55, -5.855]}
          s={[0.082, 3.04, 0.055]}
          color={i % 3 === 0 ? '#68492f' : C.walnut}
          roughness={0.6}
        />
      ))}
      <GlowBar p={[5.07, 3.015, -5.76]} s={[6.92, 0.024, 0.025]} color="#efd294" />
      <Box p={[5.04, 3.17, -5.95]} s={[7.27, 0.15, 0.21]} color="#2c3a31" />
      <Box p={[8.63, 3.17, -3.27]} s={[0.13, 0.15, 5.53]} color="#2c3a31" />
      <Box p={[8.63, 1.57, -0.59]} s={[0.12, 3.15, 0.12]} color="#2c3a31" />
      <Box p={[5.02, 3.17, -0.59]} s={[7.28, 0.15, 0.13]} color="#2c3a31" />
      <Box p={[1.43, 3.17, -3.27]} s={[0.13, 0.15, 5.53]} color="#2c3a31" />
      <Box p={[1.43, 1.57, -0.59]} s={[0.1, 3.15, 0.1]} color="#2c3a31" />
      {/* The suspended linear fixture sits inside the open roof, above the table. */}
      <Box p={[5.04, 3.17, -3.28]} s={[7.12, 0.07, 0.075]} color="#293b32" />
      {[3.92, 6.12].map((x) => (
        <Cylinder key={x} p={[x, 2.98, -3.28]} radius={0.009} height={0.35} color="#4b594b" />
      ))}
      <Round p={[5.02, 2.78, -3.28]} s={[3.62, 0.095, 0.22]} color="#24372e" radius={0.025} />
      <GlowBar p={[5.02, 2.725, -3.28]} s={[3.42, 0.015, 0.155]} />
      <pointLight position={[5.05, 2.55, -3.2]} color="#ffd9a0" intensity={2.5} distance={7} decay={2} />
      {/* Frosted privacy bands and a brass door pull make the glass read as glass. */}
      {[2.4, 4.75, 7.1].map((x) => (
        <mesh key={x} position={[x, 1.17, -0.638]}>
          <boxGeometry args={[1.6, 0.075, 0.005]} />
          <meshBasicMaterial color="#b3cbc0" transparent opacity={0.2} depthWrite={false} />
        </mesh>
      ))}
      <Cylinder p={[1.43, 1.25, -2.95]} radius={0.022} height={0.31} color={C.brass} />
      {/* Every workstation has a practical lamp and a small personal object. */}
      {desks.map((p, i) => (
        <group key={i} position={[p[0] + 0.92, 0.985, p[2] - 0.32]}>
          <Cylinder p={[0, 0.019, 0]} radius={0.12} height={0.038} color="#555b48" />
          <Cylinder p={[0, 0.23, 0]} radius={0.014} height={0.43} color={C.brass} />
          <Box p={[-0.075, 0.44, 0]} s={[0.18, 0.035, 0.035]} color={C.brass} metalness={0.6} />
          <mesh position={[-0.16, 0.4, 0]} castShadow>
            <coneGeometry args={[0.115, 0.12, 20, 1, true]} />
            <meshStandardMaterial
              color={i % 2 ? '#ad8750' : '#445a42'}
              side={THREE.DoubleSide}
              roughness={0.5}
            />
          </mesh>
          <GlowBar p={[-0.16, 0.343, 0]} s={[0.15, 0.012, 0.1]} color="#ffe2a2" />
          <pointLight
            position={[-0.16, 0.32, 0]}
            color="#ffdd9b"
            intensity={0.16}
            distance={1.25}
            decay={2}
          />
        </group>
      ))}
      {[1, 3].map((index) => (
        <group key={index} position={[desks[index][0], 0.985, desks[index][2] - 0.34]}>
          <Round p={[0, 0.022, 0]} s={[0.37, 0.04, 0.25]} color="#3e4d45" radius={0.02} />
          <Box p={[0, 0.19, -0.055]} s={[0.065, 0.33, 0.055]} color="#3e4d45" />
          <Round p={[0, 0.48, -0.09]} s={[1.11, 0.64, 0.045]} color="#273a33" radius={0.03} />
          <Box p={[0, 0.48, -0.06]} s={[1.02, 0.555, 0.014]} color="#193c36" />
          {[0, 1, 2, 3].map((i) => (
            <GlowBar
              key={i}
              p={[-0.25 + i * 0.165, 0.43 + (i % 3) * 0.055, -0.048]}
              s={[0.085, 0.13 + (i % 3) * 0.11, 0.005]}
              color={i % 2 ? '#88b59a' : '#d7bb7d'}
            />
          ))}
          <GlowBar p={[0, 0.69, -0.048]} s={[0.77, 0.018, 0.005]} color="#b0c7b0" />
        </group>
      ))}
      {/* A warm floor lamp and side table finish the lounge silhouette. */}
      <group position={[7.57, 0, 4.95]}>
        <Cylinder p={[0, 0.035, 0]} radius={0.24} height={0.07} color="#5a563e" />
        <Cylinder p={[0, 1.11, 0]} radius={0.027} height={2.14} color={C.brass} />
        <Box p={[-0.22, 2.19, 0]} s={[0.47, 0.035, 0.035]} color={C.brass} />
        <mesh position={[-0.43, 2.075, 0]} castShadow>
          <coneGeometry args={[0.3, 0.27, 24, 1, true]} />
          <meshStandardMaterial color="#ded0ae" roughness={0.7} side={THREE.DoubleSide} />
        </mesh>
        <GlowBar p={[-0.43, 1.946, 0]} s={[0.37, 0.015, 0.26]} />
        <pointLight position={[-0.43, 1.85, 0]} intensity={1.25} color="#ffdc9e" distance={3.8} decay={2} />
      </group>
      <Cylinder p={[7.56, 0.61, 3.87]} radius={0.34} height={0.08} color={C.walnut} />
      <Cylinder p={[7.56, 0.32, 3.87]} radius={0.065} height={0.57} color={C.brass} />
      <Cylinder p={[7.56, 0.06, 3.87]} radius={0.22} height={0.055} color="#53634e" />
      {/* The lounge rug has a restrained woven border and directional striping. */}
      {Array.from({ length: 12 }, (_, i) => (
        <Box
          key={i}
          p={[1.54 + i * 0.565, 0.076, 3.25]}
          s={[0.014, 0.008, 4.18]}
          color="#94a086"
          castShadow={false}
        />
      ))}
    </group>
  );
}

/**
 * The wall display carries the room's identity only. No pipeline counts or
 * progress metrics: an office with no activity has no numbers to show.
 */
function OperationsDisplay() {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 576;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#142c26';
    ctx.fillRect(0, 0, 1024, 576);
    ctx.fillStyle = '#cbbc98';
    ctx.font = '600 28px Arial';
    ctx.fillText('A S T R A  H Q', 54, 63);
    ctx.fillStyle = '#9cd8a8';
    ctx.beginPath();
    ctx.arc(932, 53, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f0e8d4';
    ctx.font = '500 62px Arial';
    ctx.fillText('A little space for big things.', 52, 164);
    ctx.fillStyle = '#8ea69a';
    ctx.font = '27px Arial';
    ctx.fillText('THE TEAM OFFICE', 55, 214);
    const labels = ['RESEARCH', 'CREATE', 'REVIEW', 'SHIP'];
    labels.forEach((label, i) => {
      const x = 58 + i * 244;
      ctx.fillStyle = i === 2 ? '#baa06a' : '#35594a';
      ctx.fillRect(x, 279, 204, 143);
      ctx.fillStyle = i === 2 ? '#24392c' : '#dbe2cb';
      ctx.font = '600 21px Arial';
      ctx.fillText(label, x + 17, 313);
      ctx.font = '500 49px Arial';
      ctx.fillText('—', x + 17, 377);
      if (i < 3) {
        ctx.fillStyle = '#73896f';
        ctx.fillRect(x + 214, 346, 20, 2);
      }
    });
    ctx.fillStyle = '#809585';
    ctx.font = '23px Arial';
    ctx.fillText('One team. A hundred possibilities.', 55, 506);
    ctx.fillStyle = '#6e8974';
    ctx.fillRect(54, 457, 916, 1);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;
    return map;
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <group position={[-5.68, 2.05, -5.79]}>
      <Round s={[3.85, 2.04, 0.1]} color="#273c32" radius={0.045} />
      <mesh position={[0, 0, 0.057]}>
        <planeGeometry args={[3.65, 1.89]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
      <GlowBar p={[0, -1.075, -0.005]} s={[3.3, 0.018, 0.025]} color="#b9c48c" />
    </group>
  );
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

function Plant({ position, size = 1, pot = '#dbd7c9' }: { position: Point; size?: number; pot?: string }) {
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

function Laptop({
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

function Chair({ p, color = C.navy, rotation = 0 }: { p: Point; color?: string; rotation?: number }) {
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

function Desk({ position, index }: { position: Point; index: number }) {
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

function Bookshelf({ p }: { p: Point }) {
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

function Whiteboard() {
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

function Architecture() {
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
      <ArchitecturalDetails />
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

function EmployeeAvatar({
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
          <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
            <span>{employee.name.split(' ')[0]}</span>
            <span style={{ fontSize: 10, fontWeight: 400, opacity: 0.85 }}>{employee.role}</span>
          </span>
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

function FileCabinet() {
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
function OfficeSpeakers() {
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

export function OfficeScene({
  employees,
  onSelect,
  motion,
  zoom,
  angle,
  resetKey,
  eventSource,
}: OfficeSceneProps) {
  const surfaces = useSurfaceTextures();
  const seats = useRef(new Map<string, number>());
  const people = useMemo(() => {
    const assigned = seats.current;
    const active = employees.filter(isActiveEmployee);
    const taken = new Set(active.map((employee) => assigned.get(employee.id)));
    taken.delete(undefined);
    let seat = 0;
    const planned = active.map((employee, index) => {
      let own = assigned.get(employee.id);
      if (own === undefined) {
        while (taken.has(seat)) seat += 1;
        own = seat;
        taken.add(own);
        assigned.set(employee.id, own);
      }
      const activity: Activity =
        employee.status.trim().toLowerCase() === 'working'
          ? 'research'
          : employee.status.trim().toLowerCase() === 'review'
            ? 'discussion'
            : 'lounge';
      const home: Point =
        activity === 'discussion'
          ? [3.3 + (own % 3) * 0.95, 0, own % 6 < 3 ? -4.94 : -1.65]
          : activity === 'lounge'
            ? [3.65 + (own % 3) * 1.03, 0, 4.68]
            : [desks[own % desks.length][0], 0, desks[own % desks.length][2] + 1];
      return { employee, index, activity, home };
    });
    return planned;
  }, [employees]);
  return (
    <>
      <color attach="background" args={['#f1f4ee']} />
      <Framing zoom={zoom * 37} angle={angle} resetKey={resetKey} source={eventSource} />
      <ambientLight intensity={0.38} />
      <hemisphereLight args={['#dce7df', '#3e4631', 0.72]} />
      <directionalLight
        position={[-12, 14, 9]}
        intensity={3.8}
        color="#ffe6ba"
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
      <directionalLight position={[10, 9, -2]} intensity={1.1} color="#a9c9cd" />
      <SurfaceContext.Provider value={surfaces}>
        <Architecture />
        <FileCabinet />
        <OfficeSpeakers />
        {people.map((person) => (
          <EmployeeAvatar
            key={person.employee.id}
            employee={person.employee}
            index={person.index}
            activity={person.activity}
            home={person.home}
            motion={motion}
            onSelect={onSelect}
          />
        ))}
      </SurfaceContext.Provider>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.71, 0]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial color="#ffffff" roughness={1} />
      </mesh>
      <gridHelper args={[200, 200, '#a7b6a3', '#b8c4b4']} position={[0, -0.7, 0]} />
    </>
  );
}
