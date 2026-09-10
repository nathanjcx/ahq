import { Suspense, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Html, OrbitControls, RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import type { Employee } from '../../shared/types';

type V3 = [number, number, number];
function Box({
  position = [0, 0, 0],
  size = [1, 1, 1],
  color = '#f4f1e6',
  rotation = [0, 0, 0],
  round = false,
  ...props
}: {
  position?: V3;
  size?: V3;
  color?: string;
  rotation?: V3;
  round?: boolean;
  opacity?: number;
}) {
  const material = (
    <meshStandardMaterial
      color={color}
      roughness={0.78}
      transparent={props.opacity !== undefined}
      opacity={props.opacity ?? 1}
    />
  );
  return round ? (
    <RoundedBox
      args={size}
      radius={0.06}
      smoothness={2}
      position={position}
      rotation={rotation}
      castShadow
      receiveShadow
    >
      {material}
    </RoundedBox>
  ) : (
    <mesh position={position} rotation={rotation} castShadow receiveShadow>
      <boxGeometry args={size} />
      {material}
    </mesh>
  );
}
function Cylinder({
  position,
  radius,
  height,
  color,
  rotation = [0, 0, 0],
}: {
  position: V3;
  radius: number;
  height: number;
  color: string;
  rotation?: V3;
}) {
  return (
    <mesh position={position} rotation={rotation} castShadow receiveShadow>
      <cylinderGeometry args={[radius, radius * 0.92, height, 24]} />
      <meshStandardMaterial color={color} roughness={0.75} />
    </mesh>
  );
}
function Plant({ position, scale = 1, pot = '#e7dfc9' }: { position: V3; scale?: number; pot?: string }) {
  return (
    <group position={position} scale={scale}>
      <Cylinder position={[0, 0.22, 0]} radius={0.23} height={0.44} color={pot} />
      <Cylinder position={[0, 0.44, 0]} radius={0.205} height={0.03} color="#554438" />
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
        const angle = i * 2.4,
          length = 0.43 + (i % 3) * 0.09;
        const x = Math.cos(angle) * 0.2,
          z = Math.sin(angle) * 0.2;
        return (
          <group key={i}>
            <Cylinder
              position={[x / 2, 0.7, z / 2]}
              radius={0.018}
              height={0.6 + (i % 3) * 0.08}
              color="#637848"
              rotation={[z * 1.2, 0, -x * 1.2]}
            />
            <mesh
              position={[x * 1.3, 0.85 + (i % 3) * 0.12, z * 1.3]}
              rotation={[z * 2, angle, x * 1.8]}
              scale={[length * 0.42, length, 0.07]}
              castShadow
            >
              <sphereGeometry args={[1, 10, 8]} />
              <meshStandardMaterial color={['#536e41', '#6e8952', '#809361', '#405d3d'][i % 4]} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
function Chair({
  position,
  rotation = 0,
  color = '#62766b',
}: {
  position: V3;
  rotation?: number;
  color?: string;
}) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <Cylinder position={[0, 0.35, 0]} radius={0.045} height={0.65} color="#505650" />
      <Box position={[0, 0.64, 0]} size={[0.7, 0.16, 0.65]} color={color} round />
      <Box position={[0, 1.02, 0.29]} size={[0.69, 0.75, 0.15]} color={color} round />
      {[-1, 1].map((i) => (
        <group key={i}>
          <Box position={[i * 0.37, 0.83, 0]} size={[0.065, 0.08, 0.43]} color="#424b46" round />
          <Box
            position={[0, 0.12, 0]}
            size={[0.95, 0.06, 0.06]}
            rotation={[0, i * 0.65, 0]}
            color="#49524b"
          />
        </group>
      ))}
    </group>
  );
}
function Monitor({ position, rotation = 0 }: { position: V3; rotation?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <Box position={[0, 0.05, 0]} size={[0.42, 0.045, 0.28]} color="#858e89" />
      <Box position={[0, 0.23, 0]} size={[0.07, 0.38, 0.07]} color="#7e8783" />
      <Box position={[0, 0.49, 0]} size={[0.85, 0.56, 0.06]} color="#374541" round />
      <Box position={[0, 0.49, 0.036]} size={[0.77, 0.47, 0.007]} color="#d3e4df" />
      <Box position={[-0.23, 0.49, 0.043]} size={[0.18, 0.42, 0.008]} color="#759e92" />
      {[0, 1, 2, 3].map((i) => (
        <Box
          key={i}
          position={[0.09, 0.62 - i * 0.085, 0.043]}
          size={[0.36 - (i % 2) * 0.12, 0.028, 0.008]}
          color={i === 0 ? '#3e7865' : '#9bb9ae'}
        />
      ))}
    </group>
  );
}
function Desk({ position, flip = false }: { position: V3; flip?: boolean }) {
  return (
    <group position={position} rotation={[0, flip ? Math.PI : 0, 0]}>
      <Box position={[0, 0.95, 0]} size={[2.2, 0.13, 1.13]} color="#ddc49e" round />
      {[-0.92, 0.92].map((x) => (
        <Box key={x} position={[x, 0.47, 0]} size={[0.09, 0.9, 0.86]} color="#e6e6dc" />
      ))}
      <Box position={[0.79, 0.59, 0]} size={[0.43, 0.65, 0.85]} color="#d9d9ce" />
      {[0.4, 0.61, 0.82].map((y) => (
        <Box key={y} position={[0.79, y, 0.44]} size={[0.14, 0.025, 0.025]} color="#8b9284" />
      ))}
      <Monitor position={[-0.13, 1.02, -0.3]} />
      <Box position={[-0.15, 1.03, 0.27]} size={[0.62, 0.026, 0.22]} color="#e9e8de" round />
      <Box position={[0.35, 1.03, 0.27]} size={[0.13, 0.04, 0.2]} color="#67766d" round />
      <Box position={[-0.82, 1.05, 0.18]} size={[0.27, 0.08, 0.37]} color="#759284" />
      <Box position={[-0.81, 1.1, 0.18]} size={[0.24, 0.025, 0.33]} color="#eeebda" />
      <Plant position={[0.78, 1.02, -0.3]} scale={0.37} />
      <Cylinder position={[0.53, 1.12, 0.06]} radius={0.09} height={0.19} color="#f6efdf" />
      <Chair position={[-0.1, 0, 1]} color="#586e62" />
    </group>
  );
}
function Person({
  position,
  rotation = 0,
  employee,
  seated = false,
  animate = false,
}: {
  position: V3;
  rotation?: number;
  employee: Employee;
  seated?: boolean;
  animate?: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const skin = ['#b47f5a', '#cf9a73', '#ac8267', '#d3a37e', '#b67c60', '#cca885'][employee.avatar % 6];
  const hair = ['#352922', '#3d3027', '#28302f', '#5c4834', '#59392f', '#695541'][employee.avatar % 6];
  const shirt = ['#e7dfcb', '#4a6256', '#668798', '#e1d7bd', '#a78472', '#8b9a80'][employee.avatar % 6];
  useFrame(({ clock }) => {
    if (group.current && animate)
      group.current.rotation.y = rotation + Math.sin(clock.elapsedTime * 0.55 + employee.avatar) * 0.11;
  });
  return (
    <group position={position} rotation={[0, rotation, 0]} ref={group}>
      <Box position={[0, seated ? 1.05 : 1.07, 0]} size={[0.45, 0.57, 0.27]} color={shirt} round />
      <Cylinder position={[0, 1.43, 0]} radius={0.07} height={0.2} color={skin} />
      <mesh position={[0, 1.62, 0]} castShadow>
        <sphereGeometry args={[0.205, 20, 16]} />
        <meshStandardMaterial color={skin} roughness={0.9} />
      </mesh>
      <mesh position={[0, 1.71, 0.025]} scale={[1, 0.72, 1]} castShadow>
        <sphereGeometry args={[0.213, 20, 16]} />
        <meshStandardMaterial color={hair} />
      </mesh>
      {[0, 2, 4].includes(employee.avatar) && (
        <Box position={[0, 1.5, 0.12]} size={[0.34, 0.32, 0.16]} color={hair} round />
      )}
      {[-1, 1].map((i) => (
        <group key={i}>
          <Box
            position={[i * 0.28, 1.05, seated ? -0.12 : 0]}
            size={[0.14, 0.43, 0.15]}
            rotation={[seated ? -0.65 : 0.1, 0, i * 0.13]}
            color={shirt}
            round
          />
          <Box
            position={[i * 0.28, seated ? 0.96 : 0.81, seated ? -0.35 : -0.03]}
            size={[0.12, seated ? 0.14 : 0.24, seated ? 0.35 : 0.13]}
            color={skin}
            round
          />
          <Box
            position={[i * 0.12, seated ? 0.68 : 0.4, seated ? -0.16 : 0]}
            size={[0.17, seated ? 0.18 : 0.67, seated ? 0.57 : 0.19]}
            color="#344745"
            round
          />
          {seated && (
            <Box position={[i * 0.12, 0.38, -0.38]} size={[0.17, 0.58, 0.17]} color="#344745" round />
          )}
          <Box
            position={[i * 0.12, 0.09, seated ? -0.46 : -0.08]}
            size={[0.2, 0.12, 0.34]}
            color="#f0e9d9"
            round
          />
        </group>
      ))}
    </group>
  );
}
function Lounge() {
  return (
    <group position={[-5.3, 0, -2.5]}>
      <Box position={[0, 0.015, 0.45]} size={[3.1, 0.03, 3.45]} color="#92a397" />
      <Box position={[-0.65, 0.45, -0.55]} size={[1.1, 0.55, 2.75]} color="#385b48" round />
      <Box position={[-1.18, 0.8, -0.55]} size={[0.26, 1, 2.83]} color="#41634e" round />
      <Box position={[-0.62, 0.65, -1.87]} size={[1.15, 0.78, 0.25]} color="#365740" round />
      <Box position={[-0.62, 0.65, 0.76]} size={[1.15, 0.78, 0.25]} color="#365740" round />
      {[-1.26, -0.54, 0.19].map((z) => (
        <Box key={z} position={[-0.58, 0.77, z]} size={[0.87, 0.13, 0.68]} color="#54775c" round />
      ))}
      <Box
        position={[-0.88, 0.98, -1.23]}
        size={[0.23, 0.47, 0.49]}
        color="#dcd5b9"
        rotation={[0.1, 0, -0.2]}
        round
      />
      <Cylinder position={[0.66, 0.53, -0.1]} radius={0.68} height={0.12} color="#aa7f51" />
      <Cylinder position={[0.66, 0.26, -0.1]} radius={0.14} height={0.5} color="#b58c60" />
      <Cylinder position={[0.82, 0.65, -0.03]} radius={0.09} height={0.15} color="#f1ead8" />
      <Box position={[0.45, 0.61, -0.21]} size={[0.36, 0.035, 0.43]} color="#d8d1b5" rotation={[0, 0.3, 0]} />
      <Plant position={[-0.85, 0, 1.45]} scale={1.25} />
    </group>
  );
}
function Kitchen() {
  return (
    <group position={[-5.6, 0, 2.75]}>
      <Box position={[0, 0.015, 0.4]} size={[3, 0.03, 3.1]} color="#d3c6aa" />
      <Box position={[-0.86, 0.57, 0]} size={[0.83, 1.13, 2.8]} color="#dcded0" />
      <Box position={[-0.86, 1.16, 0]} size={[0.9, 0.12, 2.9]} color="#f3eddf" />
      {[-0.85, 0, 0.85].map((z) => (
        <Box key={z} position={[-0.43, 0.85, z]} size={[0.03, 0.06, 0.21]} color="#8e9588" />
      ))}
      <Box position={[-0.8, 1.47, -0.77]} size={[0.45, 0.5, 0.54]} color="#414e46" round />
      <Box position={[-0.56, 1.52, -0.77]} size={[0.02, 0.23, 0.32]} color="#a9b2a7" />
      <Cylinder position={[-0.8, 1.35, 0.15]} radius={0.19} height={0.24} color="#d6d7bf" />
      <Box position={[0.55, 1.08, 0.27]} size={[0.95, 0.1, 2.1]} color="#dfc7a0" round />
      {[-0.45, 1].map((z) => (
        <Box key={z} position={[0.55, 0.52, z]} size={[0.65, 1.03, 0.08]} color="#d6d9cb" />
      ))}
      {[-0.35, 0.68].map((z) => (
        <group key={z}>
          <Cylinder position={[1.25, 0.71, z]} radius={0.28} height={0.12} color="#677c6a" />
          {[-1, 1].map((i) => (
            <Box key={i} position={[1.25 + i * 0.16, 0.35, z]} size={[0.045, 0.65, 0.3]} color="#a38c66" />
          ))}
        </group>
      ))}
      <Plant position={[0.55, 1.12, -0.36]} scale={0.38} />
    </group>
  );
}
function Whiteboard() {
  return (
    <group position={[6.45, 0, 1.65]} rotation={[0, -Math.PI / 2, 0]}>
      <Box position={[0, 1.76, 0]} size={[1.55, 1.2, 0.09]} color="#fbf8ee" />
      {[-0.65, 0.65].map((x) => (
        <Box key={x} position={[x, 0.8, 0]} size={[0.04, 1.6, 0.04]} color="#839084" />
      ))}
      {[-0.4, 0, 0.4].map((x, i) => (
        <Box
          key={x}
          position={[x, 1.79 + (i % 2) * 0.18, -0.056]}
          size={[0.26, 0.25, 0.012]}
          color={['#d5bd79', '#b2c6ad', '#ceaa90'][i]}
        />
      ))}
      <Box position={[0, 1.17, -0.06]} size={[1.63, 0.05, 0.14]} color="#849387" />
    </group>
  );
}
function Room() {
  const planks = useMemo(() => {
    const result: { x: number; z: number; width: number; color: string }[] = [];
    for (let row = 0; row < 38; row++) {
      let x = -7.98;
      while (x < 7.98) {
        const width = Math.min(x === -7.98 ? 1.2 + (row % 3) * 0.7 : 2.6, 7.98 - x);
        result.push({
          x: x + width / 2,
          z: -5.72 + row * 0.306,
          width,
          color: ['#c6aa80', '#c9ae85', '#cdb48c', '#c8ab80', '#cbb189'][(result.length * 3 + row) % 5],
        });
        x += width;
      }
    }
    return result;
  }, []);
  return (
    <>
      <Box position={[0, -0.22, 0]} size={[16.2, 0.43, 11.9]} color="#ded6c4" round />
      {planks.map((p, i) => (
        <Box key={i} position={[p.x, 0.003, p.z]} size={[p.width - 0.012, 0.018, 0.294]} color={p.color} />
      ))}
      <Box position={[0, 0.43, -5.8]} size={[16.2, 0.86, 0.19]} color="#e7e5d9" />
      <Box position={[0, 3.3, -5.8]} size={[16.2, 0.23, 0.2]} color="#eceade" />
      {[-7.8, -5.2, -2.6, 0, 2.6, 5.2, 7.8].map((x) => (
        <group key={x}>
          <Box position={[x, 2.05, -5.8]} size={[0.13, 2.5, 0.18]} color="#e7e8df" />
          {x < 7.8 && (
            <>
              <Box
                position={[x + 1.3, 2.08, -5.83]}
                size={[2.45, 2.18, 0.035]}
                color="#cddfdc"
                opacity={0.54}
              />
              <Box position={[x + 1.3, 1.1, -5.65]} size={[2.48, 0.12, 0.34]} color="#efebde" />
              <Box position={[x + 1.3, 2.05, -5.78]} size={[2.48, 0.055, 0.08]} color="#b8c4bb" />
            </>
          )}
        </group>
      ))}
      <Box position={[-8, 1.55, 0]} size={[0.18, 3.1, 11.8]} color="#e4e2d4" />
      <Box position={[-7.88, 0.17, 0]} size={[0.08, 0.3, 11.5]} color="#f6f2e7" />
      <Box position={[-7.85, 2.08, -3]} size={[0.045, 1.38, 1.08]} color="#938673" />
      <Box position={[-7.815, 2.08, -3]} size={[0.025, 1.23, 0.93]} color="#f1ecd9" />
      <Box position={[-7.79, 2.08, -3]} size={[0.025, 0.72, 0.38]} color="#789075" />
      {[-6.8, -3.5, 0.7, 4.5, 7].map((x, i) => (
        <Plant
          key={x}
          position={[x, i % 2 ? 1.17 : 0, -5.22]}
          scale={i % 2 ? 0.6 : 1.25}
          pot={i % 2 ? '#c1a88a' : '#e9e3d2'}
        />
      ))}
      <Lounge />
      <Kitchen />
      <Desk position={[-1.75, 0, -3.4]} />
      <Desk position={[3, 0, -3.4]} />
      <Desk position={[-1.75, 0, 0.55]} />
      <Desk position={[3, 0, 0.55]} />
      <Box position={[0.55, 0.48, -3.35]} size={[0.65, 0.96, 1.15]} color="#dddfd1" />
      <Plant position={[0.55, 0.98, -3.38]} scale={0.7} />
      <Box position={[-2.95, 0.55, -0.4]} size={[0.62, 1.1, 0.64]} color="#8c9a86" />
      {[0.27, 0.6, 0.93].map((y) => (
        <Box key={y} position={[-2.95, y, -0.065]} size={[0.18, 0.035, 0.024]} color="#e2dfca" />
      ))}
      <Plant position={[-2.95, 1.13, -0.4]} scale={0.42} />
      <Plant position={[6.6, 0, -3.9]} scale={1.8} />
      <Plant position={[6.5, 0, 4.3]} scale={1.4} />
      <Box position={[2.65, 0.022, 3.95]} size={[6.2, 0.035, 2.95]} color="#a6afa0" />
      <mesh position={[2.6, 1.02, 3.86]} scale={[1.6, 1, 0.78]} castShadow receiveShadow>
        <cylinderGeometry args={[1, 1, 0.13, 64]} />
        <meshStandardMaterial color="#c7ab7c" roughness={0.6} />
      </mesh>
      {[-0.8, 0.8].map((x) => (
        <Cylinder key={x} position={[2.6 + x, 0.5, 3.86]} radius={0.16} height={0.95} color="#a38961" />
      ))}
      <Chair position={[1.65, 0, 4.97]} />
      <Chair position={[3.4, 0, 4.97]} />
      <Chair position={[2.6, 0, 2.75]} rotation={Math.PI} />
      <Box position={[2.1, 1.11, 3.9]} size={[0.54, 0.03, 0.43]} color="#f2eedf" rotation={[0, 0.2, 0]} />
      <Box position={[3.03, 1.11, 3.85]} size={[0.5, 0.025, 0.4]} color="#748d7e" rotation={[0, -0.15, 0]} />
      <Cylinder position={[2.6, 1.19, 3.65]} radius={0.1} height={0.24} color="#ebe2cc" />
      {/* Low glass divider keeps the workspace legible from the fixed camera. */}
      <Box position={[-0.9, 0.8, 3.95]} size={[0.055, 1.5, 3]} color="#c6dcd4" opacity={0.19} />
      {[2.45, 5.45].map((z) => (
        <Box key={z} position={[-0.9, 0.8, z]} size={[0.055, 1.6, 0.055]} color="#789084" />
      ))}
      <Box position={[-0.9, 1.6, 3.95]} size={[0.06, 0.05, 3.05]} color="#82988b" />
      <Whiteboard />
      <Plant position={[-2.2, 0, 4.7]} scale={1.15} />
      <Box position={[-4.8, 0.03, 5.18]} size={[1.65, 0.04, 0.83]} color="#788b6c" />
    </>
  );
}
const positions: { position: V3; label: V3; rotation: number; seated: boolean }[] = [
  { position: [-1.85, 0, -2.4], label: [-1.75, 2.3, -3.45], rotation: 0, seated: true },
  { position: [2.9, 0, -2.4], label: [3, 2.3, -3.45], rotation: 0, seated: true },
  { position: [-1.85, 0, 1.55], label: [-1.75, 2.1, 0.3], rotation: 0, seated: true },
  { position: [2.9, 0, 1.55], label: [3, 2.1, 0.3], rotation: 0, seated: true },
  { position: [5.5, 0, 1.75], label: [5.6, 2.4, 1.7], rotation: -Math.PI / 2, seated: false },
  { position: [1.65, 0, 4.97], label: [1.3, 2.6, 4.8], rotation: 0, seated: true },
];
function EmployeeActor({
  employee,
  index,
  animate,
  demo,
  onSelect,
  labels,
}: {
  employee: Employee;
  index: number;
  animate: boolean;
  demo: boolean;
  onSelect: (e: Employee) => void;
  labels: boolean;
}) {
  const defaults = positions[index % positions.length];
  const desk =
    index < 6
      ? defaults.position
      : ([-0.1 + (index % 3) * 0.8, 0, -0.4 + Math.floor((index - 6) / 3) * 1.1] as V3);
  const location = employee.sessionId ? employee.location : demo ? employee.location : 'desk';
  const destinations: Record<Employee['location'], V3> = {
    desk,
    library: [-2.2, 0, -0.3],
    board: [5.55, 0, 1.8],
    meeting: [2.6, 0, 2.75],
  };
  const target = destinations[location];
  const root = useRef<THREE.Group>(null);
  const [walking, setWalking] = useState(false);
  const wasWalking = useRef(false);
  useFrame(({ clock }, delta) => {
    if (!root.current) return;
    let goal = target;
    // This route is an explicitly labeled sample animation. Real employees only move when a recorded location changes.
    if (demo && !employee.sessionId && index === 2 && animate) {
      const phase = clock.elapsedTime % 36;
      goal = phase < 13 ? desk : phase < 26 ? [-2.2, 0, -0.3] : desk;
    }
    const current = root.current.position;
    const dx = goal[0] - current.x,
      dz = goal[2] - current.z,
      distance = Math.hypot(dx, dz);
    const moving = animate && distance > 0.035;
    if (moving) {
      const step = Math.min(distance, Math.min(delta, 0.08) * 1.2);
      current.x += (dx / distance) * step;
      current.z += (dz / distance) * step;
      current.y = Math.abs(Math.sin(clock.elapsedTime * 8)) * 0.035;
      root.current.rotation.y = Math.atan2(-dx, -dz);
    } else {
      current.set(...goal);
      root.current.rotation.y =
        location === 'board'
          ? -Math.PI / 2
          : location === 'library'
            ? Math.PI / 2
            : location === 'meeting'
              ? Math.PI
              : defaults.rotation;
    }
    if (moving !== wasWalking.current) {
      wasWalking.current = moving;
      setWalking(moving);
    }
  });
  const seated = !walking && (location === 'desk' ? index < 6 && defaults.seated : location === 'meeting');
  return (
    <group ref={root} position={target}>
      <group
        onClick={(event) => {
          event.stopPropagation();
          onSelect(employee);
        }}
        onPointerOver={() => {
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          document.body.style.cursor = '';
        }}
      >
        <Person
          position={[0, 0, 0]}
          employee={employee}
          seated={seated}
          animate={animate && (demo || employee.status === 'working')}
        />
      </group>
      {labels && index < 4 && (
        <Html position={[0, 2.5, -0.6]} center zIndexRange={[10, 1]}>
          <button className="office-name" onClick={() => onSelect(employee)}>
            <span className={`person-dot ${employee.status === 'review' ? 'amber' : ''}`} />
            <strong>{employee.name}</strong>
            <span className="office-role">{employee.jobTitle.split(' ')[0]}</span>
            <small>
              {employee.status === 'review'
                ? 'Ready for your review'
                : employee.sessionId
                  ? employee.activity
                  : demo && walking
                    ? 'Sample · heading to the files'
                    : 'Ready when you are'}
            </small>
          </button>
        </Html>
      )}
    </group>
  );
}
export default function OfficeScene({
  employees,
  animate,
  demo,
  onSelect,
  zoom,
  labels,
}: {
  employees: Employee[];
  animate: boolean;
  demo: boolean;
  onSelect: (e: Employee) => void;
  zoom: number;
  labels: boolean;
}) {
  return (
    <Canvas
      orthographic
      shadows
      dpr={[1, 1.6]}
      camera={{ position: [15, 20, 21], zoom: 40, near: 0.1, far: 100 }}
      gl={{ antialias: true, alpha: true }}
      aria-label="Interactive 3D office. Select an employee to see their work."
    >
      <Suspense fallback={null}>
        <ambientLight intensity={0.65} />
        <hemisphereLight args={['#f9f6eb', '#a7ad97', 0.9]} />
        <directionalLight
          position={[-5, 16, -7]}
          intensity={2.1}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-15}
          shadow-camera-right={15}
          shadow-camera-top={15}
          shadow-camera-bottom={-15}
          shadow-bias={-0.0005}
          shadow-normalBias={0.04}
        />
        <group position={[0, -0.5, 0]}>
          <Room />
          {employees.map((employee, index) => (
            <EmployeeActor
              key={employee.id}
              employee={employee}
              index={index}
              animate={animate}
              demo={demo}
              onSelect={onSelect}
              labels={labels}
            />
          ))}
        </group>
        <CameraRig zoom={zoom} />
        <OrbitControls enablePan={false} enableZoom={false} enableRotate={false} target={[0, 0, 0]} />
      </Suspense>
    </Canvas>
  );
}
function CameraRig({ zoom }: { zoom: number }) {
  useFrame(({ camera, size }) => {
    const next = Math.min(size.width / 23.5, size.height / 18.5) * zoom;
    if (Math.abs(camera.zoom - next) > 0.001) {
      camera.zoom = next;
      camera.updateProjectionMatrix();
    }
  });
  return null;
}
