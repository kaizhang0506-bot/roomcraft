"use client";

import { useEffect, useRef, useState } from 'react';
import type { Viewer } from '@photo-sphere-viewer/core';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Expand, LoaderCircle, Minus, Plus, RotateCcw } from 'lucide-react';
import PanoramaViewer, { type PanoramaViewerProps } from './PanoramaViewer';
import '@photo-sphere-viewer/core/index.css';
import './panorama-viewer.css';

/** GPU panorama viewer. The original CPU viewer remains available when WebGL cannot start. */
export default function PhotoSphereViewer({image,label,sourceLabel='AI 全景 · 非实拍',onError}:PanoramaViewerProps) {
  const root=useRef<HTMLDivElement>(null), host=useRef<HTMLDivElement>(null), viewer=useRef<Viewer|null>(null), errorRef=useRef(onError);
  errorRef.current=onError;
  const [status,setStatus]=useState<'loading'|'ready'|'error'>('loading');
  const [error,setError]=useState(''),[fallback,setFallback]=useState(false),[retry,setRetry]=useState(0),[notice,setNotice]=useState('');
  const [pose,setPose]=useState({yaw:0,pitch:0,zoom:50});
  useEffect(()=>{
    let active=true; let current:Viewer|null=null;
    setStatus('loading');setError('');setNotice('');setFallback(false);
    const fail=(message:string)=>{if(active){setError(message);setStatus('error');errorRef.current?.(message);}};
    const photo=new Image();photo.crossOrigin='anonymous';
    photo.onload=()=>{
      const {naturalWidth:w,naturalHeight:h}=photo;
      if(w<400||h<200||w*h>48000000||Math.abs(w/h-2)>.04){fail('需要清晰的 2:1 球面全景图，图片尺寸过小、过大或比例不正确。');return;}
      void (async()=>{
        try {
          const probe=document.createElement('canvas');const gl=probe.getContext('webgl2')||probe.getContext('webgl');
          if(!gl){if(active)setFallback(true);return;}
          gl.getExtension('WEBGL_lose_context')?.loseContext();
          const {Viewer,events}=await import('@photo-sphere-viewer/core');
          if(!active||!host.current)return;
          current=new Viewer({container:host.current,panorama:image,navbar:false,keyboard:false,defaultZoomLvl:50,minFov:35,maxFov:110,rendererParameters:{antialias:true,alpha:false}});
          viewer.current=current;
          current.addEventListener(events.ReadyEvent.type,()=>{if(active){setStatus('ready');const canvas=host.current?.querySelector('canvas');if(canvas){canvas.tabIndex=0;canvas.setAttribute('aria-label',`${label}，360度全景，可拖动或使用方向键环顾`);}}});
          current.addEventListener(events.PositionUpdatedEvent.type,e=>{if(active)setPose(p=>({...p,yaw:e.position.yaw,pitch:e.position.pitch}));});
          current.addEventListener(events.ZoomUpdatedEvent.type,e=>{if(active)setPose(p=>({...p,zoom:e.zoomLevel}));});
          current.addEventListener(events.PanoramaErrorEvent.type,()=>fail('全景图片载入失败，请检查图片或重新生成。'));
        }catch{if(active)setFallback(true);}
      })();
    };
    photo.onerror=()=>fail('全景图片加载失败，请检查连接或重新生成。');
    if(!image||image.length>32*1024*1024)fail('全景图片为空或超过允许大小。');else photo.src=image;
    return()=>{active=false;photo.onload=null;photo.onerror=null;photo.removeAttribute('src');viewer.current=null;current?.destroy();};
  },[image,retry,label]);
  if(fallback)return <PanoramaViewer image={image} label={label} sourceLabel={sourceLabel} onError={onError}/>;
  function rotate(yaw:number,pitch:number){const v=viewer.current;if(!v)return;const p=v.getPosition();v.rotate({yaw:p.yaw+yaw,pitch:p.pitch+pitch});}
  function reset(){viewer.current?.rotate({yaw:0,pitch:0});viewer.current?.zoom(50);}
  async function fullscreen(){try{if(document.fullscreenElement===root.current)await document.exitFullscreen();else await root.current?.requestFullscreen();}catch{setNotice('当前浏览器未开放全屏，可继续拖动环顾。');}}
  return <div ref={root} className="pano-viewer" data-testid="panorama-viewer" data-engine="photo-sphere-viewer" data-status={status} data-yaw={pose.yaw.toFixed(4)} data-pitch={pose.pitch.toFixed(4)} data-fov={(110-pose.zoom*.75).toFixed(1)}>
    <div ref={host} className="photo-sphere-host" onKeyDown={e=>{const moves:Record<string,[number,number]>={ArrowLeft:[-.12,0],ArrowRight:[.12,0],ArrowUp:[0,.08],ArrowDown:[0,-.08]};if(moves[e.key]){e.preventDefault();rotate(...moves[e.key]);}else if(e.key==='Home'){e.preventDefault();reset();}else if(e.key==='+'||e.key==='='){e.preventDefault();viewer.current?.zoomIn(7);}else if(e.key==='-'){e.preventDefault();viewer.current?.zoomOut(7);}}}/>
    {status==='ready'&&<><div className="pano-heading"><div><span className="pano-badge">360° 全景</span><strong>{label}</strong></div><button type="button" aria-label="全屏查看全景" onClick={()=>void fullscreen()}><Expand size={16}/></button></div><div className="pano-guide">拖动环顾 · 滚轮缩放<span>图片视点固定，通过房间导航切换</span></div><div className="pano-bottom"><span className="pano-disclosure">{sourceLabel}</span><div className="pano-controls" aria-label="全景视角控制">
      <button aria-label="全景向左看" onClick={()=>rotate(-.18,0)}><ArrowLeft size={16}/></button><button aria-label="全景向右看" onClick={()=>rotate(.18,0)}><ArrowRight size={16}/></button><button aria-label="全景向上看" onClick={()=>rotate(0,.12)}><ArrowUp size={16}/></button><button aria-label="全景向下看" onClick={()=>rotate(0,-.12)}><ArrowDown size={16}/></button><i/><button aria-label="全景放大" disabled={pose.zoom>=100} onClick={()=>viewer.current?.zoomIn(10)}><Plus size={16}/></button><button aria-label="全景缩小" disabled={pose.zoom<=0} onClick={()=>viewer.current?.zoomOut(10)}><Minus size={16}/></button><button aria-label="重置全景视角" onClick={reset}><RotateCcw size={15}/></button>
    </div></div>{notice&&<p className="pano-notice" role="status">{notice}</p>}</>}
    {status!=='ready'&&<div className="pano-message" role={status==='error'?'alert':'status'}>{status==='loading'?<><LoaderCircle size={26} className="pano-spinner"/><strong>正在载入室内全景</strong></>:<><strong>全景暂时无法显示</strong><span>{error}</span><button type="button" onClick={()=>setRetry(n=>n+1)}>重新载入全景</button></>}</div>}
  </div>;
}
