"use client";

import type { Plan } from '@/lib/plan';
import { pointInPolygon, roomArea, roomLabelPoint, roomPolygon } from '@/lib/layout';

export interface InteriorFixture {
  id: string;
  roomId?: string;
  x: number;
  y: number;
  z: number;
  ceiling: number;
  intensity: number;
  distance: number;
  source: 'plan' | 'preview';
  lightOn?: boolean;
}

export function fixtureLightLevel(fixture: Pick<InteriorFixture, 'lightOn'>, globalLevel: number, manualIntensity: number) {
  return Math.max(0, Math.min(1, fixture.lightOn === undefined ? globalLevel : fixture.lightOn ? manualIntensity : 0));
}

/** Use authored light points first. Preview fixtures never change the saved plan. */
export function collectInteriorFixtures(plan: Plan, limit: number): InteriorFixture[] {
  const ceiling = Math.max(1.8, plan.ceilingHeight ?? 2.8);
  const authored = plan.nodes.filter(node => node.kind === 'light').map(node => {
    const room = plan.rooms.find(item => pointInPolygon(node, roomPolygon(item)));
    const area = room ? roomArea(room) : 16;
    return {
      id: node.id, roomId: room?.id, x: node.x, z: node.y,
      y: Math.max(.1, Math.min(ceiling - .08, node.height)), ceiling,
      intensity: Math.min(46, 24 * Math.sqrt(Math.max(8, area) / 16)),
      distance: Math.max(5, Math.min(20, room ? Math.hypot(room.width, room.depth) * 1.6 : 10)),
      source: 'plan' as const, lightOn: room?.lightOn,
    };
  });
  // Give each room a light before spending the remaining budget on extra points.
  const primary = plan.rooms.map(room => {
    const existing = authored.find(item => item.roomId === room.id);
    if (existing) return existing;
    const p = roomLabelPoint(room);
    return {
      id: `preview-${room.id}`, roomId: room.id, x: p.x, z: p.y,
      y: ceiling - .09, ceiling,
      intensity: Math.min(46, 24 * Math.sqrt(Math.max(8, roomArea(room)) / 16)),
      distance: Math.max(5, Math.min(20, Math.hypot(room.width, room.depth) * 1.6)),
      source: 'preview' as const, lightOn: room.lightOn,
    };
  });
  const occupied = new Set(primary.map(item => item.id));
  return [...primary, ...authored.filter(item => !occupied.has(item.id))].slice(0, Math.max(0, limit));
}

/** Visible only with the ceiling or in walkthrough, so cutaway fixtures do not float. */
export default function InteriorFixtures({ showcaseRoom,fixtures, level, manualIntensity=1, onRoomLightToggle }: {showcaseRoom?:string;fixtures: InteriorFixture[]; level: number; manualIntensity?: number; onRoomLightToggle?: (roomId: string) => void}) {
  return <group name="indoor-fixtures">
    {fixtures.map(fixture => {const lightLevel=fixtureLightLevel(fixture,level,manualIntensity);return <group key={fixture.id} name={`indoor-fixture-${fixture.id}`} position={[fixture.x, fixture.y, fixture.z]} userData={{source: fixture.source, roomId: fixture.roomId, lightOn:lightLevel>.01}} onClick={event=>{if(fixture.roomId&&onRoomLightToggle){event.stopPropagation();onRoomLightToggle(fixture.roomId);}}}>
      {fixture.ceiling - fixture.y > .14 && <mesh position={[0, (fixture.ceiling - fixture.y) / 2, 0]}>
        <cylinderGeometry args={[.009, .009, fixture.ceiling - fixture.y, 6]}/>
        <meshStandardMaterial color="#b9b5a9" metalness={.35} roughness={.52}/>
      </mesh>}
      {showcaseRoom && fixture.roomId===showcaseRoom && fixture.source==='preview' && <group name="woven-drum-shade">
        <mesh position={[0,-.084,0]}><cylinderGeometry args={[.29,.265,.167,48,1,true]}/><meshStandardMaterial color="#d8c5a4" roughness={.94} side={2} emissive="#ffe4b5" emissiveIntensity={lightLevel*.4}/></mesh>
        {[-.004,-.165].map((y,i)=><mesh key={y} position={[0,y,0]} rotation={[Math.PI/2,0,0]}><torusGeometry args={[i?.266:.29,.009,6,48]}/><meshStandardMaterial color="#81684b" roughness={.61}/></mesh>)}
        {Array.from({length:12},(_,i)=>{const a=i*Math.PI/6;return <mesh key={i} position={[.28*Math.cos(a),-.084,.28*Math.sin(a)]}><cylinderGeometry args={[.003,.003,.164,5]}/><meshStandardMaterial color="#9b805d" roughness={.69}/></mesh>})}
        <mesh position={[0,-.162,0]} rotation={[Math.PI/2,0,0]}><circleGeometry args={[.264,48]}/><meshStandardMaterial color="#f4e9d3" emissive="#ffe7bc" emissiveIntensity={lightLevel} roughness={.85}/></mesh>
      </group>}
      <mesh castShadow receiveShadow>
        <cylinderGeometry args={[.18, .18, .055, 24]}/>
        <meshStandardMaterial color="#e9e6dc" metalness={.2} roughness={.42}/>
      </mesh>
      <mesh position={[0, -.029, 0]}>
        <cylinderGeometry args={[.151, .151, .008, 24]}/>
        <meshStandardMaterial color={lightLevel > .01 ? '#fff1d6' : '#d5d5ca'} emissive="#ffdb9e" emissiveIntensity={lightLevel * 3} roughness={.58} toneMapped={false}/>
      </mesh>
    </group>;})}
  </group>;
}
