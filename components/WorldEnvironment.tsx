"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BackSide, BufferAttribute, BufferGeometry, CanvasTexture, DoubleSide, Fog, Group, InstancedMesh, MeshStandardMaterial, Object3D, Quaternion, SRGBColorSpace, Vector3 } from 'three';
import type { Plan } from '@/lib/plan';
import type { EnvironmentSettings, EnvironmentState } from '@/lib/environment';
import { buildingBounds } from '@/lib/building-bounds';

type Props = {plan: Plan; settings: EnvironmentSettings; state: EnvironmentState; quality: 'balanced' | 'high'; groundElevation?: number};
type WorldBounds = ReturnType<typeof buildingBounds>;
const noHit = () => {};
const SKY_RADIUS = 2000;
const CELESTIAL_DISTANCE = 1800;

function random(seed = 32) { let value = seed >>> 0; return () => { value = (1664525 * value + 1013904223) >>> 0; return value / 4294967296; }; }
function canvasTexture(width: number, height: number, draw: (context: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  draw(canvas.getContext('2d')!);
  const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace;
  return texture;
}
function skyTexture(top: string, horizon: string, ground: string) {
  return canvasTexture(64, 256, context => {
    const gradient = context.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, top); gradient.addColorStop(.34, top); gradient.addColorStop(.5, horizon);
    gradient.addColorStop(.57, ground); gradient.addColorStop(1, ground);
    context.fillStyle = gradient; context.fillRect(0, 0, 64, 256);
  });
}
function cloudTexture() {
  return canvasTexture(256, 128, context => {
    const r = random(79);
    for (let i = 0; i < 30; i++) {
      const x = 25 + r() * 205, y = 48 + r() * 33, radius = 17 + r() * 30;
      const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, '#ffffff24'); gradient.addColorStop(.4, '#ffffff16'); gradient.addColorStop(1, '#ffffff00');
      context.fillStyle = gradient; context.fillRect(x-radius, y-radius, radius*2, radius*2);
    }
  });
}
function glowTexture() {
  return canvasTexture(128, 128, context => {
    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, '#fff9e8ff'); gradient.addColorStop(.25, '#fff6dbff'); gradient.addColorStop(.3, '#ffe4b52f'); gradient.addColorStop(1, '#ffd38c00');
    context.fillStyle = gradient; context.fillRect(0, 0, 128, 128);
  });
}
function moonTexture(phase: number) {
  return canvasTexture(192, 192, context => {
    const data = context.createImageData(192, 192), angle = phase * Math.PI * 2;
    const lightX = Math.sin(angle), lightZ = -Math.cos(angle), r = random(322);
    const craters = Array.from({length: 28}, () => ({x:r()*1.8-.9,y:r()*1.8-.9,r:.025+r()*.15}));
    for (let y=0; y<192; y++) for(let x=0; x<192; x++) {
      const px=(x-95.5)/94, py=(y-95.5)/94, radius=px*px+py*py;
      if(radius>1) continue;
      const z=Math.sqrt(1-radius), lit=Math.max(0,px*lightX+z*lightZ);
      let surface=.92+.035*Math.sin(x*.51+y*.71);
      for(const crater of craters){const d=Math.hypot(px-crater.x,py-crater.y)/crater.r;if(d<1)surface-=.12*(1-d);else if(d<1.12)surface+=.035;}
      const bright=(lit>0?.35+.65*Math.sqrt(lit):.026)*surface, index=(y*192+x)*4;
      data.data[index]=Math.min(255,bright*247);data.data[index+1]=Math.min(255,bright*247);data.data[index+2]=Math.min(255,bright*237);data.data[index+3]=Math.min(255,(1-Math.sqrt(radius))*94*255);
    }
    context.putImageData(data,0,0);
  });
}
function treeTexture() {
  return canvasTexture(512, 640, context => {
    const r=random(201);
    context.strokeStyle='#66523b';context.lineWidth=15;context.lineCap='round';
    context.beginPath();context.moveTo(258,636);context.bezierCurveTo(247,485,270,367,256,250);context.stroke();
    for(let i=0;i<23;i++){const y=200+r()*280,side=i%2?1:-1;context.lineWidth=2+r()*6;context.beginPath();context.moveTo(256,y+55);context.quadraticCurveTo(256+side*35,y,256+side*(40+r()*115),y-15-r()*45);context.stroke();}
    const clusters=Array.from({length:42},()=>({x:100+r()*310,y:100+r()*345,r:30+r()*58}));
    for(const cluster of clusters)for(let i=0;i<90;i++){
      const a=r()*Math.PI*2,rad=Math.sqrt(r())*cluster.r,x=cluster.x+Math.cos(a)*rad,y=cluster.y+Math.sin(a)*rad;
      if(x<12||x>500||y<15||y>540)continue;
      const green=60+Math.floor(r()*46),red=39+Math.floor(r()*29),blue=27+Math.floor(r()*20);
      context.fillStyle=`rgba(${red},${green},${blue},${.65+r()*.35})`;context.beginPath();context.ellipse(x,y,3+r()*8,2+r()*5,r()*Math.PI,0,Math.PI*2);context.fill();
    }
  });
}
function buildingTextures() {
  const draw=(emissive: boolean)=>(context:CanvasRenderingContext2D)=>{
    context.fillStyle=emissive?'#000000':'#b7b6b0';context.fillRect(0,0,256,256);
    const r=random(611);
    for(let row=0;row<10;row++)for(let col=0;col<8;col++){
      const lit=r()>.57;context.fillStyle=emissive?(lit?'#ffe0a8':'#000000'):(lit?'#81908e':'#64777b');
      context.fillRect(9+col*31,8+row*25,14,15);
      if(!emissive){context.fillStyle='#dfdfd4';context.fillRect(8+col*31,24+row*25,17,2);}
    }
  };
  return [canvasTexture(256,256,draw(false)),canvasTexture(256,256,draw(true))] as const;
}
function directionQuaternion(direction: [number,number,number]) {
  return new Quaternion().setFromUnitVectors(new Vector3(0,0,1),new Vector3(...direction).negate());
}

