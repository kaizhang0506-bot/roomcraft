"use client";

import {useEffect,useRef,useState} from 'react';
import {ExternalLink,LoaderCircle,X} from 'lucide-react';

type Task = {imageId:string;requestId:string;phase:'submitting'|'unknown'|'processing'|'succeeded'|'failed';taskId?:string;taskToken?:string;viewerUrl?:string;worldId?:string;worldToken?:string;message?:string};
const KEY='roomcraft.photo-world.task.v1';
const storageKey=(imageId:string)=>`${KEY}:${imageId}`;
function safeViewer(value:unknown):value is string{
 if(typeof value!=='string')return false;
 try{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='marble.worldlabs.ai'&&!url.username&&!url.password&&url.pathname.startsWith('/world/');}catch{return false;}
}
function readTask(imageId:string):Task|null{
 try{const value=JSON.parse(sessionStorage.getItem(storageKey(imageId))||'null') as Task|null;if(value?.phase==='succeeded'&&!safeViewer(value.viewerUrl))return null;return value?.imageId===imageId?value:null;}catch{return null;}
}
function saveTask(task:Task|null,imageId:string):boolean{try{if(task)sessionStorage.setItem(storageKey(imageId),JSON.stringify(task));else sessionStorage.removeItem(storageKey(imageId));return true;}catch{return false;}}

