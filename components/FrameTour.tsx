"use client";
import dynamic from 'next/dynamic';
import {useState} from 'react';
import type {GeneratedImageRecord} from '@/lib/generation-store';
import {validatePlan} from '@/lib/validation';
import {findFreeWalkSpawn,WALK_EYE_HEIGHT} from '@/lib/walkthrough';
import {roomPolygon,pointInPolygon} from '@/lib/layout';
const Scene=dynamic(()=>import('./SceneView'),{ssr:false,loading:()=> <p>正在打开图中空间…</p>});
export default function FrameTour({record,onBack}:{record:GeneratedImageRecord;onBack:()=>void}){
  const [source]=useState(()=>{
    try {
      const [raw,layers]=JSON.parse(record.sceneKey!);
      const plan=validatePlan(raw),c=record.camera;
      let preferred:string|undefined;
      if(c && Object.values(c).every(Number.isFinite)){
        const t=c.dy<-.001?Math.max(0,-c.y/c.dy):0;
        const inside=Math.abs(c.y-WALK_EYE_HEIGHT)<.15;
        const p=inside?{x:c.x,y:c.z}:{x:c.x+t*c.dx,y:c.z+t*c.dz};
        preferred=plan.rooms.find(r=>pointInPolygon(p,roomPolygon(r)))?.id;
        if(inside)return {plan,layers,spawn:{position:p,yaw:Math.atan2(-c.dx,-c.dz),pitch:Math.asin(Math.max(-1,Math.min(1,c.dy))),roomId:preferred}};
      }
      return {plan,layers,spawn:findFreeWalkSpawn(plan,preferred)};
    }catch{return null;}
  });
  const [localPlan,setLocalPlan]=useState(source?.plan);
  if(!source?.spawn||!localPlan)return <div className="scene-empty"><p>这张图没有可进入的室内位置。</p><button className="button button-light" onClick={onBack}>返回效果图</button></div>;
  return <div className="effect-scene"><Scene plan={localPlan} tourStart={source.spawn} onTourExit={onBack} onPlanChange={p=>setLocalPlan(validatePlan(p))} visibleLayers={source.layers} selectedId={null} onSelect={()=>{}}/><button className="frame-tour-back" onClick={onBack} aria-label="关闭图中漫游">‹ 原效果图</button></div>;
}