function Scenery({bounds,landscape,night,groundElevation,high}:{bounds:WorldBounds;landscape:EnvironmentSettings['landscape'];night:number;groundElevation:number;high:boolean}) {
  const centerX=bounds.x+bounds.width/2, centerZ=bounds.y+bounds.depth/2;
  const trees=useRef<InstancedMesh>(null), buildings=useRef<InstancedMesh>(null);
  const treeMap=useMemo(treeTexture,[]), maps=useMemo(buildingTextures,[]);
  const materials=useMemo(()=>{
    const facade=new MeshStandardMaterial({map:maps[0],emissiveMap:maps[1],emissive:'#ffc778',roughness:.9});
    const roof=new MeshStandardMaterial({color:'#9b9e9a',roughness:1});return {facade,roof,array:[facade,facade,roof,roof,facade,facade]};
  },[maps]);
  useEffect(()=>{materials.facade.emissiveIntensity=night*.75;},[night,materials]);
  useEffect(()=>()=>{treeMap.dispose();maps.forEach(map=>map.dispose());materials.facade.dispose();materials.roof.dispose();},[treeMap,maps,materials]);
  const treePositions=useMemo(()=>{
    const r=random(388),count=high?28:16;
    return Array.from({length:count},(_,i)=>{
      const a=i/count*Math.PI*2+r()*.2,rad=Math.hypot(bounds.width,bounds.depth)/2+12+r()*13;
      const x=centerX+Math.sin(a)*rad,z=centerZ+Math.cos(a)*rad;
      return{x,z,height:5+r()*5,width:3.5+r()*3,rotation:r()*Math.PI};
    });
  },[centerX,centerZ,bounds.width,bounds.depth,high]);
  const cityPositions=useMemo(()=>{
    const r=random(820),count=high?32:20;
    return Array.from({length:count},(_,i)=>{
      const a=i/count*Math.PI*2,rad=Math.hypot(bounds.width,bounds.depth)/2+42+r()*25;
      return{x:centerX+Math.sin(a)*rad,z:centerZ+Math.cos(a)*rad,width:5+r()*9,depth:5+r()*8,height:10+r()*31,rotation:Math.round(a/(Math.PI/2))*Math.PI/2};
    });
  },[centerX,centerZ,bounds.width,bounds.depth,high]);
  useLayoutEffect(()=>{
    if(trees.current){const object=new Object3D();treePositions.forEach((tree,i)=>{for(let plane=0;plane<2;plane++){object.position.set(tree.x,groundElevation+tree.height/2,tree.z);object.rotation.set(0,tree.rotation+plane*Math.PI/2,0);object.scale.set(tree.width,tree.height,1);object.updateMatrix();trees.current!.setMatrixAt(i*2+plane,object.matrix);}});trees.current.instanceMatrix.needsUpdate=true;trees.current.computeBoundingSphere();}
    if(buildings.current){const object=new Object3D();cityPositions.forEach((building,i)=>{object.position.set(building.x,groundElevation+building.height/2,building.z);object.rotation.set(0,building.rotation,0);object.scale.set(building.width,building.height,building.depth);object.updateMatrix();buildings.current!.setMatrixAt(i,object.matrix);});buildings.current.instanceMatrix.needsUpdate=true;buildings.current.computeBoundingSphere();}
  },[treePositions,cityPositions,groundElevation,landscape]);
  if(landscape==='none')return null;
  return <group name="world-landscape" userData={{landscape,decorative:true}}>
    <instancedMesh ref={trees} args={[undefined,undefined,treePositions.length*2]} name="world-trees" raycast={noHit} castShadow={high} receiveShadow>
      <planeGeometry args={[1,1]}/><meshStandardMaterial map={treeMap} alphaTest={.48} side={DoubleSide} roughness={1}/>
    </instancedMesh>
    {landscape==='city'&&<instancedMesh ref={buildings} args={[undefined,materials.array,cityPositions.length]} name="world-city" raycast={noHit} castShadow={high} receiveShadow><boxGeometry args={[1,1,1]}/></instancedMesh>}
  </group>;
}

