'use client';

import { useLayoutEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useOfficePan } from './office-pan';
import { FileCabinet, OfficeSpeakers } from './office-furniture';
import { EmployeeAvatar, type Activity } from './office-people';
import { SurfaceContext, desks, speakerPosition, useSurfaceTextures, type Point } from './office-primitives';
import { Architecture } from './office-room';

/** The one employee shape this component understands. */
export type OfficeEmployee = {
  id: string;
  name: string;
  role: string;
  status: string;
  color?: string;
};

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

const ACTIVE_STATUSES = new Set(['working', 'review', 'ready']);

export function isActiveEmployee(employee: OfficeEmployee): boolean {
  return ACTIVE_STATUSES.has(employee.status.trim().toLowerCase());
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
