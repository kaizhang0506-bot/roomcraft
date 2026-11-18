"use client";

import {useMemo} from 'react';
import type {Plan} from '@/lib/plan';
import {pointInPolygon,roomLabelPoint,roomPolygon} from '@/lib/layout';
import {fixtureLightLevel} from '@/components/InteriorFixtures';

export interface RoomSwitch {roomId:string; x:number; z:number; rotation:number; lightOn?:boolean; wallId:string}

/** Locate wall plates beside door jambs, with a solid interior wall fallback. */
export function collectRoomSwitches(plan:Plan):RoomSwitch[] {
  return plan.rooms.flatMap(room=>{
    const polygon=roomPolygon(room),center=roomLabelPoint(room);
    const candidates:Array<RoomSwitch&{score:number}>=[];
    for(const wall of plan.walls){
      const dx=wall.end.x-wall.start.x,dz=wall.end.y-wall.start.y,length=Math.hypot(dx,dz);if(length<.3)continue;
      const openings=plan.openings.filter(opening=>opening.wallId===wall.id),doors=openings.filter(opening=>opening.kind==='door');
      const jambs=doors.flatMap(door=>[door.position*length-door.width/2-.18,door.position*length+door.width/2+.18]);
      const locations=[...jambs,length*.25,length*.5,length*.75];
      for(let index=0;index<locations.length;index++){
        const along=locations[index];if(along<.12||along>length-.12||openings.some(opening=>Math.abs(along-opening.position*length)<opening.width/2+.1))continue;
        for(const side of [-1,1]){
          const nx=-dz/length*side,nz=dx/length*side,offset=wall.thickness/2+.018;
          const x=wall.start.x+dx*along/length+nx*offset,z=wall.start.y+dz*along/length+nz*offset;
          if(!pointInPolygon({x,y:z},polygon)||!pointInPolygon({x:x+nx*.08,y:z+nz*.08},polygon))continue;
          candidates.push({roomId:room.id,x,z,rotation:Math.atan2(nx,nz),lightOn:room.lightOn,wallId:wall.id,score:(index<jambs.length?0:1000)+Math.hypot(x-center.x,z-center.y)});
        }
      }
    }
    candidates.sort((a,b)=>a.score-b.score);return candidates.length?[candidates[0]]:[];
  });
}

export default function RoomLightSwitches({plan,level,manualIntensity,onToggle}:{plan:Plan;level:number;manualIntensity:number;onToggle?:(roomId:string)=>void}) {
  const switches=useMemo(()=>collectRoomSwitches(plan),[plan]);
  return <group name="room-light-switches">{switches.map(item=>{
    const on=fixtureLightLevel(item,level,manualIntensity)>.01;
    return <group key={item.roomId} name={`room-light-switch-${item.roomId}`} position={[item.x,1.15,item.z]} rotation={[0,item.rotation,0]} userData={{roomId:item.roomId,wallId:item.wallId,lightOn:on}} onClick={event=>{if(onToggle){event.stopPropagation();onToggle(item.roomId);}}}>
      <mesh><boxGeometry args={[.105,.115,.02]}/><meshStandardMaterial color="#e6e1d5" roughness={.48}/></mesh>
      <mesh position={[0,0,.014]} rotation={[on?-.1:.1,0,0]}><boxGeometry args={[.074,.078,.014]}/><meshStandardMaterial color="#faf7ee" roughness={.35}/></mesh>
      <mesh position={[0,-.026,.023]}><boxGeometry args={[.018,.003,.002]}/><meshStandardMaterial color={on?'#b9d887':'#777f70'} emissive="#a9d974" emissiveIntensity={on ? .4 : 0}/></mesh>
    </group>;
  })}</group>;
}
