"use client";
import {useEffect,useRef,useState} from 'react';
import {photoVertex} from '@/lib/photo-depth';
import './photo-tour.css';
import * as T from 'three';

export default function PhotoStudy({image,sample,onExit}:{image:string;sample:boolean;onExit:()=>void}){
 const host=useRef<HTMLDivElement>(null),keys=useRef(new Set<string>()),reset=useRef<()=>void>(()=>{}),[error,setError]=useState(''),[ready,setReady]=useState(false);
 useEffect(()=>{
  const box=host.current;if(!box)return;
  let renderer:T.WebGLRenderer;
  try{renderer=new T.WebGLRenderer({antialias:true,alpha:false,powerPreference:'low-power'});}catch{setError('此浏览器无法打开三维视图，可返回全景继续查看。');return;}
  const canvas=renderer.domElement;box.appendChild(canvas);renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.5));const scene=new T.Scene(),cam=new T.PerspectiveCamera(68,1,.015,20);cam.rotation.order='YXZ';
  const yaw0=sample ? 1.43 : 0;let yaw=yaw0,pitch=-.07,alive=true,tex:T.Texture|null=null,raf=0,dirty=true,last=0;
  const geom=new T.BufferGeometry(),pos:number[]=[],uv:number[]=[],indices:number[]=[],cols=sample?384:144,rows=sample?192:72;
  for(let j=0;j<=rows;j++)for(let i=0;i<=cols;i++){const u=i/cols,v=j/rows,{dx,dy,dz,distance:d}=photoVertex(u,v,sample);pos.push(dx*d,dy*d,dz*d);uv.push(u,1-v);if(i&&j){const a=j*(cols+1)+i;indices.push(a-cols-2,a-1,a,a-cols-2,a,a-cols-1);}}
  geom.setAttribute('position',new T.Float32BufferAttribute(pos,3));geom.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geom.setIndex(indices);
  const mat=new T.MeshBasicMaterial({side:T.DoubleSide,toneMapped:false});const model=new T.Mesh(geom,mat);scene.add(model);
  function tick(t:number){
   raf=0;if(!alive||!tex)return;const dt=Math.max(0,Math.min(.045,(t-last)/1000));last=t;const k=keys.current,lr=Number(k.has('d'))-Number(k.has('a')),fb=Number(k.has('w'))-Number(k.has('s'));
   if(lr||fb){const scale=.75*dt/Math.hypot(lr,fb);cam.position.x+=(lr*Math.cos(yaw)-fb*Math.sin(yaw))*scale;cam.position.z+=(-lr*Math.sin(yaw)-fb*Math.cos(yaw))*scale;const len=Math.hypot(cam.position.x,cam.position.z);if(len>.36)cam.position.multiplyScalar(.36/len);dirty=true;}
   if(dirty){cam.rotation.set(pitch,yaw,0,'YXZ');renderer.render(scene,cam);box!.dataset.x=cam.position.x.toFixed(3);box!.dataset.z=cam.position.z.toFixed(3);dirty=false;}if(k.size)invalidate();
  }
  function invalidate(){if(!raf&&alive)raf=requestAnimationFrame(tick);}
  function resize(){const w=box!.clientWidth,h=box!.clientHeight;if(!w||!h)return;renderer.setSize(w,h,false);cam.aspect=w/h;cam.updateProjectionMatrix();dirty=true;invalidate();}
  const ro=new ResizeObserver(resize);ro.observe(box);resize();new T.TextureLoader().load(image,t=>{if(!alive){t.dispose();return;}tex=t;t.colorSpace=T.SRGBColorSpace;t.wrapS=T.RepeatWrapping;mat.map=t;mat.needsUpdate=true;setReady(true);dirty=true;invalidate();},undefined,()=>{if(alive)setError('全景原图无法载入。');});
  reset.current=()=>{cam.position.set(0,0,0);yaw=yaw0;pitch=-.07;dirty=true;invalidate();};
  let drag:number|null=null,x=0,y=0;const down=(e:PointerEvent)=>{drag=e.pointerId;x=e.clientX;y=e.clientY;box!.focus();canvas.setPointerCapture(e.pointerId);};const move=(e:PointerEvent)=>{if(drag!==e.pointerId)return;yaw+=(e.clientX-x)*.004;pitch=Math.max(-1.4,Math.min(1.4,pitch+(e.clientY-y)*.004));x=e.clientX;y=e.clientY;dirty=true;invalidate();};const up=()=>{drag=null;};
  const handle=(e:KeyboardEvent)=>{const key=({arrowup:'w',arrowdown:'s',arrowleft:'a',arrowright:'d'} as Record<string,string>)[e.key.toLowerCase()]||e.key.toLowerCase();if(!['w','a','s','d'].includes(key))return;e.preventDefault();if(e.type==='keydown')keys.current.add(key);else keys.current.delete(key);invalidate();};
  const stop=()=>keys.current.clear(),wake=()=>invalidate();canvas.onpointerdown=down;canvas.onpointermove=move;canvas.onlostpointercapture=up;box.onkeydown=handle;box.onkeyup=handle;box.onblur=stop;box.addEventListener('step',wake);window.addEventListener('blur',stop);box.focus();
  return()=>{alive=false;stop();cancelAnimationFrame(raf);window.removeEventListener('blur',stop);box.removeEventListener('step',wake);box.onkeydown=box.onkeyup=box.onblur=null;ro.disconnect();geom.dispose();mat.dispose();tex?.dispose();renderer.dispose();renderer.forceContextLoss();canvas.remove();};
 },[image,sample]);
 return <section className="photo-study"><div ref={host} tabIndex={0} aria-label="照片空间三维视图" className="photo-study-host"/><div className="photo-study-top"><strong>{sample?'日光客厅 · 示例样间':'当前房间 · 照片空间'}</strong><button onClick={onExit}>退出移步</button></div>{!ready&&<p role="status">{error||'正在载入照片空间…'}</p>}<footer><span>近景移步 · 拖动环顾<br/><small>单张全景估算深度，限原视点周围 0.36 米</small></span><div>{(['w','a','s','d'] as const).map((k,i)=><button key={k} aria-label={['向前移步','向左移步','向后移步','向右移步'][i]} onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);keys.current.add(k);host.current?.dispatchEvent(new Event('step'));}} onLostPointerCapture={()=>keys.current.delete(k)}>{['↑','←','↓','→'][i]}</button>)}<button onClick={()=>{reset.current();host.current?.focus()}}>复位</button></div></footer></section>;
}
