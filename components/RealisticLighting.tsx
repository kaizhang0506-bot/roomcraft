"use client";
import {useEffect,useMemo} from 'react';
import {useFrame,useThree} from '@react-three/fiber';
import {Environment,SoftShadows} from '@react-three/drei';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {GTAOPass} from 'three/addons/postprocessing/GTAOPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {Object3D} from 'three';
import {pointInPolygon,roomPolygon} from '@/lib/layout';
import {planBounds} from '@/lib/plan-bounds';
import type {Plan} from '@/lib/plan';
import {DEFAULT_ENVIRONMENT,deriveEnvironment,type EnvironmentSettings,type EnvironmentState} from '@/lib/environment';
import InteriorFixtures,{collectInteriorFixtures,fixtureLightLevel} from '@/components/InteriorFixtures';
import RoomLightSwitches from '@/components/RoomLightSwitches';

/** Optional high quality AO. The interactive default uses the renderer directly. */
export function ContactShadowPass({enabled=false}:{enabled?:boolean}){
 return enabled ? <ContactShadowComposer/> : null;
}
function ContactShadowComposer(){
 const {gl,scene,camera,size}=useThree();
 const pipeline=useMemo(()=>{
  const composer=new EffectComposer(gl);const render=new RenderPass(scene,camera);const ao=new GTAOPass(scene,camera,Math.max(1,size.width),Math.max(1,size.height));
  ao.updateGtaoMaterial({radius:.35,distanceExponent:1,thickness:1.5,scale:1.1,samples:8});
  composer.addPass(render);composer.addPass(ao);composer.addPass(new OutputPass());return{composer,ao};
  // Size is updated below without recreating render targets during pointer motion.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[gl,scene,camera]);
 useEffect(()=>{pipeline.composer.setPixelRatio(Math.min(gl.getPixelRatio(),1.35));pipeline.composer.setSize(size.width,size.height);},[pipeline,size.width,size.height,gl]);
 useEffect(()=>()=>{pipeline.composer.passes.forEach(pass=>pass.dispose());pipeline.composer.dispose();},[pipeline]);
 useFrame((_,delta)=>pipeline.composer.render(delta),1);
 return null;
}
export default function RealisticLighting({plan, hour=12, north=0, quality='balanced',settings=DEFAULT_ENVIRONMENT,state,photoStudio=false,showFixtures=false,onRoomLightToggle}:{plan:Plan;hour?:number;north?:number;quality?:'balanced'|'high';settings?:EnvironmentSettings;state?:EnvironmentState;photoStudio?:boolean;showFixtures?:boolean;onRoomLightToggle?:(roomId:string)=>void}){
 const high=quality==='high';
 const lighting=state??deriveEnvironment(settings,hour,north);
 const extent=planBounds(plan);const centerX=extent.x+extent.width/2,centerZ=extent.y+extent.depth/2;
 const distance=Math.max(30,extent.width*2,extent.depth*2);
 const target=useMemo(()=>new Object3D(),[]);
 useEffect(()=>{target.position.set(centerX,0,centerZ);target.updateMatrixWorld();},[target,centerX,centerZ]);
 const photographicKey=useMemo(()=>{
   const windows=plan.openings.filter(o=>o.kind==='window').sort((a,b)=>b.width*b.height-a.width*a.height);
   for(const o of windows){
    const w=plan.walls.find(w=>w.id===o.wallId);if(!w)continue;
    const dx=w.end.x-w.start.x,dz=w.end.y-w.start.y,len=Math.hypot(dx,dz);if(!len)continue;
    const x=w.start.x+dx*o.position,z=w.start.y+dz*o.position;
    const offset=w.thickness/2+.08;
    const inside=(sign:number)=>plan.rooms.some(r=>pointInPolygon({x:x-sign*dz/len*offset,y:z+sign*dx/len*offset},roomPolygon(r)));
    if(inside(1)===inside(-1))continue;
    const side=inside(1)?1:-1;
    return [(side*dz+.32*dx)/len,.56,(-side*dx+.32*dz)/len];
   }
   return [-.4,.65,-.9];
 },[plan.rooms,plan.walls,plan.openings]);
 const keyDirection=photoStudio?photographicKey:lighting.sunDirection;
 const sun:[number,number,number]=[centerX+keyDirection[0]*distance,keyDirection[1]*distance,centerZ+keyDirection[2]*distance];
 const moon:[number,number,number]=[centerX+lighting.moonDirection[0]*distance,lighting.moonDirection[1]*distance,centerZ+lighting.moonDirection[2]*distance];
 const sunActive=lighting.sunAltitude>0&&lighting.sunIntensity>.001;
 const moonActive=lighting.moonAltitude>0&&lighting.moonIntensity>.001;
 const fixtures=useMemo(()=>collectInteriorFixtures(plan,high?16:8),[plan,high]);
 const windows=useMemo(()=>plan.openings.filter(opening=>opening.kind==='window').slice(0,high?8:4).flatMap(opening=>{
   const wall=plan.walls.find(item=>item.id===opening.wallId);if(!wall)return[];
   const dx=wall.end.x-wall.start.x,dz=wall.end.y-wall.start.y,length=Math.hypot(dx,dz);if(length<.01)return[];
   const x=wall.start.x+dx*opening.position,z=wall.start.y+dz*opening.position;
   const offset=Math.max(.15,wall.thickness/2+.08);
   const candidates=[{x:x-dz/length*offset,y:z+dx/length*offset},{x:x+dz/length*offset,y:z-dx/length*offset}];
   const inside=candidates.find(point=>plan.rooms.some(room=>pointInPolygon(point,roomPolygon(room))));
   return[{id:opening.id,x:inside?.x??x,z:inside?.y??z,y:Math.min(wall.height-.05,opening.sill+opening.height*.5)}];
 }),[plan,high]);
 const mapSize:[number,number]=high?[2048,2048]:[1024,1024];
 // A symmetric bound contains the footprint even when the sun rotates across it.
 const shadowWidth=Math.max(9,Math.hypot(extent.width,extent.depth)*.55),shadowDepth=shadowWidth;
 return <>
  <Environment files={photoStudio?"/assets/realistic/garden-daylight.hdr":"/assets/realistic/studio.hdr"} background={photoStudio&&showFixtures} backgroundIntensity={photoStudio?1.65*lighting.daylight+.015:1} environmentIntensity={photoStudio?.06+.7*lighting.daylight:lighting.environmentIntensity}/>
  {high && <SoftShadows size={16} samples={8} focus={.35}/>}
  <ambientLight name="environment-ambient" intensity={lighting.ambientIntensity}/>
  <hemisphereLight name="environment-hemisphere" args={[lighting.skyHorizonColor,lighting.groundColor,lighting.hemisphereIntensity]}/>
  <primitive object={target}/>
  <directionalLight key={`sun-${quality}`} name="soft-daylight" position={sun} target={target} intensity={sunActive?(photoStudio?3.15:lighting.sunIntensity):0} color={photoStudio?"#fff1d6":lighting.sunColor} castShadow={sunActive} shadow-mapSize={photoStudio?[2048,2048]:mapSize} shadow-camera-near={.1} shadow-camera-far={distance*3} shadow-camera-left={-shadowWidth} shadow-camera-right={shadowWidth} shadow-camera-top={shadowDepth} shadow-camera-bottom={-shadowDepth} shadow-normalBias={.018} shadow-bias={-.00015} shadow-radius={4}/>
  <directionalLight key={`moon-${quality}`} name="soft-moonlight" position={moon} target={target} intensity={moonActive?lighting.moonIntensity:0} color="#b9ceff" castShadow={high&&!sunActive&&moonActive} shadow-mapSize={photoStudio?[2048,2048]:mapSize} shadow-camera-near={.1} shadow-camera-far={distance*3} shadow-camera-left={-shadowWidth} shadow-camera-right={shadowWidth} shadow-camera-top={shadowDepth} shadow-camera-bottom={-shadowDepth} shadow-normalBias={.02} shadow-bias={-.00015}/>
  {fixtures.map(fixture=><pointLight key={fixture.id} name={`indoor-light-${fixture.id}`} position={[fixture.x,fixture.y-.08,fixture.z]} intensity={fixture.intensity*fixtureLightLevel(fixture,lighting.indoorLightLevel,settings.indoorIntensity)} distance={fixture.distance} decay={2} color="#ffe0ad" userData={{source:fixture.source,roomId:fixture.roomId}}/>)}
  {windows.map(window=><pointLight key={window.id} name={`window-light-${window.id}`} position={[window.x,window.y,window.z]} intensity={(photoStudio?4.5:10)*lighting.daylight*(1-lighting.clouds*.6)} distance={9} decay={2} color={lighting.sunAltitude<12?'#ffe1bd':'#deebff'}/>)}
  {showFixtures&&<><InteriorFixtures showcaseRoom={plan.rooms.find(r=>r.id==="ref-room-living")?.id} fixtures={fixtures} level={lighting.indoorLightLevel} manualIntensity={settings.indoorIntensity} onRoomLightToggle={onRoomLightToggle}/><RoomLightSwitches plan={plan} level={lighting.indoorLightLevel} manualIntensity={settings.indoorIntensity} onToggle={onRoomLightToggle}/></>}
 </>;
}
