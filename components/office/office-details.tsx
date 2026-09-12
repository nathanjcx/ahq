'use client';

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { Box, C, Cylinder, GlowBar, Halo, Round, type Point } from './office-primitives';

export function ArchitecturalDetails({ desks, interior }: { desks: Point[]; interior: number }) {
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
      <Halo p={[5.02, 2.6, -3.28]} size={[5.4, 1.9]} opacity={0.12 + interior * 0.5} />
      <pointLight
        position={[5.05, 2.55, -3.2]}
        color="#ffd9a0"
        intensity={2.5 + interior * 5}
        distance={9}
        decay={2}
      />
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
          <Halo p={[-0.16, 0.3, 0]} size={[1.5, 1.5]} opacity={interior * 0.5} />
          <pointLight
            position={[-0.16, 0.32, 0]}
            color="#ffdd9b"
            intensity={0.16 + interior * 2.6}
            distance={2.6}
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
        <Halo p={[-0.43, 1.9, 0]} size={[2.6, 2.6]} opacity={0.1 + interior * 0.55} />
        <pointLight
          position={[-0.43, 1.85, 0]}
          intensity={1.25 + interior * 3.4}
          color="#ffdc9e"
          distance={5.5}
          decay={2}
        />
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
export function OperationsDisplay() {
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
