"use client";

import {useEffect,useRef,useState} from 'react';
import {useFrame,useThree,type ThreeEvent} from '@react-three/fiber';
import {Group,MathUtils} from 'three';
import type {Plan} from '@/lib/plan';
import PbrMaterial from '@/components/PbrMaterial';

export interface OpeningVisualProps {
  opening:Plan['openings'][number];
  wallThickness:number;
  center:number;
  bottom:number;
  height:number;
  /** The visible width after clipping the opening to its wall segment. */
  width?:number;
  onToggle?:()=>void;
}

function FrameBox({position,size,wood=false,hovered=false}:{position:[number,number,number];size:[number,number,number];wood?:boolean;hovered?:boolean}) {
  if(size.some(value=>value<=.001))return null;
  return <mesh position={position} castShadow receiveShadow>
    <boxGeometry args={size}/>
    {wood?<PbrMaterial material={{id:'door-oak',name:'橡木门板',category:'furniture',color:'#c5ae88',roughness:.7,pattern:'wood'}} kind="wood" repeat={[Math.max(.15,size[0]),Math.max(.2,size[1]/2)]} selected={hovered}/>:<meshStandardMaterial color="#8d9289" roughness={.47} metalness={.42} emissive={hovered?'#a4884b':'#000000'} emissiveIntensity={hovered?.08:0}/>}
  </mesh>;
}

function Handle({x,y,z=0,reverse=false}:{x:number;y:number;z?:number;reverse?:boolean}) {
  return <group position={[x,y,z]}>
    <mesh><boxGeometry args={[.035,.12,.014]}/><meshStandardMaterial color="#7d7565" metalness={.75} roughness={.3}/></mesh>
    <mesh position={[reverse?-.038:.038,0,.03]}><boxGeometry args={[.095,.02,.018]}/><meshStandardMaterial color="#b7ab8d" metalness={.85} roughness={.25}/></mesh>
  </group>;
}

/** A real hinged leaf, shared by orbit editing and the first-person view. */
export default function OpeningVisual({opening,wallThickness,center,bottom,height,width=opening.width,onToggle}:OpeningVisualProps) {
  const {gl}=useThree();
  const [hovered,setHovered]=useState(false);
  const group=useRef<Group>(null),left=useRef<Group>(null),right=useRef<Group>(null);
  const isWindow=opening.kind==='window';
  const isOpen=(opening as Plan['openings'][number]&{isOpen?:boolean}).isOpen??!isWindow;
  const angle=isOpen?(isWindow?65:78*(opening.swingSide??1))*Math.PI/180:0;
  const initialAngle=useRef(angle);
  const previousCursor=useRef<string|null>(null);
  const releaseCursor=()=>{if(previousCursor.current!==null){gl.domElement.style.cursor=previousCursor.current;previousCursor.current=null;}};
  useEffect(()=>()=>{if(previousCursor.current!==null)gl.domElement.style.cursor=previousCursor.current;},[gl]);
  useFrame((_,delta)=>{
    let moving=false;
    for(const [ref,sign] of [[left,-1],[right,1]] as const){
      if(!ref.current)continue;
      const target=angle*sign;
      const next=MathUtils.damp(ref.current.rotation.y,target,13,Math.min(delta,.08));
      ref.current.rotation.y=Math.abs(next-target)<.0008?target:next;
      moving||=ref.current.rotation.y!==target;
    }
    if(group.current)group.current.userData.animating=moving;
  });
  const hover=(event:ThreeEvent<PointerEvent>)=>{
    if(!onToggle)return;
    event.stopPropagation();setHovered(true);
    if(previousCursor.current===null)previousCursor.current=gl.domElement.style.cursor;
    gl.domElement.style.cursor='pointer';
  };
  if(width<=.06||height<=.06)return null;
  const jamb=.045,leafHeight=Math.max(.03,height-jamb*2),paneWidth=Math.max(.025,(width-jamb*3)/2),leafWidth=Math.max(.025,width-jamb*2);
  return <group ref={group} name={`${opening.kind}-${opening.id}`} position={[center,bottom,0]} userData={{openingId:opening.id,sill:bottom,windowHeight:isWindow?height:undefined,isOpen,targetAngle:angle,interactive:Boolean(onToggle)}}
    onClick={event=>{if(onToggle&&event.delta<5){event.stopPropagation();onToggle();}}}
    onPointerOver={hover} onPointerOut={()=>{setHovered(false);releaseCursor();}}>
    <FrameBox position={[-width/2+jamb/2,height/2,0]} size={[jamb,height,wallThickness+.025]}/>
    <FrameBox position={[width/2-jamb/2,height/2,0]} size={[jamb,height,wallThickness+.025]}/>
    <FrameBox position={[0,height-jamb/2,0]} size={[width,jamb,wallThickness+.025]}/>
    {isWindow?<>
      <FrameBox position={[0,jamb/2,0]} size={[width,jamb,wallThickness+.025]}/>
      <FrameBox position={[0,height/2,0]} size={[jamb,height,.075]}/>
      {[false,true].map(reverse=><group ref={reverse?right:left} key={String(reverse)} name={`window-leaf-${opening.id}-${reverse?'right':'left'}`} position={[reverse?width/2-jamb:-width/2+jamb,jamb,0]} rotation={[0,initialAngle.current*(reverse?1:-1),0]}>
        <group position={[(reverse?-1:1)*paneWidth/2,leafHeight/2,0]}>
          <mesh name={`window-glass-${opening.id}-${reverse?'right':'left'}`} receiveShadow><boxGeometry args={[Math.max(.01,paneWidth-.04),Math.max(.01,leafHeight-.05),.016]}/><meshPhysicalMaterial color="#cbdcd9" roughness={.045} metalness={.1} transparent opacity={.095} clearcoat={1} clearcoatRoughness={.03} depthWrite={false}/></mesh>
          <FrameBox position={[-paneWidth/2+.014,0,0]} size={[.028,leafHeight,.045]} hovered={hovered}/>
          <FrameBox position={[paneWidth/2-.014,0,0]} size={[.028,leafHeight,.045]} hovered={hovered}/>
          <FrameBox position={[0,-leafHeight/2+.014,0]} size={[paneWidth,.028,.045]} hovered={hovered}/>
          <FrameBox position={[0,leafHeight/2-.014,0]} size={[paneWidth,.028,.045]} hovered={hovered}/>
          <Handle x={(reverse?-1:1)*(paneWidth/2-.06)} y={0} z={.033} reverse={reverse}/>
        </group>
      </group>)}
    </>:<group ref={left} name={`door-leaf-${opening.id}`} position={[-width/2+jamb,0,0]} rotation={[0,-initialAngle.current,0]}>
      <FrameBox position={[leafWidth/2,(height-jamb)/2,0]} size={[leafWidth,Math.max(.03,height-jamb),.045]} wood hovered={hovered}/>
      <Handle x={Math.max(.025,leafWidth-.1)} y={Math.min(1.03,height*.49)} z={.035} reverse/>
      <group rotation={[0,Math.PI,0]} position={[0,0,-.035]}><Handle x={-Math.max(.025,leafWidth-.1)} y={Math.min(1.03,height*.49)}/></group>
      <FrameBox position={[.018,Math.min(.3,height*.2),.025]} size={[.028,.08,.018]}/>
      <FrameBox position={[.018,Math.max(.1,height-.3),.025]} size={[.028,.08,.018]}/>
    </group>}
  </group>;
}
