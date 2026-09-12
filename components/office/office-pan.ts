import { useEffect, useRef } from 'react';
import * as THREE from 'three';

/**
 * Camera-plane displacement that survives the scene's fit, zoom, and resize
 * passes. Drag pans the cutaway; arrow keys pan while the office is focused.
 */
export function useOfficePan(
  camera: THREE.Camera,
  source: HTMLDivElement,
  invalidate: () => void,
  resetKey: number,
) {
  const offset = useRef(new THREE.Vector2());

  useEffect(() => {
    if (!(camera instanceof THREE.OrthographicCamera)) return;
    let gesture: { id: number; x: number; y: number; dragging: boolean } | null = null;
    let suppressClick = false;

    const move = (dx: number, dy: number) => {
      const rect = source.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const x = (-dx * (camera.right - camera.left)) / (camera.zoom * rect.width);
      const y = (dy * (camera.top - camera.bottom)) / (camera.zoom * rect.height);
      offset.current.x += x;
      offset.current.y += y;
      camera.translateX(x);
      camera.translateY(y);
      camera.updateMatrixWorld(true);
      invalidate();
    };
    const finish = () => {
      const previous = gesture;
      gesture = null;
      delete source.dataset.panning;
      if (previous && source.hasPointerCapture(previous.id)) source.releasePointerCapture(previous.id);
    };
    const down = (event: PointerEvent) => {
      if (!event.isPrimary || (event.button !== 0 && event.button !== 1)) return;
      suppressClick = false;
      if (
        event.target instanceof Element &&
        event.target.closest('button, a, input, select, textarea, [role="button"], [contenteditable]')
      )
        return;
      finish();
      gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, dragging: false };
      source.focus({ preventScroll: true });
      if (event.button === 1) event.preventDefault();
    };
    const drag = (event: PointerEvent) => {
      if (!gesture || gesture.id !== event.pointerId) return;
      const dx = event.clientX - gesture.x;
      const dy = event.clientY - gesture.y;
      if (!gesture.dragging && Math.hypot(dx, dy) < 5) return;
      if (!gesture.dragging) {
        gesture.dragging = true;
        suppressClick = true;
        source.dataset.panning = 'true';
        source.setPointerCapture(event.pointerId);
      }
      event.preventDefault();
      event.stopPropagation();
      move(dx, dy);
      gesture.x = event.clientX;
      gesture.y = event.clientY;
    };
    const up = (event: PointerEvent) => {
      if (gesture?.id === event.pointerId) finish();
    };
    const click = (event: MouseEvent) => {
      // R3F can dispatch a mesh click after a drag; consume that click before raycasting.
      if (!suppressClick || event.detail === 0) return;
      suppressClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const key = (event: KeyboardEvent) => {
      if (event.target !== source) return;
      const delta: Record<string, [number, number]> = {
        ArrowLeft: [-40, 0],
        ArrowRight: [40, 0],
        ArrowUp: [0, -40],
        ArrowDown: [0, 40],
      };
      if (!delta[event.key]) return;
      event.preventDefault();
      move(...delta[event.key]);
    };

    source.addEventListener('pointerdown', down, true);
    source.addEventListener('click', click, true);
    source.addEventListener('keydown', key);
    source.addEventListener('lostpointercapture', finish);
    window.addEventListener('pointermove', drag, { capture: true, passive: false });
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    window.addEventListener('blur', finish);
    return () => {
      finish();
      source.removeEventListener('pointerdown', down, true);
      source.removeEventListener('click', click, true);
      source.removeEventListener('keydown', key);
      source.removeEventListener('lostpointercapture', finish);
      window.removeEventListener('pointermove', drag, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      window.removeEventListener('blur', finish);
    };
  }, [camera, source, invalidate, resetKey]);

  return offset.current;
}
