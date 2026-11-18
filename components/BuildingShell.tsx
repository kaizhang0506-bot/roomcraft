"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { BufferGeometry, InstancedMesh, Object3D } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Plan } from '@/lib/plan';
import { getBuildingFloor } from '@/lib/building';
import { createRoomSlabGeometry, resolvePlanMaterial, wallRenderSegments } from '@/lib/room-rendering';
import PbrMaterial from '@/components/PbrMaterial';

export type BuildingViewMode = 'floor' | 'cutaway' | 'building';
type Props = {plan:Plan;mode:BuildingViewMode;selectedFloor:number;totalFloors:number;floorHeight:number;onSelectFloor?:(floor:number)=>void};
type ShellBox = {floor:number;position:[number,number,number];size:[number,number,number];rotation:number};
type Plate = {floor:number;y:number};
type Plates = {key:string;geometry:BufferGeometry;instances:Plate[]};

function sourceFloor(plan:Plan,floor:number,selected:number):Plan {
  if(floor===selected)return plan;
  return {...plan,...getBuildingFloor(plan,floor)};
}

function prepareShell({plan,mode,selectedFloor,totalFloors,floorHeight}:Props) {
  const walls:ShellBox[]=[],frames:ShellBox[]=[],glass:ShellBox[]=[],plates=new Map<string,Plates>();
  if(mode==='floor')return {walls,frames,glass,plates:[] as Plates[]};
  const total=Math.max(1,Math.min(50,Math.round(totalFloors))),active=Math.max(1,Math.min(total,Math.round(selectedFloor)));
  const storeyHeight=Math.max(2,Math.min(12,floorHeight));
  const addPlate=(floor:number,source:Plan,y:number)=>{
    if(!source.rooms.length)return;
    const key=JSON.stringify(source.rooms.map(room=>[room.x,room.y,room.width,room.depth,room.polygon]));
    let batch=plates.get(key);
    if(!batch){
      const pieces=source.rooms.map(room=>createRoomSlabGeometry(room,.18));
      const geometry=mergeGeometries(pieces,false);pieces.forEach(piece=>piece.dispose());
      if(!geometry)return;
      batch={key,geometry,instances:[]};plates.set(key,batch);
    }
    batch.instances.push({floor,y});
  };
  for(let floor=1;floor<=total;floor++){
    if(floor===active||(mode==='cutaway'&&floor>active))continue;
    const source=sourceFloor(plan,floor,active),base=(floor-active)*storeyHeight;
    addPlate(floor,source,base);
    for(const wall of source.walls){
      const dx=wall.end.x-wall.start.x,dz=wall.end.y-wall.start.y,length=Math.hypot(dx,dz);
      if(length<.01)continue;
      const rotation=-Math.atan2(dz,dx),ux=dx/length,uz=dz/length;
      const add=(list:ShellBox[],along:number,y:number,width:number,height:number,depth:number)=>{
        if(width<=.001||height<=.001||depth<=.001)return;
        list.push({floor,position:[wall.start.x+ux*along,base+y,wall.start.y+uz*along],size:[width,height,depth],rotation});
      };
      // Close the floor-to-floor envelope; active-floor interiors retain their measured wall heights.
      const {parts,holes}=wallRenderSegments({...wall,height:storeyHeight-.18},source.openings,false);
      for(const part of parts)add(walls,(part.start+part.end)/2,(part.bottom+part.top)/2,part.end-part.start,part.top-part.bottom,wall.thickness);
      for(const opening of holes){
        const width=opening.b-opening.a,height=opening.renderHeight,bottom=opening.renderBottom,center=(opening.a+opening.b)/2;
        if(width<=.06||height<=.06)continue;
        if(opening.kind==='window'){
          add(glass,center,bottom+height/2,width,height,.025);
          add(frames,center,bottom+.025,width,.05,wall.thickness+.025);
          add(frames,center,bottom+height-.025,width,.05,wall.thickness+.025);
          add(frames,opening.a+.025,bottom+height/2,.05,height,.08);
          add(frames,opening.b-.025,bottom+height/2,.05,height,.08);
          if(width>1.2)add(frames,center,bottom+height/2,.035,height,.065);
        }else{
          add(frames,opening.a+.025,bottom+height/2,.05,height,wall.thickness+.02);
          add(frames,opening.b-.025,bottom+height/2,.05,height,wall.thickness+.02);
          add(frames,center,bottom+height-.025,width,.05,wall.thickness+.02);
        }
      }
    }
  }
  // Whole-building mode has a roof; horizontal cutaway leaves the selected floor open.
  if(mode==='building')addPlate(total,sourceFloor(plan,total,active),(total-active+1)*storeyHeight);
  return {walls,frames,glass,plates:[...plates.values()]};
}