function Rain({bounds,groundElevation,high}:{bounds:WorldBounds;groundElevation:number;high:boolean}) {
  const count=high?420:180,height=Math.max(24,-groundElevation+24);
  const field=useMemo(()=>{
    const r=random(480),positions=new Float32Array(count*6),drops:Array<{x:number;y:number;z:number;speed:number}>=[];
    const margin=1.5;
    for(let i=0;i<count;i++){
      let x=0,z=0;do{x=bounds.x-20+r()*(bounds.width+40);z=bounds.y-20+r()*(bounds.depth+40);}while(x>bounds.x-margin&&x<bounds.x+bounds.width+margin&&z>bounds.y-margin&&z<bounds.y+bounds.depth+margin);
      drops.push({x,y:r()*height,z,speed:9+r()*7});
    }
    const geometry=new BufferGeometry();geometry.setAttribute('position',new BufferAttribute(positions,3));
    return {positions,drops,geometry};
  },[bounds.x,bounds.y,bounds.width,bounds.depth,count,height]);
  useEffect(()=>()=>field.geometry.dispose(),[field]);
  useFrame((_,delta)=>{
    field.drops.forEach((drop,i)=>{
      drop.y=(drop.y-Math.min(delta,.08)*drop.speed+height)%height;
      // Keep all horizontal coordinates outside the entire apartment footprint.
      const index=i*6;field.positions[index]=drop.x;field.positions[index+1]=groundElevation+drop.y;field.positions[index+2]=drop.z;
      field.positions[index+3]=drop.x;field.positions[index+4]=groundElevation+drop.y+.42;field.positions[index+5]=drop.z;
    });field.geometry.attributes.position.needsUpdate=true;
  });
  return <lineSegments name="world-rain" geometry={field.geometry} raycast={noHit} frustumCulled={false} userData={{outsideOnly:true}}><lineBasicMaterial color="#b7c7d2" transparent opacity={.36} depthWrite={false}/></lineSegments>;
}

