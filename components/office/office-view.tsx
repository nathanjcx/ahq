'use client';

import { Component, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Canvas, events as createPointerEvents } from '@react-three/fiber';
import type { CanvasProps } from '@react-three/fiber';
import * as THREE from 'three';
import { OfficeScene, isActiveEmployee } from './office-scene';
import type { OfficeEmployee } from './office-scene';
import './office-view.css';

export type { OfficeEmployee } from './office-scene';

export type OfficeViewProps = {
  /** People shown in the office. Only active statuses take the floor. */
  employees: OfficeEmployee[];
  /** Called when a person or their label is clicked. */
  onSelect?: (id: string) => void;
};

const ZOOM_MIN = 0.55;
const ZOOM_MAX = 2.5;
const ZOOM_STEP = 1.18;
const ROTATE_STEP = 30;

const clampZoom = (value: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));

function detectWebGL(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

function Fallback({
  employees,
  onSelect,
}: {
  employees: OfficeEmployee[];
  onSelect?: (id: string) => void;
}) {
  const present = employees.filter(isActiveEmployee);
  return (
    <div className="office-view-fallback">
      <p>
        {present.length
          ? 'Your team is here. Select someone to see what they are working on.'
          : 'Your office is ready. Add your first employee to get started.'}
      </p>
      {present.length > 0 && (
        <ul>
          {present.map((employee) => (
            <li key={employee.id}>
              <button type="button" onClick={() => onSelect?.(employee.id)}>
                <strong>{employee.name}</strong>
                <span>{employee.role}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
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
    compute(event, state) {
      const rect = state.gl.domElement.getBoundingClientRect();
      state.pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      state.raycaster.setFromCamera(state.pointer, state.camera);
    },
    connect(target) {
      if (!target?.isConnected) {
        manager.disconnect?.();
        return;
      }
      connect?.(target);
    },
  };
};

/**
 * The Astra HQ office as a self-contained client component: the cutaway
 * architectural room from the desktop app, dressed only by the people it is
 * given. With no employees it stays a furnished, honest empty office.
 */
export default function OfficeView({ employees, onSelect }: OfficeViewProps) {
  const [eventSource, setEventSource] = useState<HTMLDivElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [angle, setAngle] = useState(0);
  const [resetKey, setResetKey] = useState(0);
  const [supported, setSupported] = useState(detectWebGL);
  const [reducedMotion, setReducedMotion] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(preference.matches);
    update();
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);

  // Trackpad pinch (ctrl/⌘ + wheel) zooms; plain wheel keeps scrolling the page.
  useEffect(() => {
    if (!eventSource) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setZoom((current) => clampZoom(current * (event.deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP)));
    };
    eventSource.addEventListener('wheel', onWheel, { passive: false });
    return () => eventSource.removeEventListener('wheel', onWheel);
  }, [eventSource]);

  useEffect(() => {
    if (supported) return;
    setSupported(detectWebGL());
  }, [supported]);

  const motion = !reducedMotion;
  const fallback = <Fallback employees={employees} onSelect={onSelect} />;

  return (
    <div
      className="office-view"
      ref={setEventSource}
      role="region"
      aria-label="Interactive 3D team office"
      aria-description="Drag to pan. Use the arrow keys when the office is focused. Hold Ctrl and scroll to zoom."
      data-office-empty={employees.length ? undefined : 'true'}
      tabIndex={0}
    >
      {employees.length === 0 && (
        <p className="office-view-note" role="status">
          Your office is ready. Add your first employee to get started.
        </p>
      )}
      <div className="office-view-controls" role="group" aria-label="Office view controls">
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => setZoom((current) => clampZoom(current / ZOOM_STEP))}
        >
          <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true">
            <circle cx="6.5" cy="6.5" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <path d="M10 10l3.4 3.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <path d="M4.2 6.5h4.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => setZoom((current) => clampZoom(current * ZOOM_STEP))}
        >
          <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true">
            <circle cx="6.5" cy="6.5" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <path d="M10 10l3.4 3.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <path d="M4.2 6.5h4.6M6.5 4.2v4.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
        <span aria-hidden="true" />
        <button
          type="button"
          aria-label="Rotate left"
          onClick={() => setAngle((current) => current - ROTATE_STEP)}
        >
          <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true">
            <path
              d="M12.2 7.5a4.7 4.7 0 1 1-1.6-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
            <path d="M10.9 1.4l-.3 2.8-2.7-.7" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Rotate right"
          onClick={() => setAngle((current) => current + ROTATE_STEP)}
        >
          <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true">
            <path
              d="M2.8 7.5a4.7 4.7 0 1 0 1.6-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
            <path d="M4.1 1.4l.3 2.8 2.7-.7" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          </svg>
        </button>
        <span aria-hidden="true" />
        <button
          type="button"
          aria-label="Reset view"
          onClick={() => {
            setZoom(1);
            setAngle(0);
            setResetKey((current) => current + 1);
          }}
        >
          <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true">
            <path
              d="M2.2 6.2V2.6m0 3.6h3.6M2.4 2.8l3.1 3.1M12.8 8.8v3.6m0-3.6H9.2m3.4 3.4L9.5 9.1"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
      <SceneBoundary fallback={fallback}>
        {eventSource && supported && (
          <Canvas
            eventSource={eventSource}
            events={safeEvents}
            orthographic
            shadows={{ type: THREE.PCFShadowMap }}
            camera={{ position: [28, 27, 28], zoom: 25, near: 0.1, far: 150 }}
            dpr={[1, 1.75]}
            frameloop={motion ? 'always' : 'demand'}
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
            <OfficeScene
              employees={employees}
              onSelect={onSelect}
              motion={motion}
              zoom={zoom}
              angle={angle}
              resetKey={resetKey}
              eventSource={eventSource}
            />
          </Canvas>
        )}
      </SceneBoundary>
      {!supported && fallback}
    </div>
  );
}