function BoxBatch({name,boxes,onSelectFloor,children,castShadow=true}:{name:string;boxes:ShellBox[];onSelectFloor?:Props['onSelectFloor'];children:ReactNode;castShadow?:boolean}) {
  const ref=useRef<InstancedMesh>(null);
  useLayoutEffect(()=>{
    if(!ref.current)return;
    const object=new Object3D();
    boxes.forEach((box,index)=>{object.position.set(...box.position);object.rotation.set(0,box.rotation,0);object.scale.set(...box.size);object.updateMatrix();ref.current!.setMatrixAt(index,object.matrix);});
    ref.current.instanceMatrix.needsUpdate=true;ref.current.computeBoundingSphere();
  },[boxes]);
  const select=(event:ThreeEvent<MouseEvent>)=>{if(event.delta>5||event.instanceId===undefined)return;const item=boxes[event.instanceId];if(item&&onSelectFloor){event.stopPropagation();onSelectFloor(item.floor);}};
  if(!boxes.length)return null;
  return <instancedMesh ref={ref} name={name} args={[undefined,undefined,boxes.length]} castShadow={castShadow} receiveShadow userData={{floorByInstance:boxes.map(item=>item.floor)}} onClick={select}><boxGeometry args={[1,1,1]}/>{children}</instancedMesh>;
}

function PlateBatch({batch,onSelectFloor,plan}:{batch:Plates;onSelectFloor?:Props['onSelectFloor'];plan:Plan}) {
  const ref=useRef<InstancedMesh>(null);
  useLayoutEffect(()=>{
    if(!ref.current)return;
    const object=new Object3D();batch.instances.forEach((item,index)=>{object.position.set(0,item.y,0);object.updateMatrix();ref.current!.setMatrixAt(index,object.matrix);});
    ref.current.instanceMatrix.needsUpdate=true;ref.current.computeBoundingSphere();
  },[batch]);
  return <instancedMesh ref={ref} name="building-shell-slabs" args={[batch.geometry,undefined,batch.instances.length]} castShadow receiveShadow userData={{floorByInstance:batch.instances.map(item=>item.floor)}} onClick={event=>{if(event.delta>5||event.instanceId===undefined)return;const item=batch.instances[event.instanceId];if(item&&onSelectFloor){event.stopPropagation();onSelectFloor(item.floor);}}}>
    <PbrMaterial material={resolvePlanMaterial(plan,undefined,'plaster-warm')} kind="wall" repeat={[8,8]}/>
  </instancedMesh>;
}

/** Other storeys show a batched architectural envelope; only the active floor has furniture. */
export default function BuildingShell(props:Props) {
  const {plan,mode,selectedFloor,totalFloors,floorHeight,onSelectFloor}=props;
  const data=useMemo(()=>prepareShell({plan,mode,selectedFloor,totalFloors,floorHeight}),[plan.walls,plan.openings,plan.rooms,plan.building,mode,selectedFloor,totalFloors,floorHeight]);
  useEffect(()=>()=>data.plates.forEach(batch=>batch.geometry.dispose()),[data]);
  if(mode==='floor')return null;
  return <group name="building-shell" userData={{mode,activeFloor:selectedFloor,totalFloors,floorHeight,structuralInstances:data.walls.length,visibleFloors:[...new Set(data.walls.map(item=>item.floor))]}}>
    <BoxBatch name="building-shell-walls" boxes={data.walls} onSelectFloor={onSelectFloor}><PbrMaterial material={resolvePlanMaterial(plan,undefined,'plaster-warm')} kind="wall" repeat={[1,1]}/></BoxBatch>
    <BoxBatch name="building-shell-frames" boxes={data.frames} onSelectFloor={onSelectFloor}><meshStandardMaterial color="#696c5e" roughness={.52} metalness={.2}/></BoxBatch>
    <BoxBatch name="building-shell-windows" boxes={data.glass} onSelectFloor={onSelectFloor} castShadow={false}><meshPhysicalMaterial color="#bed4d4" roughness={.12} transparent opacity={.38} depthWrite={false} transmission={.2} thickness={.025}/></BoxBatch>
    {data.plates.map(batch=><PlateBatch key={batch.key} batch={batch} plan={plan} onSelectFloor={onSelectFloor}/>)}
  </group>;
}