/** A paid external 3D world: the image is sent only after the user clicks. */
export default function PhotoWorldPanel({image,imageId,onClose}:{image:string;imageId:string;onClose:()=>void}){
 const [configured,setConfigured]=useState<boolean|null>(null);
 const [task,setTask]=useState<Task|null>(null);
 const [loading,setLoading]=useState(false);
 const sending=useRef(false);
 useEffect(()=>{
  const existing=readTask(imageId);
  if(existing?.phase==='submitting') {const unknown={...existing,phase:'unknown' as const,message:'上次提交结果未知。请先在 MeltFlex 查看任务记录，避免重复扣费。'};setTask(unknown);saveTask(unknown,imageId);}
  else setTask(existing);
  let active=true;fetch('/api/world?status=1',{cache:'no-store'}).then(r=>r.ok?r.json():Promise.reject()).then((data:unknown)=>{if(active)setConfigured(!!data&&typeof data==='object'&&'configured' in data&&data.configured===true);}).catch(()=>{if(active)setConfigured(false);});
  return()=>{active=false;};
 },[imageId]);
 useEffect(()=>{
  if(task?.phase!=='processing'||!task.taskId||!task.taskToken)return;
  let cancelled=false;const controller=new AbortController();
  const poll=async()=>{
   try{
    const response=await fetch(`/api/world?kind=operation&id=${encodeURIComponent(task.taskId!)}`,{headers:{'X-Roomcraft-Task-Token':task.taskToken!},cache:'no-store',signal:controller.signal});
    const data=await response.json() as {status?:string;taskId?:string;taskToken?:string;viewerUrl?:string;worldId?:string;worldToken?:string;error?:string};
    if(cancelled)return;
    if(!response.ok) {setTask(old=>old?{...old,message:data.error||'暂时无法查询，稍后会继续查询。'}:old);return;}
    if(data.status==='succeeded'&&safeViewer(data.viewerUrl)&&data.worldId){const next:Task={...task,phase:'succeeded',viewerUrl:data.viewerUrl,worldId:data.worldId,worldToken:data.worldToken};saveTask(next,imageId);setTask(next);}
    else if(data.status==='failed'){const next:Task={...task,phase:'failed',message:data.error||'生成失败，请到 MeltFlex 核对任务与退款。'};saveTask(next,imageId);setTask(next);}
   }catch(error){if(!cancelled&&!(error instanceof Error&&error.name==='AbortError'))setTask(old=>old?{...old,message:'网络暂时不可用，将继续查询原任务。'}:old);}
  };
  const timer=window.setInterval(()=>void poll(),8000);void poll();
  return()=>{cancelled=true;window.clearInterval(timer);controller.abort();};
 },[task?.phase,task?.taskId,task?.taskToken]);
 async function prepareInput(){
   if(!image.startsWith('data:image/')&&image!=='/images/photo-tour-demo-v1.png')throw new Error('找不到当前出图。');
   if(image.startsWith('data:image/')&&image.length<=4_400_000)return image;
   const bitmap=new Image();bitmap.src=image;await bitmap.decode();
   const ratio=Math.min(1,2048/Math.max(bitmap.width,bitmap.height));
   const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio));
   const ctx=canvas.getContext('2d');if(!ctx)throw new Error('浏览器无法读取图片。');
   ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
   const result=canvas.toDataURL('image/jpeg',.87);if(result.length>4_400_000)throw new Error('图片过大，未提交任务。');return result;
 }
 async function start(){
  if(sending.current||configured!==true||task)return;
  sending.current=true;setLoading(true);let prepared:string;try{prepared=await prepareInput();}catch{setTask({imageId,requestId:'',phase:'failed',message:'无法读取参考图，未提交任务。'});sending.current=false;setLoading(false);return;}
  const requestId=crypto.randomUUID();const pending:Task={imageId,requestId,phase:'submitting'};
  if(!saveTask(pending,imageId)){sending.current=false;setLoading(false);setTask({...pending,phase:'unknown',message:'浏览器无法保存任务记录，未提交生成。请先允许本地存储。'});return;}
  sending.current=true;setLoading(true);setTask(pending);
  try{
   const response=await fetch('/api/world',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image:prepared,requestId,confirmedCost:30}),signal:AbortSignal.timeout(240000)});
   const data=await response.json() as {status?:string;taskId?:string;taskToken?:string;viewerUrl?:string;worldId?:string;worldToken?:string;error?:string};
   if(!response.ok)throw new Error(data.error||'提交结果未确认，请先检查 MeltFlex 任务记录。');
   let next:Task;
   if(data.status==='processing'&&data.taskId&&data.taskToken) next={...pending,phase:'processing',taskId:data.taskId,taskToken:data.taskToken};
   else if(data.status==='succeeded'&&safeViewer(data.viewerUrl)&&data.worldId) next={...pending,phase:'succeeded',viewerUrl:data.viewerUrl,worldId:data.worldId,worldToken:data.worldToken};
   else if(data.status==='failed') next={...pending,phase:'failed',message:data.error||'生成失败，请核对退款。'};
   else throw new Error('服务未返回有效任务，请先检查 MeltFlex 任务记录。');
   saveTask(next,imageId);setTask(next);
  }catch(error){const next:Task={...pending,phase:'unknown',message:error instanceof Error?error.message:'提交结果未知，请先检查 MeltFlex 任务记录。'};saveTask(next,imageId);setTask(next);}
  finally{sending.current=false;setLoading(false);}
 }
 return <div style={{position:'absolute',inset:0,zIndex:30,background:'#18221dd9',display:'grid',placeItems:'center',padding:18}} role="dialog" aria-modal="true" aria-label="生成照片漫游空间">
  <div style={{width:'min(480px,100%)',maxHeight:'90%',overflowY:'auto',padding:22,borderRadius:12,background:'#fdfdf6',color:'#364533',boxShadow:'0 16px 45px #0004',fontSize:13,lineHeight:1.65}}>
   <button aria-label="关闭漫游空间设置" onClick={onClose} style={{float:'right',border:0,background:'transparent',cursor:'pointer'}}><X size={19}/></button>
   <h3 style={{margin:'0 0 8px'}}>从这张图生成可行走空间</h3>
   <p>通过 MeltFlex 将这张图片发送至外部服务，生成可转向和移动的照片感空间。生成结果是独立场景，家具不能单独拖动，也可能与真实户型有差异。</p>
   <p><strong>草稿预计消耗 30 credits</strong>，需要 MeltFlex 的付费订阅和专用密钥；费用由服务商收取。只有点击下方按钮后才会提交图片。</p>
   {configured===null?<p>正在检查服务配置…</p>:configured===false?<p role="status">MeltFlex 尚未配置。请在服务端设置 <code>MELTFLEX_API_KEY</code> 并重启网站；已有中转站密钥不能直接替代。</p>:null}
   {task?.phase==='submitting'&&<p role="status"><LoaderCircle size={14}/> 已提交，正在等待任务编号；请不要重复提交。</p>}
   {task?.phase==='processing'&&<p role="status">正在生成漫游空间，页面会继续查询同一个任务。{task.message&&` ${task.message}`}</p>}
   {task?.phase==='unknown'&&<p role="alert">{task.message} 请先核查服务商记录，再决定是否重新开始。</p>}
   {task?.phase==='failed'&&<p role="status">{task.message}</p>}
   {task?.phase==='succeeded'&&task.viewerUrl&&<p><a href={task.viewerUrl} target="_blank" rel="noopener noreferrer" style={{color:'#536d45',fontWeight:700}}>打开生成的漫游空间 <ExternalLink size={14}/></a><br/><small>将在 World Labs 的页面打开，效果以实际生成结果为准。</small></p>}
   {!task&&<button className="button button-dark" disabled={configured!==true||loading} onClick={()=>void start()}>发送图片并生成 · 30 credits</button>}
   {(task?.phase==='unknown'||task?.phase==='failed'||task?.phase==='succeeded')&&<button className="button button-light" onClick={()=>{saveTask(null,imageId);setTask(null);}}>已核查记录，开始新任务</button>}
   <p style={{fontSize:11,color:'#858b7d'}}>本次生成结果使用服务商托管页面；当前编辑方案不会被覆盖。</p>
  </div>
 </div>;
}
