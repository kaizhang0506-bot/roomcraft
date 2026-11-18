"use client";
import {useEffect,useRef,useState} from 'react';
import dynamic from 'next/dynamic';
const PhotoTour=dynamic(()=>import('./PhotoTour'),{ssr:false});
import SceneView,{type SceneViewProps} from './SceneView';
import {validatePlan} from '@/lib/validation';
import {interiorCamera} from '@/lib/interior-camera';
import type {WalkSpawn} from '@/lib/walkthrough';
import type {Plan} from '@/lib/plan';
import type {FrameCamera} from '@/lib/generation-store';
import './staged-space.css';
type Version={key:string;plan:Plan;origin:'ai'|'local'};
const STORE='roomcraft.finished-space.v1';
interface Props extends SceneViewProps {draftKey:string;styleId:string;brief:string;aiAvailable:boolean;imageAvailable:boolean;onConfigure:()=>void;onFinishedFrame:(image:string,camera:FrameCamera,plan:Plan)=>void}
export default function StagedSpace({draftKey,styleId,brief,aiAvailable,imageAvailable,onConfigure,onFinishedFrame,...props}:Props){
 const key=JSON.stringify([draftKey,styleId,brief.trim()]);
 const [version,setVersion]=useState<Version|null>(null),[show,setShow]=useState(false),[busy,setBusy]=useState(false),[note,setNote]=useState('');
 const [pano,setPano]=useState<{id:string;image:string}|null>(null);
 const [entrance,setEntrance]=useState<WalkSpawn|null>(null);
 const request=useRef<AbortController|null>(null),liveKey=useRef(key);liveKey.current=key;
 useEffect(()=>{try{const s=JSON.parse(localStorage.getItem(STORE)||'null');if(s&&(s.origin==='ai'||s.origin==='local')&&typeof s.key==='string')setVersion({...s,plan:validatePlan(s.plan)});}catch{}return()=>request.current?.abort();},[]);
 useEffect(()=>{request.current?.abort();setBusy(false);setShow(false);setPano(null);setNote('');},[key]);
 const valid=version?.key===key,finished=!!(valid&&show),canBuild=!!(props.plan.rooms.length&&props.plan.walls.length);
 async function build(ai:boolean){
  if(request.current||!canBuild)return;
  const ctl=new AbortController();request.current=ctl;setBusy(true);setNote('');const timeout=setTimeout(()=>ctl.abort('timeout'),95000);
  try{
   let next=validatePlan(props.plan);
   if(ai){
    const response=await fetch('/api/design',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'finishes',plan:next,style:styleId,prompt:brief}),signal:ctl.signal});
    const data=await response.json() as {plan?:Plan;error?:string};if(!response.ok||!data.plan?.materials)throw Error(data.error||'AI 材质生成失败');
    next=validatePlan({...next,materials:data.plan.materials});
   }
   if(ctl.signal.aborted||liveKey.current!==key)return;
   const snapshot:Version={key,plan:next,origin:ai?'ai':'local'};setEntrance(interiorCamera(next,props.selectedId));setVersion(snapshot);setShow(true);
   try{localStorage.setItem(STORE,JSON.stringify(snapshot));}catch{setNote('此版本可继续漫游，但浏览器未能保存。');}
  }catch(e){if(liveKey.current===key&&(!ctl.signal.aborted||ctl.signal.reason==='timeout'))setNote(ctl.signal.aborted?'AI 请求超时，可以重试或使用现有材质。':e instanceof Error?e.message:'生成失败，请重试。');}
  finally{clearTimeout(timeout);if(request.current===ctl){request.current=null;if(!ctl.signal.aborted||ctl.signal.reason==='timeout')setBusy(false);}}
 }
 if(pano&&finished&&version)return <section className="staged-space"><header><button className="button button-light" onClick={()=>setPano(null)}>‹ 返回质感空间</button><span>按质感版当前画面生成 AI 房间全景</span></header><PhotoTour plan={version.plan} styleId={styleId} prompt={brief} sourceImage={pano} imageConfigured={imageAvailable} onConfigure={onConfigure}/></section>;
 return <section className="staged-space"><header><div className="space-steps" aria-label="空间版本"><button aria-pressed={!finished} onClick={()=>setShow(false)}>① 白模布置</button><button aria-pressed={finished} disabled={!valid} onClick={()=>{if(version)setEntrance(interiorCamera(version.plan,props.selectedId));setShow(true);}}>② 质感空间</button></div><span>{finished?(version!.origin==='ai'?'AI 材质 · 可漫游':'现有材质 · 可漫游'):'摆好家具后，再生成质感版本'}</span></header>
 <div className="space-stage-line"><small role="status">{note||(busy?'AI 正在搭配材质，家具位置保持不变…':!canBuild?'请先添加房间与墙体。':finished?'可调视角、进入漫游或确认出图。':version&&!valid?'当前布置与已存版本不同，请重新生成。':'可移动家具、设置门窗，也可进入漫游。')}</small>
 {aiAvailable&&!busy&&<button disabled={!canBuild} onClick={()=>void build(true)}>{valid?'重新生成 AI 质感空间':'生成 AI 质感空间'}</button>}
 {!finished&&!busy&&<button disabled={!canBuild} onClick={()=>void build(false)}>{aiAvailable?'用现有材质预览':'用现有材质生成'}</button>}</div>
 <div className="space-stage-canvas"><SceneView key={finished?'finished':'draft'} {...props} tourStart={finished?entrance??undefined:undefined} onPanoramaFrame={finished?image=>{let h=2166136261;for(let i=0;i<image.length;i++)h=Math.imul(h^image.charCodeAt(i),16777619);setPano({id:'finish-'+(h>>>0).toString(16),image});}:undefined} presentation={finished?'finished':'draft'} plan={finished?version!.plan:props.plan} onPlanChange={finished?p=>setVersion(v=>v?{...v,plan:p}:null):props.onPlanChange} onEnvironmentChange={finished?e=>setVersion(v=>v?{...v,plan:{...v.plan,environment:e}}:null):props.onEnvironmentChange} onFloorChange={finished?undefined:props.onFloorChange} onEditOpenings={finished?undefined:props.onEditOpenings} onNewEraRender={finished&&props.onNewEraRender?camera=>props.onNewEraRender?.(camera,version!.plan):undefined} onReferenceReady={finished?(image,camera)=>onFinishedFrame(image,camera,version!.plan):undefined}/></div></section>;
}
