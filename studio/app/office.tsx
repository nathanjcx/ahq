'use client';

import {
  Component,
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Canvas, events as createPointerEvents, useThree, type CanvasProps } from '@react-three/fiber';
import { Html, Line, RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import type { Employee } from './data';
import {
  deriveOfficePresence,
  type OfficePresence,
  type EmployeePresence,
  type OfficeHandoff,
} from '../../src/lib/office-presence';
import type { OfficeStation } from '../../shared/office-tool-atlas';
import '../../src/styles/office-presence.css';

type OfficeProps = {
  presence?: OfficePresence;
  onStation?: (station: OfficeStation) => void;
  live?: boolean;
  timeSeconds?: number;
  listening?: boolean;
  microphoneLevel?: number;
  team: Employee[];
  selected: string | null;
  onSelect: (id: string) => void;
  motion: boolean;
  timeline: number;
  zoom: number;
  /** Degrees relative to the initial view. */
  angle: number;
  onRoom: (room: string) => void;
};
type Point = [number, number, number];

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

// Desk positions are exported by convention through this stable layout:
// seats: [-6.3, 0, -2.2], [-3.1, 0, -2.2], [-6.3, 0, 1.1],
//        [-3.1, 0, 1.1], [-6.3, 0, 4.4], [-3.1, 0, 4.4].
const desks: Point[] = [
  [-6.3, 0, -3.2],
  [-3.1, 0, -3.2],
  [-6.3, 0, 0.1],
  [-3.1, 0, 0.1],
  [-6.3, 0, 3.4],
  [-3.1, 0, 3.4],
];

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

function OperationsDisplay({ presence }: { presence: OfficePresence }) {
  const workers = Object.values(presence.employees).filter((employee) => employee.observed);
  const counts = [
    workers.filter((employee) => employee.status === 'working').length,
    workers.filter((employee) => employee.status === 'queued').length,
    workers.filter((employee) => employee.status === 'review').length,
    workers.filter((employee) => employee.status === 'completed').length,
  ];
  const signature = counts.join(':');
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 576;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#142c26';
    ctx.fillRect(0, 0, 1024, 576);
    ctx.fillStyle = '#cbbc98';
    ctx.font = '600 28px Arial';
    ctx.fillText('A H Q  /  THE STUDIO', 54, 63);
    ctx.fillStyle = '#9cd8a8';
    ctx.beginPath();
    ctx.arc(932, 53, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f0e8d4';
    ctx.font = '500 69px Arial';
    ctx.fillText('Good work, together.', 52, 164);
    ctx.fillStyle = '#8ea69a';
    ctx.font = '27px Arial';
    ctx.fillText('RECORDED WORK  /  OFFICE STATUS', 55, 214);
    const labels = ['WORKING', 'QUEUED', 'REVIEW', 'COMPLETE'];
    labels.forEach((label, i) => {
      const x = 58 + i * 244;
      ctx.fillStyle = i === 2 ? '#baa06a' : '#35594a';
      ctx.fillRect(x, 279, 204, 143);
      ctx.fillStyle = i === 2 ? '#24392c' : '#dbe2cb';
      ctx.font = '600 21px Arial';
      ctx.fillText(label, x + 17, 313);
      ctx.font = '500 49px Arial';
      ctx.fillText(String(counts[i]).padStart(2, '0'), x + 17, 377);
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
  }, [signature]);
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

function HandoffRoute({
  start,
  end,
  handoff,
  highlighted,
}: {
  start: Point;
  end: Point;
  handoff: OfficeHandoff;
  highlighted: boolean;
}) {
  const curve = useMemo(
    () =>
      new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(start[0], 1.25, start[2]),
        new THREE.Vector3((start[0] + end[0]) / 2, 3.6, (start[2] + end[2]) / 2),
        new THREE.Vector3(end[0], 1.25, end[2]),
      ),
    [start[0], start[2], end[0], end[2]],
  );
  const points = useMemo(() => curve.getPoints(48), [curve]);
  const packet = curve.getPoint(handoff.progress);
  const color =
    handoff.status === 'acknowledged' ? '#a7d8ae' : handoff.status === 'delivered' ? '#d8c691' : '#a6c8d7';
  return (
    <group>
      <Line
        points={points}
        color={color}
        lineWidth={highlighted ? 1.8 : 1.1}
        transparent
        opacity={handoff.opacity}
        dashed={handoff.status === 'queued'}
        dashSize={0.16}
        gapSize={0.1}
        depthWrite={false}
      />
      <group position={packet} scale={handoff.pulse}>
        <Box s={[0.32, 0.22, 0.04]} color="#f3e7ca" />
        <Line
          points={[
            [-0.16, 0.11, 0.026],
            [0, -0.02, 0.026],
            [0.16, 0.11, 0.026],
          ]}
          color={C.terra}
          lineWidth={1}
        />
        <mesh position={[0, -0.02, 0.029]}>
          <circleGeometry args={[0.035, 12]} />
          <meshBasicMaterial color={color} />
        </mesh>
        {highlighted && (
          <Html center position={[0, 0.35, 0]} zIndexRange={[19, 15]}>
            <span className="office-receipt" title={handoff.summary}>
              {handoff.status === 'acknowledged'
                ? '✓ Acknowledged'
                : handoff.status === 'delivered'
                  ? 'Delivered'
                  : 'Queued'}
            </span>
          </Html>
        )}
      </group>
      <mesh position={[end[0], 0.06, end[2]]} rotation={[-Math.PI / 2, 0, 0]} scale={handoff.pulse}>
        <ringGeometry args={[0.4, 0.44, 36]} />
        <meshBasicMaterial color={color} transparent opacity={handoff.opacity} depthWrite={false} />
      </mesh>
    </group>
  );
}

function WorkflowHandoffs({ presence, selected }: { presence: OfficePresence; selected: string | null }) {
  return (
    <group>
      {presence.handoffs.map((handoff, index) => {
        const from = presence.employees[handoff.fromEmployeeId],
          to = presence.employees[handoff.toEmployeeId];
        return from && to ? (
          <HandoffRoute
            key={handoff.id}
            start={from.position}
            end={to.position}
            handoff={handoff}
            highlighted={selected ? [from.employeeId, to.employeeId].includes(selected) : index === 0}
          />
        ) : null;
      })}
    </group>
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

/** Camera fits the projected architecture to the actual Canvas container. */
function Framing({ zoom, angle }: Pick<OfficeProps, 'zoom' | 'angle'>) {
  const { camera, size, invalidate } = useThree();
  useLayoutEffect(() => {
    if (!(camera instanceof THREE.OrthographicCamera)) return;
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
    const w = bounds.max.x - bounds.min.x;
    const h = bounds.max.y - bounds.min.y;
    // Center the projected cutaway, including its raised back walls, rather
    // than assuming that the floor origin is the visual center.
    const center = bounds.getCenter(new THREE.Vector3());
    camera.translateX(center.x);
    camera.translateY(center.y);
    camera.updateMatrixWorld(true);
    const safeWidth = Math.max(100, size.width - (size.width < 500 ? 16 : 40));
    const safeHeight = Math.max(100, size.height - 32);
    camera.zoom = Math.min(safeWidth / w, safeHeight / h) * Math.max(0.5, zoom / 37);
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, size.width, size.height, zoom, angle, invalidate]);
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

function Architecture({ presence }: { presence: OfficePresence }) {
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
      {/* A framed abstract print provides a quiet, recognizable focal point. */}
      <group position={[-5.8, 2.03, -5.86]} visible={false}>
        <Box s={[1.8, 1.2, 0.08]} color={C.walnut} />
        <Box p={[0, 0, 0.05]} s={[1.68, 1.08, 0.025]} color="#efe9d5" />
        <mesh position={[-0.23, 0.1, 0.07]}>
          <circleGeometry args={[0.33, 32]} />
          <meshStandardMaterial color={C.terra} />
        </mesh>
        <Box p={[0.25, -0.22, 0.073]} s={[0.86, 0.22, 0.01]} color="#788f80" />
        <Box p={[0.4, 0.1, 0.074]} s={[0.16, 0.66, 0.01]} color="#c7ac72" />
      </group>
      <OperationsDisplay presence={presence} />
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

function Figure({
  color,
  index,
  seated,
  pose,
  walking,
  phase,
  appearance,
}: {
  appearance?: Employee['appearance'];
  color: string;
  index: number;
  seated: boolean;
  pose: string;
  walking: boolean;
  phase: number;
}) {
  const skin =
    appearance?.skin ?? ['#b98261', '#e2b48e', '#885e48', '#ce9a76', '#bc815e', '#e6bea0'][index % 6];
  const hair =
    appearance?.hair ?? ['#3d3029', '#76533b', '#272f2b', '#3c3029', '#9c7653', '#3b3431'][index % 6];
  const headY = seated ? 1.31 : 1.62;
  const shoulderY = seated ? 1.01 : 1.29;
  return (
    <group>
      <Round
        p={[0, seated ? 0.91 : 1.12, 0]}
        s={[
          appearance?.gender === 'masculine' ? 0.51 : appearance?.gender === 'feminine' ? 0.43 : 0.47,
          0.57,
          0.29,
        ]}
        color={color}
        radius={0.105}
      />
      {appearance?.hat && appearance.hat !== 'none' && (
        <group>
          <Round p={[0, headY + 0.21, 0]} s={[0.4, 0.19, 0.37]} color={appearance.clothing} radius={0.08} />
          {appearance.hat === 'cap' && (
            <Round
              p={[0, headY + 0.15, 0.2]}
              s={[0.39, 0.04, 0.3]}
              color={appearance.clothing}
              radius={0.03}
            />
          )}
        </group>
      )}
      <Cylinder p={[0, headY - 0.23, 0]} radius={0.075} height={0.15} color={skin} />
      <Round p={[0, headY, 0]} s={[0.35, 0.4, 0.33]} color={skin} radius={0.11} />
      {appearance?.hairstyle !== 'bald' && (
        <Round p={[0, headY + 0.135, -0.025]} s={[0.368, 0.175, 0.352]} color={hair} radius={0.07} />
      )}
      {appearance?.hairstyle !== 'bald' && (
        <Box p={[0, headY + 0.055, -0.156]} s={[0.35, 0.2, 0.045]} color={hair} />
      )}
      {(appearance ? appearance.hairstyle === 'long' : index % 3 === 1) && (
        <Round p={[0.155, headY - 0.1, -0.1]} s={[0.09, 0.32, 0.16]} color={hair} radius={0.04} />
      )}
      <Round p={[0, headY - 0.035, 0.179]} s={[0.071, 0.09, 0.058]} color={skin} radius={0.024} />
      {[-1, 1].map((side) => (
        <group key={side}>
          <mesh position={[side * 0.087, headY + 0.005, 0.167]}>
            <sphereGeometry args={[0.016, 6, 6]} />
            <meshStandardMaterial color="#32392e" />
          </mesh>
          {(appearance ? appearance.glasses : index % 3 === 0) && (
            <Box p={[side * 0.087, headY + 0.012, 0.175]} s={[0.13, 0.075, 0.018]} color="#454d46" />
          )}
          <group
            position={[side * 0.14, seated ? 0.56 : 0.85, 0]}
            rotation={[
              seated ? -Math.PI / 2 : walking ? Math.sin(phase + (side < 0 ? Math.PI : 0)) * 0.48 : 0,
              0,
              0,
            ]}
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
                : pose === 'reading'
                  ? -0.65
                  : pose === 'discussion' && side > 0
                    ? -0.95 + Math.sin(phase * 0.4) * 0.18
                    : walking
                      ? -Math.sin(phase + (side < 0 ? Math.PI : 0)) * 0.4
                      : -0.1,
              0,
              side * (pose === 'discussion' ? 0.2 : 0.07),
            ]}
          >
            <Round p={[0, -0.15, 0]} s={[0.16, 0.31, 0.18]} color={color} radius={0.045} />
            <group
              position={[0, -0.29, 0]}
              rotation={[seated || pose === 'reading' ? -0.85 : pose === 'discussion' ? -0.7 : -0.15, 0, 0]}
            >
              <Round p={[0, -0.11, 0]} s={[0.13, 0.25, 0.14]} color={skin} radius={0.04} />
              <Round p={[0, -0.245, 0.02]} s={[0.13, 0.12, 0.135]} color={skin} radius={0.04} />
            </group>
          </group>
        </group>
      ))}
      {pose === 'reading' && !walking && (
        <group position={[0, 1.08, 0.48]} rotation={[-0.5, 0, 0]}>
          <Box s={[0.44, 0.035, 0.34]} color="#ece4cd" />
          <Box p={[0, -0.025, 0]} s={[0.46, 0.025, 0.37]} color={C.terra} />
          <Box p={[0, 0.02, 0]} s={[0.014, 0.012, 0.32]} color="#b6a98e" />
        </group>
      )}
    </group>
  );
}

function EmployeeAvatar({
  employee,
  index,
  selected,
  onSelect,
  presence,
}: {
  employee: Employee;
  index: number;
  selected: boolean;
  onSelect: OfficeProps['onSelect'];
  presence: EmployeePresence;
}) {
  const [hovered, setHovered] = useState(false);
  const cueColor =
    presence.cue === 'attention'
      ? '#e5b768'
      : presence.cue === 'error'
        ? '#e88a78'
        : presence.cue === 'complete'
          ? '#a9d49d'
          : presence.cue === 'message'
            ? '#9bcede'
            : '#b0ccb6';
  const bubble = selected || hovered || presence.focused;
  return (
    <group position={presence.position} rotation={[0, presence.yaw, 0]}>
      <group
        onClick={(event) => {
          event.stopPropagation();
          onSelect(employee.id);
        }}
        onPointerOver={(event) => {
          event.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
      >
        <Figure
          color={employee.appearance?.clothing || employee.color || C.sage}
          appearance={employee.appearance}
          index={index}
          seated={presence.seated}
          pose={presence.pose}
          walking={presence.walking}
          phase={presence.phase}
        />
        {(selected || hovered || presence.cue !== 'none') && (
          <mesh position={[0, 0.052, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.43, selected ? 0.5 : 0.475, 48]} />
            <meshBasicMaterial
              color={cueColor}
              transparent
              opacity={selected || hovered ? 0.9 : presence.cueStrength}
              depthWrite={false}
            />
          </mesh>
        )}
        {!presence.sample &&
          (presence.cue === 'attention' || presence.cue === 'error' || presence.cue === 'complete') && (
            <Html center position={[0, presence.seated ? 1.73 : 2.01, 0]}>
              <span className={`office-reaction ${presence.cue}`} aria-label={presence.badge}>
                {presence.cue === 'complete' ? '✓' : '!'}
              </span>
            </Html>
          )}
      </group>
      <Html
        center
        position={[
          0,
          (presence.seated ? 2.02 : 2.3) + (presence.station === 'review' ? (index % 2) * 0.25 : 0),
          0,
        ]}
        zIndexRange={bubble ? [35, 30] : [20, 10]}
      >
        <button
          type="button"
          className={`office-person-label${selected ? ' chosen' : ''}`}
          onClick={() => onSelect(employee.id)}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          aria-label={`${employee.name}, ${employee.role}. ${presence.badge}. ${presence.summary}`}
          aria-pressed={selected}
          style={{ '--person-color': employee.color } as CSSProperties}
        >
          <span className="office-person-name">
            <i />
            {employee.name.split(' ')[0]}
            <small>{presence.sample ? 'Sample' : employee.sessionId ? 'Astra' : 'Employee'}</small>
          </span>
          {(bubble || (!presence.sample && presence.observed && presence.status !== 'idle')) && (
            <span className={`office-work-badge ${presence.status}`}>
              {presence.toolName ? '↳ ' : presence.status === 'working' ? '● ' : ''}
              {presence.badge}
            </span>
          )}
        </button>
        {bubble && (
          <div className="office-activity-bubble" role="status">
            <small>
              {presence.sample
                ? 'Sample activity'
                : presence.toolName
                  ? 'Observed tool activity'
                  : 'Recorded update'}
            </small>
            <p>{presence.summary.length > 230 ? `${presence.summary.slice(0, 227)}…` : presence.summary}</p>
          </div>
        )}
      </Html>
    </group>
  );
}

function RoomMarker({
  p,
  room,
  label,
  onRoom,
}: {
  p: Point;
  room: string;
  label: string;
  onRoom: OfficeProps['onRoom'];
}) {
  return (
    <Html center position={p} zIndexRange={[8, 0]}>
      <button
        type="button"
        className="room-label"
        style={{
          border: '1px solid #dce7d035',
          color: '#e9eddb',
          background: '#233e32d9',
          borderRadius: 4,
          padding: '5px 8px',
          fontSize: 9,
          fontWeight: 650,
          letterSpacing: '.075em',
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
        }}
        onClick={() => onRoom(room)}
        aria-label={`Open ${label}`}
      >
        {label}
        <span aria-hidden="true"> ↗</span>
      </button>
    </Html>
  );
}

function OfficeSpeakers({ level, listening }: { level: number; listening: boolean }) {
  return (
    <group>
      {[-7.4, 7.4].map((x) => (
        <group key={x} position={[x, 2.1, -5.57]}>
          <Round s={[0.46, 0.7, 0.3]} color="#263b36" radius={0.055} />
          {[0.14, -0.17].map((y) => (
            <mesh key={y} position={[0, y, 0.17]} scale={1 + (listening ? level : 0) * 0.25}>
              <circleGeometry args={[0.14, 24]} />
              <meshStandardMaterial
                color={listening ? '#92dbb0' : '#52635b'}
                emissive="#57c595"
                emissiveIntensity={listening ? level * 2 : 0}
              />
            </mesh>
          ))}
          {listening &&
            [0, 1, 2].map((i) => (
              <mesh key={i} position={[0, 0, 0.19 + i * 0.02]} scale={1 + level * (i + 1)}>
                <ringGeometry args={[0.37 + i * 0.11, 0.38 + i * 0.11, 32]} />
                <meshBasicMaterial color="#a6e2b9" transparent opacity={level * 0.7} depthWrite={false} />
              </mesh>
            ))}
        </group>
      ))}
    </group>
  );
}

function OfficeStations({
  presence,
  onStation,
}: {
  presence: OfficePresence;
  onStation?: OfficeProps['onStation'];
}) {
  const [hovered, setHovered] = useState<OfficeStation | null>(null);
  const archive = presence.stations.archive,
    dispatch = presence.stations.dispatch;
  const filing = !!archive?.active && /^memory\.(saved|updated|proposed)$/.test(archive.kind);
  const archivePhase = archive?.phase ?? 0;
  const filingProgress = Math.min(1, archivePhase / 1.6);
  const stamping = !!dispatch?.active && dispatch.kind === 'message.acknowledged';
  const station = (id: OfficeStation, p: Point, label: string, permanent = false) => {
    const event = presence.stations[id],
      active = !!event?.active;
    return (
      <Html key={id} center position={p} zIndexRange={[9, 5]}>
        <button
          type="button"
          className={`office-station${active ? ' active' : ''}${permanent ? ' permanent' : ''}`}
          aria-label={`${label}. ${active ? event?.summary : 'Explore this office object'}`}
          title={active ? event?.summary : label}
          onClick={() => onStation?.(id)}
          onMouseEnter={() => setHovered(id)}
          onMouseLeave={() => setHovered(null)}
        >
          <i style={{ opacity: active ? 0.6 + event!.strength * 0.4 : 0.55 }} />
          {(permanent || active || hovered === id) && <span>{label}</span>}
        </button>
      </Html>
    );
  };
  return (
    <group>
      {/* Memory is filed in named drawers. The loose sheet only moves for a recorded write. */}
      <group position={[0.13, 0, -5.19]}>
        <Box p={[0, 0.89, 0]} s={[1.0, 1.78, 0.73]} color="#657c6d" metalness={0.22} />
        <Box p={[0, 1.81, 0]} s={[1.08, 0.065, 0.79]} color={C.walnut} />
        {['Working', 'Journal', 'Facts', 'Playbooks', 'Preferences'].map((label, index) => {
          const y = 1.55 - index * 0.31;
          const open =
            filing &&
            archive?.kind !== 'memory.proposed' &&
            index ===
              ['working', 'episodic', 'semantic', 'procedural', 'preference'].indexOf(
                archive?.memoryKind ?? 'semantic',
              )
              ? Math.sin(filingProgress * Math.PI) * 0.22
              : 0;
          return (
            <group key={label} position={[0, y, open]}>
              <Box p={[0, 0, 0.38]} s={[0.91, 0.27, 0.065]} color={index % 2 ? '#7d9380' : '#8a9a81'} />
              <Box p={[0, -0.07, 0.43]} s={[0.24, 0.027, 0.05]} color={C.brass} metalness={0.6} />
              <Html center position={[0, 0.035, 0.445]} transform distanceFactor={3.5} zIndexRange={[4, 1]}>
                <span className="office-drawer-label">{label}</span>
              </Html>
            </group>
          );
        })}
        <Box p={[0.15, 1.87, 0.02]} s={[0.65, 0.055, 0.48]} color={C.brass} />
        <Box p={[0.15, 1.91, -0.19]} s={[0.65, 0.12, 0.045]} color={C.brass} />
        {filing && (
          <Box
            p={[
              0.02,
              archive?.kind === 'memory.proposed'
                ? 1.95
                : 1.55 -
                  Math.max(
                    0,
                    ['working', 'episodic', 'semantic', 'procedural', 'preference'].indexOf(
                      archive?.memoryKind ?? 'semantic',
                    ),
                  ) *
                    0.31,
              0.95 - filingProgress * 0.54,
            ]}
            s={[0.5, 0.018, 0.35]}
            color="#fff0c9"
            rotation={[0, 0.08, 0]}
          />
        )}
        <Box p={[-0.7, 0.33, 0.03]} s={[0.29, 0.66, 0.41]} color="#384e47" />
        <Box p={[-0.7, 0.67, 0.03]} s={[0.22, 0.025, 0.065]} color="#152e2b" />
        {archive?.active && archive.kind === 'memory.forgotten' && (
          <Box p={[-0.7, 0.8, 0.03]} s={[0.16, 0.22, 0.013]} color="#eee7cf" />
        )}
      </group>
      {station(
        'archive',
        [0.12, 2.19, -5.1],
        filing && archive?.kind === 'memory.proposed' ? 'Proposal tray · review' : 'Memory cabinet',
        true,
      )}
      {/* Mail stays in the queue tray until a real delivery; acknowledgement presses the stamp. */}
      <group position={[0.03, 0, 4.98]}>
        <Box p={[0, 0.77, 0]} s={[1.12, 0.1, 0.76]} color={C.walnut} />
        {[-0.43, 0.43].map((x) => (
          <Box key={x} p={[x, 0.37, 0]} s={[0.08, 0.74, 0.6]} color={C.walnut} />
        ))}
        {[-0.29, 0.29].map((x) => (
          <group key={x}>
            <Box p={[x, 0.86, 0]} s={[0.43, 0.075, 0.53]} color={x < 0 ? '#789489' : C.brass} />
            <Box p={[x, 0.94, -0.24]} s={[0.43, 0.2, 0.055]} color={x < 0 ? '#789489' : C.brass} />
          </group>
        ))}
        {dispatch?.active && (
          <group
            position={[
              dispatch.kind === 'message.queued' ? -0.29 : 0.29,
              0.91 + Math.sin(dispatch.phase * 3) * 0.025,
              0.02,
            ]}
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <Box s={[0.32, 0.22, 0.018]} color="#f5e7c8" />
            <Line
              points={[
                [-0.16, 0.11, 0.015],
                [0, -0.02, 0.015],
                [0.16, 0.11, 0.015],
              ]}
              color={C.terra}
              lineWidth={1}
            />
          </group>
        )}
        <group
          position={[0.39, 1.03 - (stamping ? Math.max(0, Math.sin(dispatch!.phase * 6)) * 0.11 : 0), 0.15]}
        >
          <Box s={[0.19, 0.06, 0.16]} color="#263c37" />
          <Cylinder p={[0, 0.12, 0]} radius={0.045} height={0.2} color={C.terra} />
        </group>
      </group>
      {station('dispatch', [0.03, 1.4, 4.98], stamping ? 'Receipt acknowledged' : 'Inbox · receipts', true)}
      {/* Tools share the established desks, each with a concrete instrument. */}
      <group position={[-7.0, 1.1, 0.15]}>
        <Round s={[0.49, 0.28, 0.4]} color="#d5d7c6" radius={0.035} />
        <Box p={[0, 0.12, -0.07]} s={[0.34, 0.06, 0.17]} color="#46645a" />
        <Box p={[0, -0.06, 0.22]} s={[0.35, 0.035, 0.24]} color="#243b34" />
        {presence.stations.workbench?.active && (
          <Box
            p={[0, -0.025, 0.28 + Math.min(0.12, presence.stations.workbench.phase * 0.06)]}
            s={[0.28, 0.012, 0.23]}
            color="#f5ebcf"
          />
        )}
      </group>
      {station('workbench', [-7.0, 1.62, 0.15], 'Drafting bench')}
      <group position={[-7.03, 1.19, -3.25]}>
        <Cylinder p={[0, -0.15, 0]} radius={0.14} height={0.06} color={C.brass} />
        <mesh>
          <sphereGeometry args={[0.16, 16, 12]} />
          <meshStandardMaterial color="#779d93" roughness={0.8} />
        </mesh>
        <Line
          points={[
            [-0.17, 0, 0],
            [-0.12, 0.14, 0],
            [0, 0.19, 0],
            [0.14, 0.1, 0],
            [0.17, 0, 0],
          ]}
          color={C.brass}
          lineWidth={2}
        />
      </group>
      {station('research', [-7.03, 1.72, -3.25], 'Research terminal')}
      <group position={[-3.86, 1.09, -3.22]} rotation={[-0.2, 0.1, 0]}>
        <Box s={[0.34, 0.07, 0.46]} color="#566f63" />
        <Box p={[0, 0.04, -0.12]} s={[0.27, 0.014, 0.13]} color="#a8b698" />
        {Array.from({ length: 9 }, (_, i) => (
          <Box
            key={i}
            p={[((i % 3) - 1) * 0.08, 0.045, 0.01 + Math.floor(i / 3) * 0.065]}
            s={[0.055, 0.018, 0.04]}
            color="#e9debc"
          />
        ))}
      </group>
      {station('analysis', [-3.86, 1.58, -3.22], 'Analysis bench')}
      <group position={[-3.87, 1.1, 0.12]}>
        <Round s={[0.36, 0.1, 0.36]} color="#354e48" radius={0.035} />
        <Round p={[0, 0.12, 0]} s={[0.43, 0.11, 0.13]} color={C.terra} radius={0.04} />
        <Cylinder p={[0, 0.065, 0.09]} radius={0.08} height={0.025} color={C.brass} />
      </group>
      {station('connections', [-3.87, 1.65, 0.12], 'Service phone')}
      <group position={[-1.44, 0.88, -4.94]} rotation={[-0.25, 0, 0]}>
        <Box s={[0.58, 0.07, 0.44]} color={C.walnut} />
        <Box p={[0, 0.045, 0]} s={[0.53, 0.025, 0.39]} color="#eee7cd" />
        <Box p={[0, -0.36, 0]} s={[0.09, 0.71, 0.1]} color={C.walnut} />
      </group>
      {station('library', [-1.45, 1.49, -4.94], 'Reading desk')}
      <group position={[5.55, 1.09, -3.15]}>
        <Box s={[0.37, 0.045, 0.48]} color="#c7a962" />
        <Box p={[0, 0.03, 0]} s={[0.3, 0.02, 0.39]} color="#f3e6cb" />
        <Cylinder p={[0.28, 0.045, 0]} radius={0.07} height={0.1} color={C.terra} />
      </group>
      {station('review', [5.55, 1.63, -3.15], 'Manager review')}
      <group position={[4.92, 0.82, 3.04]}>
        <Round s={[0.45, 0.32, 0.31]} color="#475e52" radius={0.025} />
        {[-0.17, 0.17].map((x) => (
          <mesh
            key={x}
            position={[x, 0.26, 0]}
            rotation={[Math.PI / 2, 0, presence.stations.recorder?.phase ?? 0]}
          >
            <cylinderGeometry args={[0.13, 0.13, 0.035, 16]} />
            <meshStandardMaterial color={C.brass} metalness={0.4} roughness={0.45} />
          </mesh>
        ))}
        <Box p={[0.27, 0, 0]} s={[0.13, 0.15, 0.18]} color="#283f37" />
        {presence.stations.recorder?.active && (
          <GlowBar p={[0.35, 0, 0]} s={[0.014, 0.11, 0.13]} color="#f4d8a1" />
        )}
      </group>
      {station('recorder', [4.92, 1.48, 3.04], 'Replay projector')}
    </group>
  );
}

function Scene(props: OfficeProps & { presence: OfficePresence }) {
  const surfaces = useSurfaceTextures();
  return (
    <>
      <color attach="background" args={['#172724']} />
      <Framing zoom={props.zoom} angle={props.angle} />
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
        <Architecture presence={props.presence} />
        <OfficeSpeakers level={props.microphoneLevel ?? 0} listening={!!props.listening} />
        <OfficeStations presence={props.presence} onStation={props.onStation} />
        <WorkflowHandoffs presence={props.presence} selected={props.selected} />
        {props.team.map((employee, index) => (
          <EmployeeAvatar
            key={employee.id}
            employee={employee}
            index={index}
            selected={props.selected === employee.id}
            onSelect={props.onSelect}
            presence={props.presence.employees[employee.id]}
          />
        ))}
      </SurfaceContext.Provider>
      <RoomMarker p={[-4.9, 0.17, 5.63]} room="workspace" label="The studio" onRoom={props.onRoom} />
      <RoomMarker p={[5.05, 0.17, -0.22]} room="meeting" label="Meeting room" onRoom={props.onRoom} />
      <RoomMarker p={[4.7, 0.17, 5.68]} room="lounge" label="The lounge" onRoom={props.onRoom} />
      <RoomMarker p={[-1.18, 2.63, -5.44]} room="library" label="Library" onRoom={props.onRoom} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.71, 0]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial color="#172724" roughness={1} />
      </mesh>
    </>
  );
}

function Fallback({
  team,
  onSelect,
  presence,
}: Pick<OfficeProps, 'team' | 'onSelect'> & { presence: OfficePresence }) {
  return (
    <div className="scene-fallback">
      <p>Your team is here. Select someone to see what they’re working on.</p>
      <ul>
        {team.map((employee) => (
          <li key={employee.id}>
            <button type="button" onClick={() => onSelect(employee.id)}>
              <strong>{employee.name}</strong> · {employee.role}
              <span>
                {presence.employees[employee.id]?.badge} · {presence.employees[employee.id]?.summary}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

class SceneBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

const safeEvents: NonNullable<CanvasProps['events']> = (store) => {
  const manager = createPointerEvents(store);
  const connect = manager.connect;
  return {
    ...manager,
    connect(target) {
      if (!target?.isConnected) {
        manager.disconnect?.();
        return;
      }
      connect?.(target);
    },
  };
};

export default function Office(props: OfficeProps) {
  const [eventSource, setEventSource] = useState<HTMLDivElement | null>(null);
  // Canvas owns and disposes all geometries, materials, lights, and renderers.
  // No external assets, manually retained GPU resources, or animation timers.
  const presence =
    props.presence ??
    deriveOfficePresence(
      props.team.map((employee) => ({
        id: employee.id,
        status: employee.status,
        location: employee.activityLocation ?? 'desk',
        activity: employee.task,
        sessionId: employee.sessionId,
      })),
      [],
      (props.timeSeconds ?? props.timeline) * 1000,
      true,
    );
  const fallback = <Fallback team={props.team} onSelect={props.onSelect} presence={presence} />;
  return (
    <div
      className="office-canvas"
      ref={setEventSource}
      role="region"
      aria-label="Interactive 3D team office"
      style={{
        width: '100%',
        height: '100%',
        minHeight: 280,
        position: 'relative',
      }}
    >
      <SceneBoundary fallback={fallback}>
        {eventSource && (
          <Canvas
            eventSource={eventSource}
            events={safeEvents}
            orthographic
            shadows={{ type: THREE.PCFShadowMap }}
            camera={{ position: [28, 27, 28], zoom: 25, near: 0.1, far: 150 }}
            dpr={[1, 1.75]}
            frameloop={props.motion || props.listening ? 'always' : 'demand'}
            fallback={fallback}
            gl={{
              antialias: true,
              alpha: false,
              powerPreference: 'high-performance',
            }}
            onCreated={({ gl }) => {
              gl.toneMapping = THREE.ACESFilmicToneMapping;
              gl.toneMappingExposure = 0.96;
              gl.outputColorSpace = THREE.SRGBColorSpace;
            }}
          >
            <Scene {...props} presence={presence} />
          </Canvas>
        )}
      </SceneBoundary>
    </div>
  );
}