/** Lightweight outdoor context, independent from editable/recognized architecture. */
export default function WorldEnvironment({plan,settings,state,quality,groundElevation=0}:Props) {
  const scene=useThree(value=>value.scene);
  const celestial=useRef<Group>(null);
  // The sky is effectively at infinity: a long zoom around a tall building must
  // not leave the dome or change the compass direction of the sun and moon.
  useFrame(({camera})=>{if(celestial.current)celestial.current.position.copy(camera.position);});
  const bounds=useMemo(()=>buildingBounds(plan),[plan.width,plan.depth,plan.rooms,plan.walls,plan.building]);
  const centerX=bounds.x+bounds.width/2,centerZ=bounds.y+bounds.depth/2,high=quality==='high';
  const buildingHeight=(plan.building?.totalFloors??1)*(plan.building?.floorHeight??3.2);
  const sky=useMemo(()=>skyTexture(state.skyTopColor,state.skyHorizonColor,state.groundColor),[state.skyTopColor,state.skyHorizonColor,state.groundColor]);
  const cloud=useMemo(cloudTexture,[]),glow=useMemo(glowTexture,[]);
  const phase=Math.round(state.moonPhase*128)/128;
  const moon=useMemo(()=>moonTexture(phase),[phase]);
  useEffect(()=>()=>sky.dispose(),[sky]);useEffect(()=>()=>moon.dispose(),[moon]);
  useEffect(()=>()=>{cloud.dispose();glow.dispose();},[cloud,glow]);
  useEffect(()=>{
    if(!settings.enabled)return;
    const previous=scene.fog,fog=new Fog(state.skyHorizonColor,Math.max(90,buildingHeight*3),Math.max(380,buildingHeight*8));scene.fog=fog;
    return()=>{if(scene.fog===fog)scene.fog=previous;};
  },[scene,settings.enabled,state.skyHorizonColor,buildingHeight]);
  const stars=useMemo(()=>{
    const r=random(811),count=high?600:256,positions=new Float32Array(count*3);
    for(let i=0;i<count;i++){const a=r()*Math.PI*2,y=.06+r()*.94,rad=Math.sqrt(1-y*y)*1840;positions[i*3]=Math.sin(a)*rad;positions[i*3+1]=y*1840;positions[i*3+2]=Math.cos(a)*rad;}
    const geometry=new BufferGeometry();geometry.setAttribute('position',new BufferAttribute(positions,3));return geometry;
  },[high]);
  useEffect(()=>()=>stars.dispose(),[stars]);
  const clouds=useMemo(()=>{const r=random(65);return Array.from({length:high?10:6},(_,i)=>{const angle=i/(high?10:6)*Math.PI*2;return {x:Math.sin(angle)*225,y:45+r()*65,z:Math.cos(angle)*225,width:70+r()*75,height:30+r()*35};});},[high]);
  const sunPosition:[number,number,number]=[state.sunDirection[0]*CELESTIAL_DISTANCE,state.sunDirection[1]*CELESTIAL_DISTANCE,state.sunDirection[2]*CELESTIAL_DISTANCE];
  const moonPosition:[number,number,number]=[state.moonDirection[0]*CELESTIAL_DISTANCE,state.moonDirection[1]*CELESTIAL_DISTANCE,state.moonDirection[2]*CELESTIAL_DISTANCE];
  const sunQuaternion=useMemo(()=>directionQuaternion(state.sunDirection),[state.sunDirection[0],state.sunDirection[1],state.sunDirection[2]]);
  const moonQuaternion=useMemo(()=>directionQuaternion(state.moonDirection),[state.moonDirection[0],state.moonDirection[1],state.moonDirection[2]]);
  if(!settings.enabled)return null;
  return <group name="world-environment" userData={{groundElevation,weather:settings.weather,landscape:settings.landscape}}>
    <group ref={celestial} name="world-celestial-sky">
    <mesh name="world-sky" raycast={noHit} renderOrder={-20}><sphereGeometry args={[SKY_RADIUS,32,16]}/><meshBasicMaterial map={sky} side={BackSide} depthWrite={false} toneMapped={false} fog={false}/></mesh>
    <mesh name="world-sun" position={sunPosition} quaternion={sunQuaternion} visible={state.sunAltitude>-.9} raycast={noHit} userData={{altitude:state.sunAltitude}}><planeGeometry args={[64,64]}/><meshBasicMaterial map={glow} transparent opacity={Math.max(.08,1-state.clouds*.84)} color={state.sunColor} depthWrite={false} toneMapped={false} fog={false}/></mesh>
    <mesh name="world-moon" position={moonPosition} quaternion={moonQuaternion} visible={state.moonAltitude>0&&state.moonIllumination>.015} raycast={noHit} userData={{altitude:state.moonAltitude,illumination:state.moonIllumination,phase:state.moonPhase}}><planeGeometry args={[20.8,20.8]}/><meshBasicMaterial map={moon} transparent opacity={(.4+state.night*.6)*(1-state.clouds*.65)} depthWrite={false} toneMapped={false} fog={false}/></mesh>
    <points name="world-stars" geometry={stars} visible={state.night>.15&&settings.weather!=='rain'} raycast={noHit}><pointsMaterial color="#e0e7ff" size={high?1.5:1.2} sizeAttenuation={false} transparent opacity={state.night*(1-state.clouds)*.85} depthWrite={false} toneMapped={false} fog={false}/></points>
    </group>
    <mesh name="world-ground" rotation={[-Math.PI/2,0,0]} position={[centerX,groundElevation-.26,centerZ]} receiveShadow raycast={noHit}><planeGeometry args={[1800,1800]}/><meshStandardMaterial color={settings.landscape==='garden'?'#6d7953':settings.landscape==='city'?'#878984':'#a5a99b'} roughness={settings.weather==='rain'?.48:1}/></mesh>
    <mesh name="world-terrace" rotation={[-Math.PI/2,0,0]} position={[centerX,groundElevation-.245,centerZ]} receiveShadow raycast={noHit}><planeGeometry args={[bounds.width+8,bounds.depth+8]}/><meshStandardMaterial color="#b8b5a8" roughness={settings.weather==='rain'?.42:.92}/></mesh>
    <group name="world-clouds" position={[centerX,0,centerZ]}>{clouds.map((item,index)=><mesh key={index} position={[item.x,item.y,item.z]} quaternion={directionQuaternion([item.x/Math.hypot(item.x,item.y,item.z),item.y/Math.hypot(item.x,item.y,item.z),item.z/Math.hypot(item.x,item.y,item.z)])} raycast={noHit}><planeGeometry args={[item.width,item.height]}/><meshBasicMaterial map={cloud} color={state.night>.5?'#62718a':settings.weather==='rain'?'#727b85':'#f4f1e7'} transparent opacity={.18+state.clouds*.82} depthWrite={false} toneMapped={false} fog={false}/></mesh>)}</group>
    <Scenery bounds={bounds} landscape={settings.landscape} night={state.night} groundElevation={groundElevation-.24} high={high}/>
    {settings.weather==='rain'&&<Rain bounds={bounds} groundElevation={groundElevation-.2} high={high}/>}
  </group>;
}
