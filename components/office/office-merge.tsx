'use client';

import { useThree } from '@react-three/fiber';
import { useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SHADOW_MIN } from './office-primitives';

/**
 * The office is drawn from a few hundred little boxes, and every one of them is
 * a draw call — twice over, because almost all of them cast a shadow. A room is
 * also completely static: once it is built, nothing in it moves.
 *
 * `Static` takes that as licence. It lets React build the subtree as written,
 * then merges every plain opaque surface in it into one mesh per material
 * family, with each surface's colour baked into its vertices, and stops drawing
 * the originals. A room of six hundred boxes becomes a dozen.
 *
 * What it leaves alone, because merging would change how it looks: anything
 * transparent, anything that glows, sprites, lines, and instanced meshes. Those
 * stay exactly where they were and keep being drawn.
 *
 * Clickable props are left whole: `Pickable` marks itself interactive and the
 * merge walks around it. A prop that is itself made of dozens of surfaces can
 * put its own `Static` inside its `Pickable`, where the merged copy inherits the
 * click.
 *
 * The one rule for callers: `revision` must change whenever the subtree's
 * geometry does, because that is when the merge is redone.
 */
export function Static({ children, revision }: { children: ReactNode; revision: string | number }) {
  const source = useRef<THREE.Group>(null);
  const output = useRef<THREE.Group>(null);
  const { invalidate } = useThree();

  useLayoutEffect(() => {
    const from = source.current;
    const to = output.current;
    if (!from || !to) return;
    from.updateMatrixWorld(true);
    const { meshes, hidden } = mergeStatic(from);
    for (const mesh of meshes) to.add(mesh);
    for (const original of hidden) original.visible = false;
    invalidate();
    return () => {
      for (const original of hidden) original.visible = true;
      for (const mesh of meshes) {
        to.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      invalidate();
    };
  }, [revision, invalidate]);

  return (
    <>
      <group ref={source}>{children}</group>
      <group ref={output} />
    </>
  );
}

type PlainMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;

/** A surface only merges if the merged copy would look the same as the original. */
function mergeable(mesh: THREE.Mesh): mesh is PlainMesh {
  const material = mesh.material;
  if ((mesh as THREE.InstancedMesh).isInstancedMesh) return false;
  if (Array.isArray(material) || !(material instanceof THREE.MeshStandardMaterial)) return false;
  return (
    !material.transparent &&
    material.opacity === 1 &&
    material.emissive.getHex() === 0 &&
    material.side === THREE.FrontSide &&
    Boolean(mesh.geometry.attributes.position) &&
    Boolean(mesh.geometry.attributes.normal)
  );
}

/**
 * Surfaces that share a texture and a finish can share a mesh, because the only
 * thing left telling them apart is colour, and colour moves into the vertices.
 */
function familyOf(material: THREE.MeshStandardMaterial): string {
  return [
    material.map?.uuid ?? 'plain',
    material.roughness.toFixed(2),
    material.metalness.toFixed(2),
    material.flatShading ? 'flat' : 'smooth',
  ].join('|');
}

function mergeStatic(root: THREE.Group): { meshes: PlainMesh[]; hidden: THREE.Mesh[] } {
  type Family = {
    material: THREE.MeshStandardMaterial;
    parts: THREE.BufferGeometry[];
    sources: THREE.Mesh[];
  };
  const families = new Map<string, Family>();
  const toRoot = root.matrixWorld.clone().invert();
  const local = new THREE.Matrix4();
  const size = new THREE.Vector3();

  const walk = (object: THREE.Object3D) => {
    if (!object.visible) return;
    // Whatever a click has to land on stays exactly where React put it.
    if (object !== root && object.userData.interactive === true) return;
    for (const child of object.children) walk(child);
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mergeable(mesh)) return;
    const material = mesh.material;
    const key = familyOf(material);
    const family = families.get(key) ?? { material, parts: [], sources: [] };
    families.set(key, family);

    const part = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    part.applyMatrix4(local.multiplyMatrices(toRoot, mesh.matrixWorld));
    paint(part, material.color);
    // Merging needs one attribute set; a surface with no texture still needs a UV.
    if (!part.attributes.uv)
      part.setAttribute(
        'uv',
        new THREE.BufferAttribute(new Float32Array(part.attributes.position.count * 2), 2),
      );
    keepOnly(part, ['position', 'normal', 'uv', 'color']);
    family.parts.push(part);
    family.sources.push(mesh);
  };
  walk(root);

  const meshes: PlainMesh[] = [];
  const hidden: THREE.Mesh[] = [];
  for (const { material, parts, sources } of families.values()) {
    const geometry = mergeGeometries(parts, false);
    for (const part of parts) part.dispose();
    // A family that would not merge keeps being drawn as it was.
    if (!geometry) continue;
    hidden.push(...sources);
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        map: material.map,
        roughness: material.roughness,
        metalness: material.metalness,
        flatShading: material.flatShading,
        vertexColors: true,
      }),
    );
    // The same rule the loose surfaces follow: a shadow smaller than a smudge is
    // not worth drawing the object twice for. A merged room clears it easily; a
    // merged pair of spectacles does not.
    geometry.computeBoundingBox();
    const extent = geometry.boundingBox?.getSize(size) ?? size.set(0, 0, 0);
    mesh.castShadow = Math.max(extent.x, extent.y, extent.z) >= SHADOW_MIN;
    mesh.receiveShadow = true;
    // A merged room is one object the size of the room; culling it is never right.
    mesh.frustumCulled = false;
    meshes.push(mesh);
  }
  return { meshes, hidden };
}

/** Writes one colour across every vertex, which is what lets surfaces share a material. */
function paint(geometry: THREE.BufferGeometry, color: THREE.Color) {
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

/** Geometries only merge when they carry the same attributes, so drop the extras. */
function keepOnly(geometry: THREE.BufferGeometry, names: string[]) {
  for (const name of Object.keys(geometry.attributes))
    if (!names.includes(name)) geometry.deleteAttribute(name);
  geometry.morphAttributes = {};
}
