"use client";

import { Component, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { Line, RoundedBox, useGLTF } from '@react-three/drei';
import type { Plan, MaterialDefinition } from '@/lib/plan';
import { createFurnitureInstance, disposeFurnitureInstance, furnitureModelFit } from '@/lib/realistic-furniture';
import PbrMaterial from '@/components/PbrMaterial';

export interface RealisticFurnitureProps {
  item: Plan['furniture'][number];
  material: MaterialDefinition;
  selected: boolean;
  onSelect: () => void;
}

const oak: MaterialDefinition = { id: 'wood-oak', name: '橡木', category: 'furniture', color: '#c4a77c', roughness: .72, pattern: 'wood' };
const ivory: MaterialDefinition = { id: 'linen-cream', name: '亚麻', category: 'furniture', color: '#e2d7c0', roughness: .95, pattern: 'carpet' };

class FurnitureBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/** Loading suspends the parent scene until the complete textured model is ready. */
function ImportedFurniture({ url, item, material }: { url: string; item: Plan['furniture'][number]; material: MaterialDefinition }) {
  const { scene } = useGLTF(url);
  const instance = useMemo(() => createFurnitureInstance(scene, material), [scene, material.id, material.color, material.roughness]);
  const fit = useMemo(() => furnitureModelFit(instance, item.width, item.height, item.depth), [instance, item.width, item.height, item.depth]);
  useEffect(() => () => disposeFurnitureInstance(instance), [instance]);
  return <group name={`asset-${item.id}`} userData={{ sourceAsset: url, furnitureId: item.id }} scale={fit.scale} dispose={null}><group position={fit.offset}><primitive object={instance} dispose={null} /></group></group>;
}

function Cushion({ position, size, material, radius = .04, rotation }: { position: [number, number, number]; size: [number, number, number]; material: MaterialDefinition; radius?: number; rotation?: [number, number, number] }) {
  return <RoundedBox position={position} rotation={rotation} args={size} radius={Math.min(radius, ...size.map(value => value * .22))} smoothness={4} castShadow receiveShadow><PbrMaterial material={material} kind={material.pattern === 'wood' ? 'wood' : material.pattern === 'stone' || material.pattern === 'tile' ? 'stone' : 'fabric'} repeat={[Math.max(.4, size[0]), Math.max(.4, size[2])]} /></RoundedBox>;
}

function Leg({ x, z, height, radius = .025, dark = false }: { x: number; z: number; height: number; radius?: number; dark?: boolean }) {
  return <mesh position={[x, height / 2, z]} castShadow receiveShadow><cylinderGeometry args={[radius * .7, radius, height, 20]} />{dark ? <meshPhysicalMaterial color="#4e4740" roughness={.3} metalness={.75} /> : <PbrMaterial material={oak} kind="wood" />}</mesh>;
}

/** Procedural items retain editable dimensions and have rounded edges, seams and real PBR maps. */
function DetailedFurniture({ item, material }: Pick<RealisticFurnitureProps, 'item' | 'material'>) {
  const w = item.width, d = item.depth, h = item.height;
  if (item.kind === 'table') {
    const top = Math.min(.065, h * .13), legHeight = Math.max(.04, h - top);
    return <>
      <Cushion position={[0, h - top / 2, 0]} size={[w, top, d]} radius={.065} material={material} />
      <Cushion position={[0, h - top - Math.min(.08, h * .16) / 2, 0]} size={[w * .84, Math.min(.08, h * .16), d * .8]} radius={.018} material={oak} />
      {[-1, 1].flatMap(x => [-1, 1].map(z => <Leg key={`${x}-${z}`} x={x * w * .36} z={z * d * .32} height={legHeight} radius={Math.min(.035, w * .035, d * .045)} />))}
    </>;
  }
  if (item.kind === 'cabinet') {
    const plinth = Math.min(.12, h * .1), shell = Math.min(.045, w * .05, d * .08), doorGap = Math.min(.012, w * .015), doors = Math.max(2, Math.min(5, Math.round(w / .55)));
    return <>
      <Cushion position={[0, plinth / 2, 0]} size={[w * .92, plinth, d * .88]} radius={.015} material={{ ...oak, color: '#514b40' }} />
      <Cushion position={[0, (h + plinth) / 2, 0]} size={[w, h - plinth, d * .95]} radius={.018} material={material} />
      <Cushion position={[0, h - shell / 2, 0]} size={[w + .006, shell, d]} radius={.014} material={material} />
      {Array.from({ length: doors }, (_, index) => {
        const doorW = w / doors - doorGap, x = -w / 2 + (index + .5) * w / doors;
        return <group key={index}>
          <Cushion position={[x, (h + plinth) / 2, d / 2 - shell / 2]} size={[doorW, h - plinth - doorGap * 2, shell]} radius={.011} material={material} />
          <mesh position={[x + doorW * .3, plinth + (h - plinth) * .57, d / 2 + .014]} castShadow><capsuleGeometry args={[.007, Math.min(.1, h * .12), 4, 12]} /><meshPhysicalMaterial color="#7c6b48" metalness={.85} roughness={.28} /></mesh>
        </group>;
      })}
    </>;
  }
  if (item.kind === 'bed') {
    const foot = h * .12, base = h * .25, mattress = h * .3, deck = foot + base, mattressTop = deck + mattress;
    return <>
      {[-1, 1].flatMap(x => [-1, 1].map(z => <Leg key={`${x}-${z}`} x={x * w * .4} z={z * d * .4} height={foot} radius={.026} dark />))}
      <Cushion position={[0, foot + base / 2, .01]} size={[w, base, d * .98]} radius={.05} material={oak} />
      <Cushion position={[0, deck + mattress / 2, .02]} size={[w * .98, mattress, d * .94]} radius={.065} material={{ ...ivory, color: '#efece3' }} />
      <Cushion position={[0, h * .52, -d * .47]} size={[w, h * .96, d * .065]} radius={.045} material={material} />
      <Cushion position={[0, mattressTop + h * .035, d * .1]} size={[w * .985, h * .07, d * .65]} radius={.04} material={material} />
      <Cushion position={[0, deck + mattress * .3, d * .465]} size={[w * .99, mattress * .8, d * .035]} radius={.02} material={material} />
      {[-1, 1].map(side => <Cushion key={side} position={[side * w * .235, mattressTop + h * .075, -d * .3]} rotation={[.06, side * .035, side * .04]} size={[w * .4, h * .15, d * .225]} radius={.06} material={{ ...ivory, color: '#f1eee6' }} />)}
      <Cushion position={[0, mattressTop + h * .08, d * .3]} size={[w * .985, h * .025, d * .21]} radius={.015} material={{ ...material, color: '#a89a86' }} />
    </>;
  }
  if (item.kind === 'plant') {
    const potH = h * .24, potR = Math.min(w, d) * .34, top = Math.min(w, d) * .09;
    return <>
      <mesh position={[0, potH / 2, 0]} castShadow receiveShadow><cylinderGeometry args={[potR, potR * .72, potH, 48, 1, true]} /><meshPhysicalMaterial color="#aaa18d" roughness={.83} clearcoat={.04} /></mesh>
      <mesh position={[0, potH * .97, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow><circleGeometry args={[potR * .95, 40]} /><meshStandardMaterial color="#40392b" roughness={1} /></mesh>
      <mesh position={[0, potH, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow><torusGeometry args={[potR * .98, top * .18, 12, 48]} /><meshStandardMaterial color="#b7ad98" roughness={.84} /></mesh>
      {Array.from({ length: 13 }, (_, index) => {
        const angle = index * 2.39996, y = potH + (h - potH) * (.24 + index % 5 * .145), length = (h - potH) * (.22 + index % 3 * .03);
        const radial = Math.min(w, d) * (.16 + index % 3 * .035);
        return <group key={index} position={[0, y, 0]} rotation={[0, angle, .1]}>
          <mesh position={[radial * .4, -length * .15, 0]} rotation={[0, 0, -.8]} castShadow><cylinderGeometry args={[.005, .008, radial * 1.5, 8]} /><meshStandardMaterial color="#556344" roughness={1} /></mesh>
          <mesh position={[radial, length * .1, 0]} rotation={[.2 + index % 2 * .35, 0, -.7]} scale={[Math.min(w, d) * .11, length, Math.min(w, d) * .025]} castShadow receiveShadow><sphereGeometry args={[1, 16, 14]} /><meshPhysicalMaterial color={index % 2 ? '#4f6842' : '#73845a'} roughness={.68} clearcoat={.2} sheen={.15} /></mesh>
        </group>;
      })}
    </>;
  }
  // This path is only used when a GLB fails to load, never while it is loading.
  if (item.kind === 'chair') return <>
    <Cushion position={[0, h * .45, .015]} size={[w * .94, h * .13, d * .82]} radius={.06} material={material} />
    <Cushion position={[0, h * .77, -d * .39]} rotation={[-.08, 0, 0]} size={[w * .94, h * .46, d * .13]} radius={.06} material={material} />
    {[-1, 1].flatMap(x => [-1, 1].map(z => <Leg key={`${x}-${z}`} x={x * w * .34} z={z * d * .31} height={h * .4} radius={.022} />))}
  </>;
  return <>
    <Cushion position={[0, h * .21, 0]} size={[w, h * .25, d * .97]} radius={.05} material={oak} />
    <Cushion position={[0, h * .67, -d * .37]} size={[w * .97, h * .63, d * .22]} radius={.08} material={material} />
    {[-1, 1].map(side => <Cushion key={side} position={[side * w * .45, h * .46, .01]} size={[w * .1, h * .5, d * .96]} radius={.06} material={material} />)}
    {[-1, 0, 1].map(side => <Cushion key={side} position={[side * w * .27, h * .42, d * .05]} size={[w * .26, h * .2, d * .64]} radius={.06} material={material} />)}
    {[-1, 1].flatMap(x => [-1, 1].map(z => <Leg key={`${x}-${z}`} x={x * w * .39} z={z * d * .34} height={h * .13} radius={.024} dark />))}
  </>;
}

export default function RealisticFurniture({ item, material, selected, onSelect }: RealisticFurnitureProps) {
  const url = item.kind === 'sofa' ? '/assets/realistic/sofa.glb' : item.kind === 'chair' ? '/assets/realistic/chair.glb' : null;
  const w = item.width, d = item.depth;
  return <group name={`furniture-${item.id}`} userData={{ furnitureId: item.id, kind: item.kind }} position={[item.x, 0, item.y]} rotation={[0, -item.rotation * Math.PI / 180, 0]} onClick={event => { event.stopPropagation(); onSelect(); }}>
    {url ? <FurnitureBoundary key={url} fallback={<DetailedFurniture item={item} material={material} />}><ImportedFurniture url={url} item={item} material={material} /></FurnitureBoundary> : <DetailedFurniture item={item} material={material} />}
    {selected && <Line points={[[-w / 2 - .035, .022, -d / 2 - .035], [w / 2 + .035, .022, -d / 2 - .035], [w / 2 + .035, .022, d / 2 + .035], [-w / 2 - .035, .022, d / 2 + .035], [-w / 2 - .035, .022, -d / 2 - .035]]} color="#bc654c" lineWidth={1.5} />}
  </group>;
}
