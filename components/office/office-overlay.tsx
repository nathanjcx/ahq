'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { bubbleSide, layoutLabels, type LabelInput } from './office-labels';

/** One figure's overlay: where its head is, and the two elements that hang off it. */
export type OverlayEntry = {
  id: string;
  /** From `labelPriority`. Decides who keeps their pill when the room is crowded. */
  priority: number;
  /** Head position in world space, written by the figure every frame. */
  anchor: THREE.Vector3;
  pill: HTMLElement | null;
  bubble: HTMLElement | null;
  /** Hover, focus or selection keeps a pill on screen even when it is covered. */
  forced: boolean;
};

export type Overlay = {
  register: (id: string) => OverlayEntry;
  release: (id: string) => void;
};

const OverlayContext = createContext<Overlay | null>(null);

export function useOverlayEntry(id: string): OverlayEntry | null {
  const overlay = useContext(OverlayContext);
  const entry = useMemo(() => overlay?.register(id) ?? null, [overlay, id]);
  useEffect(() => () => overlay?.release(id), [overlay, id]);
  return entry;
}

/** The pass runs at 20fps; the figures themselves animate at the frame rate. */
const PASS_SECONDS = 0.05;
const projected = new THREE.Vector3();

/**
 * Keeps the office's HTML readable. Every pass it projects each figure's head to
 * screen space, runs the collision pass over the pills, and points each visible
 * bubble at whichever side of its figure has room.
 *
 * The result is written straight to the DOM, so a crowded room never re-renders
 * React at 20fps.
 */
export function OfficeOverlay({ children }: { children: ReactNode }) {
  const entries = useRef(new Map<string, OverlayEntry>());
  const { camera, size } = useThree();
  const input = useRef<LabelInput[]>([]);
  const points = useRef(new Map<string, { x: number; y: number }>());
  const rects = useRef<LabelInput[]>([]);
  const last = useRef(-1);

  const overlay = useMemo<Overlay>(
    () => ({
      register(id) {
        const existing = entries.current.get(id);
        if (existing) return existing;
        const entry: OverlayEntry = {
          id,
          priority: 0,
          anchor: new THREE.Vector3(),
          pill: null,
          bubble: null,
          forced: false,
        };
        entries.current.set(id, entry);
        return entry;
      },
      release(id) {
        entries.current.delete(id);
      },
    }),
    [],
  );

  const pass = useCallback(() => {
    const heads = points.current;
    const pills = input.current;
    const placed = rects.current;
    heads.clear();
    pills.length = 0;
    placed.length = 0;
    for (const entry of entries.current.values()) {
      projected.copy(entry.anchor).project(camera);
      const x = (projected.x * 0.5 + 0.5) * size.width;
      const y = (-projected.y * 0.5 + 0.5) * size.height;
      heads.set(entry.id, { x, y });
      const pill = entry.pill;
      if (!pill?.offsetWidth) continue;
      pills.push({
        id: entry.id,
        x,
        y,
        width: pill.offsetWidth,
        height: pill.offsetHeight,
        priority: entry.forced ? 5 : entry.priority,
      });
    }
    layoutLabels(pills).forEach((placement, index) => {
      const entry = entries.current.get(placement.id)!;
      const pill = entry.pill!;
      const hidden = placement.hidden && !entry.forced;
      pill.style.setProperty('--label-lift', `${-placement.lift}px`);
      if (hidden) pill.dataset.covered = 'true';
      else delete pill.dataset.covered;
      if (hidden) return;
      const source = pills[index];
      placed.push({ ...source, y: source.y - placement.lift });
    });
    for (const entry of entries.current.values()) {
      const bubble = entry.bubble;
      const head = heads.get(entry.id);
      if (!bubble?.offsetWidth || !head) continue;
      bubble.dataset.side = bubbleSide(
        { ...head, width: 0, height: 0 },
        { width: bubble.offsetWidth, height: bubble.offsetHeight },
        placed.filter((rect) => rect.id !== entry.id),
        size,
      );
    }
  }, [camera, size]);

  // The office runs on demand when motion is reduced, so lay the labels out
  // once the elements exist as well as on the frames that do arrive.
  useEffect(() => {
    const timer = setTimeout(pass, 0);
    return () => clearTimeout(timer);
  }, [pass]);

  useFrame((state) => {
    if (state.clock.elapsedTime - last.current < PASS_SECONDS) return;
    last.current = state.clock.elapsedTime;
    pass();
  });

  return <OverlayContext.Provider value={overlay}>{children}</OverlayContext.Provider>;
}
