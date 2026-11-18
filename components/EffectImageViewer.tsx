"use client";

import {useEffect,useRef,useState} from 'react';
import {Box,Download,Minus,Plus,RotateCcw,Sparkles} from 'lucide-react';
import dynamic from 'next/dynamic';
import {useMemo} from 'react';
import {validatePlan} from '@/lib/validation';
import {STYLE_OPTIONS} from '@/lib/plan';
const PhotoTour=dynamic(()=>import('./PhotoTour'),{ssr:false});
import FrameTour from './FrameTour';
import type {GeneratedImageRecord} from '@/lib/generation-store';
import PhotoWorldPanel from './PhotoWorldPanel';
import './effect-image-viewer.css';

export interface EffectImageViewerProps {
  record?:GeneratedImageRecord;
  imageConfigured?:boolean;
  onConfigure?:()=>void;
  image:string;
  imageId:string;
  alt:string;
  styleLabel:string;
  roomLabel:string;
  onEdit:()=>void;
  onDownload:()=>void;
}

/** Moves the whole reference image; the editable scene remains in the 3D view. */
export default function EffectImageViewer({record,imageConfigured,onConfigure,image,imageId,alt,styleLabel,roomLabel,onEdit,onDownload}:EffectImageViewerProps){
  const viewport=useRef<HTMLDivElement>(null);
  const drag=useRef<{id:number;x:number;y:number;originX:number;originY:number}|null>(null);
  const [pose,setPose]=useState({x:0,y:0,scale:1});
  const [dragging,setDragging]=useState(false);
  const [panorama,setPanorama]=useState(false);
  const source=useMemo(()=>{try{return validatePlan(JSON.parse(record?.sourcePlanKey||record?.sceneKey||'')[0]);}catch{return null;}},[record]);
  const [tour,setTour]=useState(false);
  const [worldOpen,setWorldOpen]=useState(false);
  useEffect(()=>{drag.current=null;setDragging(false);setPose({x:0,y:0,scale:1});},[image]);
  useEffect(()=>{
    const element=viewport.current;if(!element)return;
    const wheel=(event:WheelEvent)=>{event.preventDefault();const factor=Math.exp(-Math.max(-100,Math.min(100,event.deltaY))*.002);setPose(old=>({...old,scale:Math.max(.5,Math.min(4,old.scale*factor))}));};
    element.addEventListener('wheel',wheel,{passive:false});return()=>element.removeEventListener('wheel',wheel);
  },[]);
  function release(event:React.PointerEvent<HTMLDivElement>){if(!drag.current||drag.current.id!==event.pointerId)return;drag.current=null;setDragging(false);if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}
  function zoom(factor:number){setPose(old=>({...old,scale:Math.max(.5,Math.min(4,old.scale*factor))}));}
  function reset(){setPose({x:0,y:0,scale:1});}
  if(panorama&&source)return <div style={{overflow:'auto',flex:1}}><button className="button button-light" onClick={()=>setPanorama(false)}>‹ 返回效果图</button><PhotoTour plan={source} styleId={STYLE_OPTIONS.find(s=>s.name===styleLabel)?.id||'warm-minimal'} selectedRoomId={source.rooms.find(r=>r.name===roomLabel)?.id} prompt="以提供的效果图为视觉参考，匹配设计、材质、家具和光照；未展示部分按户型补全。" sourceImage={{id:imageId,image}} imageConfigured={!!imageConfigured} onConfigure={()=>onConfigure?.()}/></div>;
  if(tour&&record)return <FrameTour record={record} onBack={()=>setTour(false)}/>;
  return <div className="render-stage effect-image-stage effect-image-viewer" data-testid="effect-image-viewer" data-scale={pose.scale.toFixed(2)} data-x={pose.x.toFixed(1)} data-y={pose.y.toFixed(1)}>
    <div ref={viewport} className={`effect-image-viewport${dragging?' dragging':''}`} role="img" aria-label={`${alt}。可拖动图片、滚轮缩放。`} tabIndex={0}
      onPointerDown={event=>{if(event.button!==0||drag.current)return;drag.current={id:event.pointerId,x:event.clientX,y:event.clientY,originX:pose.x,originY:pose.y};event.currentTarget.setPointerCapture(event.pointerId);setDragging(true);}}
      onPointerMove={event=>{const current=drag.current;if(!current||current.id!==event.pointerId)return;const bounds=event.currentTarget.getBoundingClientRect();setPose(old=>({...old,x:Math.max(-bounds.width*.9,Math.min(bounds.width*.9,current.originX+event.clientX-current.x)),y:Math.max(-bounds.height*.9,Math.min(bounds.height*.9,current.originY+event.clientY-current.y))}));}}
      onPointerUp={release} onPointerCancel={release} onLostPointerCapture={()=>{drag.current=null;setDragging(false);}}
      onKeyDown={event=>{if(event.key==='+'||event.key==='='){event.preventDefault();zoom(1.2);}else if(event.key==='-'){event.preventDefault();zoom(1/1.2);}else if(event.key==='Home'){event.preventDefault();reset();}}}>
      <img className="render-image effect-image-content" src={image} alt={alt} draggable={false} style={{transform:`translate(${pose.x}px,${pose.y}px) scale(${pose.scale})`}}/>
    </div>
    <div className="render-image-tag"><Sparkles size={13}/>{styleLabel}<span/>{roomLabel} · {record?.sceneKey?"确认视角":"生成结果"}</div>
    <div className="effect-image-toolbar" aria-label="图片视角控制"><button aria-label="缩小效果图" disabled={pose.scale<=.5} onClick={()=>zoom(1/1.2)}><Minus size={15}/></button><output>{Math.round(pose.scale*100)}%</output><button aria-label="放大效果图" disabled={pose.scale>=4} onClick={()=>zoom(1.2)}><Plus size={15}/></button><button aria-label="重置效果图视角" onClick={reset}><RotateCcw size={14}/></button></div>
    <div className="effect-image-actions">{source&&<button className="effect-edit-button" onClick={()=>setPanorama(true)}>按图生成 360° 全景</button>}<button className="button button-dark" onClick={()=>setWorldOpen(true)}><Sparkles size={14}/>生成写实漫游空间</button>{record?.sceneKey&&<button className="effect-edit-button" onClick={()=>setTour(true)}><Box size={14}/>进入图中漫游</button>}<button className="effect-edit-button" onClick={onEdit}><Box size={14}/>返回可编辑三维</button><button className="button button-dark" onClick={onDownload}><Download size={14}/>下载原图</button></div>
    {worldOpen&&<PhotoWorldPanel image={image} imageId={imageId} onClose={()=>setWorldOpen(false)}/>}
  </div>;
}
